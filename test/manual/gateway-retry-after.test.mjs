// 手动专项：先 pnpm typecheck，再 node --test test/manual/gateway-retry-after.test.mjs。
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { setImmediate as nextTurn } from "node:timers/promises";
import {
  DEFAULT_RETRY_AFTER_MS,
  OctoApiError
} from "../../packages/octo-runtime-extra-channel-gateway/dist/transport/api/errors.js";
import {
  MAX_429_RETRIES,
  MAX_429_BACKOFF_WAIT_MS,
  MAX_RETRY_AFTER_MS,
  postJson
} from "../../packages/octo-runtime-extra-channel-gateway/dist/transport/api/client.js";
import { sendMessage } from "../../packages/octo-runtime-extra-channel-gateway/dist/transport/api/messages.js";
import { httpConnectionFailure } from "../../packages/octo-runtime-extra-channel-gateway/dist/transport/connection-error.js";
import { parseRetryAfterMs } from "../../packages/octo-runtime-extra-channel-gateway/dist/transport/retry-after.js";

const fixedNow = Date.parse("2026-10-28T08:00:00.250Z");
const hintBody = (seconds) => JSON.stringify({ error: { details: { retry_after: seconds } } });
const response = (hint) =>
  new Response("{}", {
    status: 429,
    headers: hint === undefined ? {} : { "Retry-After": hint }
  });
const apiError = (hint, body = "") => OctoApiError.from(response(hint), "/fixture", body);
const execFileAsync = promisify(execFile);
const utcRegressionNames = [
  "HTTP-date forms use UTC",
  "real HTTP asctime retry respects UTC",
  "RFC850 years follow the HTTP forward window",
  "real HTTP future RFC850 hint stays over budget",
  "HTTP-date calendar and leap seconds use validated UTC components"
];

test("REST and connection errors honor future HTTP-date hints", async (t) => {
  t.mock.method(Date, "now", () => fixedNow);
  const date = new Date(fixedNow + 6000).toUTCString();
  const remaining = Date.parse(date) - fixedNow;
  assert.equal(apiError(date, hintBody(1)).retryAfterMs, remaining);
  for (const phase of ["AUTH", "REGISTER"]) {
    const failure = await httpConnectionFailure(response(date), phase);
    assert.equal(failure.retryAfterMs, remaining);
    assert.equal(failure.retryable, true);
    assert.equal(failure.message, `IM_${phase}_HTTP_429`);
  }
});

test(utcRegressionNames[0], async (t) => {
  let now = fixedNow;
  t.mock.method(Date, "now", () => now);
  for (const [at, hint, expected] of [
    [fixedNow, "Wed, 28 Oct 2026 08:00:06 GMT", 5750],
    [fixedNow, "Wednesday, 28-Oct-26 08:00:06 GMT", 5750],
    [fixedNow, "Wed Oct 28 08:00:06 2026", 5750],
    [Date.parse("2026-10-08T08:00:00.250Z"), "Thu Oct  8 08:00:06 2026", 5750],
    [fixedNow, "Wed Oct 28 07:59:00 2026", 0],
    [fixedNow, "Wed Oct 28 08:00:00 2026", 0],
    [fixedNow, "6", 6000],
    [fixedNow, "not-a-date", 0]
  ]) {
    now = at;
    assert.equal(apiError(hint, hintBody(1)).retryAfterMs, expected || 1000, hint);
    for (const phase of ["AUTH", "REGISTER"]) {
      const failure = await httpConnectionFailure(response(hint), phase);
      assert.equal(failure.retryAfterMs, expected, `${phase}: ${hint}`);
    }
  }
});

test(utcRegressionNames[2], async (t) => {
  let now = fixedNow;
  t.mock.method(Date, "now", () => now);
  for (const [current, hint, expectedDate] of [
    ["2026-10-28T08:00:00.250Z", "Sunday, 06-Nov-50 08:49:37 GMT", "2050-11-06T08:49:37Z"],
    ["2026-10-28T08:00:00.250Z", "Wednesday, 28-Oct-26 08:00:06 GMT", "2026-10-28T08:00:06Z"],
    ["2026-10-28T08:00:00Z", "Wednesday, 28-Oct-76 08:00:00 GMT", "2076-10-28T08:00:00Z"],
    ["2026-10-28T08:00:00Z", "Thursday, 28-Oct-76 08:00:01 GMT", "1976-10-28T08:00:01Z"],
    ["2026-10-28T08:00:00Z", "Sunday, 06-Nov-94 08:49:37 GMT", "1994-11-06T08:49:37Z"],
    ["1999-01-01T00:00:00Z", "Saturday, 01-Jan-00 00:00:06 GMT", "2000-01-01T00:00:06Z"],
    ["2049-01-01T00:00:00Z", "Thursday, 01-Jan-99 00:00:00 GMT", "2099-01-01T00:00:00Z"],
    ["2050-01-01T00:00:00Z", "Friday, 01-Jan-00 00:00:00 GMT", "2100-01-01T00:00:00Z"],
    ["2090-01-01T00:00:00Z", "Monday, 01-Jan-20 00:00:00 GMT", "2120-01-01T00:00:00Z"],
    ["2090-01-01T00:00:00Z", "Tuesday, 01-Jan-41 00:00:00 GMT", "2041-01-01T00:00:00Z"]
  ]) {
    now = Date.parse(current);
    const remaining = Math.max(0, Date.parse(expectedDate) - now);
    assert.equal(
      apiError(hint, hintBody(1)).retryAfterMs,
      remaining || 1000,
      `${current}: ${hint}`
    );
    for (const phase of ["AUTH", "REGISTER"]) {
      const failure = await httpConnectionFailure(response(hint), phase);
      assert.equal(failure.retryAfterMs, remaining, `${phase} ${current}: ${hint}`);
    }
  }
});

test("HTTP-date regressions run in isolated non-UTC timezones", { timeout: 45_000 }, async (t) => {
  for (const timezone of ["Asia/Shanghai", "America/Los_Angeles"]) {
    await t.test(timezone, async () => {
      // 子进程固定时区，避免修改测试进程的全局 TZ；名称过滤防止递归运行驱动测试。
      const env = { ...process.env, TZ: timezone };
      // 新测试运行器不能继承父 worker 标记，否则 Node 会跳过嵌套执行。
      delete env.NODE_TEST_CONTEXT;
      const { stdout } = await execFileAsync(
        process.execPath,
        [
          "--test",
          "--test-reporter=spec",
          `--test-name-pattern=^(${utcRegressionNames.join("|")})$`,
          fileURLToPath(import.meta.url)
        ],
        { env, timeout: 20_000 }
      );
      for (const name of utcRegressionNames) assert.ok(stdout.includes(name), stdout);
    });
  }
});

test("numeric hints and zero/invalid fallback policies remain bounded", async (t) => {
  t.mock.method(Date, "now", () => fixedNow);
  for (const [hint, expected] of [
    ["6", 6000],
    ["1.25", 1250],
    [" 2 ", 2000],
    ["10001", 10_001_000],
    ["0", 0],
    ["0.0004", 0],
    [new Date(fixedNow - 60_000).toUTCString(), 0],
    [new Date(Math.floor(fixedNow / 1000) * 1000).toUTCString(), 0],
    [undefined, 0],
    ["", 0],
    [" ", 0],
    ["not-a-date", 0],
    ["-1", 0],
    ["NaN", 0],
    ["Infinity", 0],
    ["1e309", 0],
    ["1e308", 0],
    ["1" + "0".repeat(309), 0],
    ["1" + "0".repeat(308), Infinity],
    ["0006", 6000],
    [".5", 500],
    ["1.", 1000]
  ]) {
    await t.test(String(hint), async () => {
      assert.equal(apiError(hint).retryAfterMs, expected || DEFAULT_RETRY_AFTER_MS);
      assert.equal(apiError(hint, hintBody(3)).retryAfterMs, expected || 3000);
      const failure = await httpConnectionFailure(response(hint), "AUTH");
      assert.equal(failure.retryAfterMs, Number.isFinite(expected) ? expected : 0);
    });
  }
  for (const invalid of [0, -1, "3", null]) {
    assert.equal(apiError(undefined, hintBody(invalid)).retryAfterMs, DEFAULT_RETRY_AFTER_MS);
  }
  assert.equal(apiError(undefined, "not-json").retryAfterMs, DEFAULT_RETRY_AFTER_MS);
  assert.equal(apiError(undefined, hintBody(1.25)).retryAfterMs, 1250);
  assert.equal(apiError(undefined, hintBody(1e308)).retryAfterMs, Infinity);
});

test("non-decimal numeric syntax cannot become a delay or a date", async (t) => {
  t.mock.method(Date, "now", () => fixedNow);
  assert.equal(parseRetryAfterMs("x" + " ".repeat(16_000) + "y", fixedNow), undefined);
  for (const hint of [
    "0x10",
    "0X10",
    "0b10",
    "0B10",
    "0o10",
    "0O10",
    "+1",
    "+0",
    "-0",
    "-0.5",
    "1e3",
    "1E3",
    "1e-3",
    "1e+3",
    "1_000",
    "1,000",
    "1 0",
    ".",
    "1.2.3",
    "\u00a01\u00a0",
    "\u000b1",
    "1\n",
    "\uff11"
  ]) {
    await t.test(JSON.stringify(hint), async () => {
      assert.equal(parseRetryAfterMs(hint, fixedNow), undefined);
      // Headers 会先拒绝 CR/LF 和非 ByteString 字符，这些输入只验证解析入口。
      if (/[\r\n\u0100-\uffff]/.test(hint)) return;
      assert.equal(apiError(hint).retryAfterMs, DEFAULT_RETRY_AFTER_MS);
      assert.equal(apiError(hint, hintBody(3)).retryAfterMs, 3000);
      for (const phase of ["AUTH", "REGISTER"]) {
        assert.equal((await httpConnectionFailure(response(hint), phase)).retryAfterMs, 0);
      }
    });
  }
});

test("invalid HTTP-date syntax and calendar values use caller fallbacks", async (t) => {
  t.mock.method(Date, "now", () => fixedNow);
  for (const hint of [
    "2026-10-28T08:00:06Z",
    "10/28/2026 08:00:06",
    "28 Oct 2026 08:00:06 GMT",
    "Wed, 28 Oct 2026 08:00:06",
    "Wed, 28 Oct 2026 08:00:06 UTC",
    "Wed, 28 Oct 2026 08:00:06 +0000",
    "wed, 28 Oct 2026 08:00:06 GMT",
    "Wed, 28 oct 2026 08:00:06 GMT",
    "Wed, 28 Oct 2026 08:00:06 gmt",
    "Wed,  28 Oct 2026 08:00:06 GMT",
    "Wed, 28 Oct 2026 8:00:06 GMT",
    "Wed, 28 Oct 2026 08:00 GMT",
    "Wed, 28 Oct 2026 08:00:06.5 GMT",
    "Wed, 28 Oct 2026 08:00:06 GMT (comment)",
    "Wed, 28 Oct 2026 08:00:06 GMT, 1",
    "Wed, 00 Oct 2026 08:00:06 GMT",
    "Wed, 32 Oct 2026 08:00:06 GMT",
    "Wed, 31 Apr 2027 08:00:06 GMT",
    "Wed, 29 Feb 2027 08:00:06 GMT",
    "Wed, 30 Feb 2028 08:00:06 GMT",
    "Wed, 28 Oct 2026 24:00:00 GMT",
    "Wed, 28 Oct 2026 08:60:00 GMT",
    "Wed, 28 Oct 2026 08:00:61 GMT",
    "Thu, 28 Oct 2026 08:00:06 GMT",
    "Wed, 28 Oct 0050 08:00:06 GMT",
    "Wed, 28 Oct 10000 08:00:06 GMT",
    "Wednesday, 30-Feb-28 08:00:06 GMT",
    "Wednesday, 28-Oct-2026 08:00:06 GMT",
    "Wednesday, 28-Oct-26 24:00:00 GMT",
    "Thursday, 28-Oct-26 08:00:06 GMT",
    "Wed Feb 30 08:00:06 2028",
    "Wed Oct 28 24:00:00 2026",
    "Wed Oct 8 08:00:06 2026",
    "Wed Oct 28 08:00:06 26",
    "Wed Oct 28 08:00:06 2026 GMT",
    "Thu Oct 28 08:00:06 2026"
  ]) {
    await t.test(hint, async () => {
      assert.equal(parseRetryAfterMs(hint, fixedNow), undefined);
      assert.equal(apiError(hint).retryAfterMs, DEFAULT_RETRY_AFTER_MS);
      assert.equal(apiError(hint, hintBody(3)).retryAfterMs, 3000);
      for (const phase of ["AUTH", "REGISTER"]) {
        assert.equal((await httpConnectionFailure(response(hint), phase)).retryAfterMs, 0);
      }
    });
  }
});

test(utcRegressionNames[4], async (t) => {
  let now = fixedNow;
  t.mock.method(Date, "now", () => now);
  for (const [current, expected, hints] of [
    [
      "2028-02-29T07:59:59.250Z",
      "2028-02-29T08:00:06Z",
      [
        "Tue, 29 Feb 2028 08:00:06 GMT",
        "Tuesday, 29-Feb-28 08:00:06 GMT",
        "Tue Feb 29 08:00:06 2028"
      ]
    ],
    [
      "2090-01-01T00:00:00Z",
      "2100-03-01T00:00:06Z",
      [
        "Mon, 01 Mar 2100 00:00:06 GMT",
        "Monday, 01-Mar-00 00:00:06 GMT",
        "Mon Mar  1 00:00:06 2100"
      ]
    ],
    [
      "2399-12-31T23:59:59Z",
      "2400-02-29T00:00:06Z",
      [
        "Tue, 29 Feb 2400 00:00:06 GMT",
        "Tuesday, 29-Feb-00 00:00:06 GMT",
        "Tue Feb 29 00:00:06 2400"
      ]
    ],
    [
      "2026-12-31T23:59:58.250Z",
      "2027-01-01T00:00:00Z",
      [
        "Thu, 31 Dec 2026 23:59:60 GMT",
        "Thursday, 31-Dec-26 23:59:60 GMT",
        "Thu Dec 31 23:59:60 2026"
      ]
    ]
  ]) {
    now = Date.parse(current);
    for (const hint of hints) {
      const delay = Date.parse(expected) - now;
      assert.equal(parseRetryAfterMs(hint, now), delay, hint);
      assert.equal(apiError(hint, hintBody(1)).retryAfterMs, delay, hint);
      for (const phase of ["AUTH", "REGISTER"]) {
        assert.equal(
          (await httpConnectionFailure(response(hint), phase)).retryAfterMs,
          delay,
          hint
        );
      }
    }
  }
  // 小数秒保留 REST 兼容，只移除 HTTP 外层可选空白。
  assert.equal(parseRetryAfterMs("\t 1.25 \t", now), 1250);
});

test("HTTP-date round trips across a Gregorian cycle and rejects month overflow", () => {
  const longWeekdays = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday"
  ];
  for (let year = 2000; year < 2400; year++) {
    for (let month = 0; month < 12; month++) {
      const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      for (const day of [1, lastDay]) {
        const at = Date.UTC(year, month, day, 8, 9, 6);
        const date = new Date(at);
        const [weekday, dd, mon, yyyy, time] = date.toUTCString().split(" ");
        for (const hint of [
          date.toUTCString(),
          `${longWeekdays[date.getUTCDay()]}, ${dd}-${mon}-${yyyy.slice(-2)} ${time} GMT`,
          `${weekday.slice(0, 3)} ${mon} ${String(day).padStart(2, " ")} ${time} ${yyyy}`
        ])
          assert.equal(parseRetryAfterMs(hint, at - 5750), 5750, hint);
      }
      // 使用顺延后的星期，确保无效日历不会被星期不匹配提前拦截。
      const next = new Date(Date.UTC(year, month + 1, 1));
      const weekday = next.toUTCString().slice(0, 3);
      const mon = new Date(Date.UTC(year, month, 1)).toUTCString().split(" ")[2];
      const hint = `${weekday}, ${lastDay + 1} ${mon} ${year} 08:09:06 GMT`;
      assert.equal(parseRetryAfterMs(hint, next.getTime() - 5750), undefined, hint);
    }
  }
});

async function httpFixture(t, respond) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({ at: Date.now(), path: req.url, body: JSON.parse(body) });
      respond(res, requests.length);
    });
  });
  t.after(async () => {
    const closed = new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    server.closeAllConnections();
    await closed;
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const apiUrl = `http://127.0.0.1:${server.address().port}`;
  const botToken = randomUUID();
  return {
    requests,
    send: (signal) =>
      sendMessage({
        apiUrl,
        botToken,
        channelId: "retry-fixture",
        channelType: 2,
        content: "retry fixture",
        signal
      }),
    post: (signal, opts) => postJson(apiUrl, botToken, "/fixture", {}, signal, opts)
  };
}

function limited(res, hint) {
  res.writeHead(429, { "Retry-After": hint });
  res.end("{}");
}

function success(res) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message_id: "fixture-message" }));
}

test(
  "real HTTP message retry never precedes the advertised date",
  { timeout: 15_000 },
  async (t) => {
    let earliest;
    const f = await httpFixture(t, (res, attempt) => {
      if (attempt === 1) {
        earliest = Math.ceil(Date.now() / 1000) * 1000 + 2000;
        limited(res, new Date(earliest).toUTCString());
      } else success(res);
    });
    const result = await f.send();
    assert.equal(result.message_id, "fixture-message");
    assert.equal(f.requests.length, 2);
    assert.ok(f.requests[1].at >= earliest, `retried ${earliest - f.requests[1].at} ms early`);
    assert.equal(f.requests[0].path, "/v1/bot/sendMessage");
    assert.equal(f.requests[1].body.client_msg_no, f.requests[0].body.client_msg_no);
  }
);

test(utcRegressionNames[1], { timeout: 15_000 }, async (t) => {
  let earliest;
  const f = await httpFixture(t, (res, attempt) => {
    if (attempt === 1) {
      earliest = Math.ceil(Date.now() / 1000) * 1000 + 2000;
      const asctime = new Date(earliest)
        .toUTCString()
        .replace(/^(\w{3}), (\d{2}) (\w{3}) (\d{4}) (\d{2}:\d{2}:\d{2}) GMT$/, "$1 $3 $2 $5 $4");
      limited(res, asctime);
    } else success(res);
  });
  const result = await f.send();
  assert.equal(result.message_id, "fixture-message");
  assert.equal(f.requests.length, 2);
  assert.ok(f.requests[1].at >= earliest, `retried ${earliest - f.requests[1].at} ms early`);
  assert.equal(f.requests[1].body.client_msg_no, f.requests[0].body.client_msg_no);
});

test("real HTTP numeric seconds retain their minimum wait", { timeout: 5000 }, async (t) => {
  const f = await httpFixture(t, (res, attempt) =>
    attempt === 1 ? limited(res, "0.1") : success(res)
  );
  await f.send();
  assert.equal(f.requests.length, 2);
  assert.ok(f.requests[1].at - f.requests[0].at >= 100);
});

test("real HTTP malformed numeric hint uses the fallback retry", { timeout: 5000 }, async (t) => {
  const f = await httpFixture(t, (res, attempt) =>
    attempt === 1 ? limited(res, "0x10") : success(res)
  );
  assert.equal((await f.send()).message_id, "fixture-message");
  assert.equal(f.requests.length, 2);
  assert.ok(f.requests[1].at - f.requests[0].at >= DEFAULT_RETRY_AFTER_MS);
});

test("real HTTP over-budget date returns 429 without retrying", async (t) => {
  const f = await httpFixture(t, (res) =>
    limited(res, new Date(Date.now() + MAX_RETRY_AFTER_MS + 5000).toUTCString())
  );
  await assert.rejects(f.send(), (error) => {
    assert.ok(error instanceof OctoApiError);
    assert.equal(error.status, 429);
    assert.ok(error.retryAfterMs > MAX_RETRY_AFTER_MS);
    return true;
  });
  assert.equal(f.requests.length, 1);
});

test(utcRegressionNames[3], { timeout: 5000 }, async (t) => {
  t.mock.method(Date, "now", () => fixedNow);
  const f = await httpFixture(t, (res) => limited(res, "Sunday, 06-Nov-50 08:49:37 GMT"));
  await assert.rejects(f.send(), (error) => {
    assert.ok(error instanceof OctoApiError);
    assert.equal(error.retryAfterMs, Date.parse("2050-11-06T08:49:37Z") - fixedNow);
    assert.ok(error.retryAfterMs > MAX_RETRY_AFTER_MS);
    return true;
  });
  assert.equal(f.requests.length, 1);
});

test("real HTTP persistent 429 stops after two retries", { timeout: 5000 }, async (t) => {
  const f = await httpFixture(t, (res) => limited(res, "0.01"));
  await assert.rejects(f.send(), OctoApiError);
  assert.equal(f.requests.length, MAX_429_RETRIES + 1);
  assert.equal(f.requests.length, 3);
});

test("real HTTP numeric conversion overflow remains over budget", { timeout: 5000 }, async (t) => {
  const f = await httpFixture(t, (res) => limited(res, "1" + "0".repeat(308)));
  await assert.rejects(f.send(), (error) => {
    assert.ok(error instanceof OctoApiError);
    assert.equal(error.retryAfterMs, Infinity);
    return true;
  });
  assert.equal(f.requests.length, 1);
});

test("real HTTP retry opt-out sends only the original request", async (t) => {
  const f = await httpFixture(t, (res) => limited(res, "0.01"));
  await assert.rejects(f.post(undefined, { retryOn429: false }), OctoApiError);
  assert.equal(f.requests.length, 1);
});

test("abort during a date backoff prevents another real HTTP request", async (t) => {
  const controller = new AbortController();
  t.mock.method(console, "warn", () => queueMicrotask(() => controller.abort()));
  const f = await httpFixture(t, (res) => limited(res, new Date(Date.now() + 6000).toUTCString()));
  await assert.rejects(f.send(controller.signal), (error) => {
    assert.ok(error.cause instanceof OctoApiError);
    assert.match(error.message, /aborted while backing off/);
    return true;
  });
  assert.equal(f.requests.length, 1);
});

test("cumulative backoff budget rejects the next wait without shortening it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: fixedNow });
  t.mock.method(Math, "random", () => 0);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return response(new Date(Date.now() + 9000).toUTCString());
  });
  const result = assert.rejects(
    postJson("http://127.0.0.1", randomUUID(), "/fixture", {}),
    (error) => {
      assert.ok(error instanceof OctoApiError);
      assert.equal(error.retryAfterMs, 9000);
      return true;
    }
  );
  await nextTurn();
  assert.equal(calls, 1);
  const firstWait = 8750;
  assert.ok(firstWait + 9000 > MAX_429_BACKOFF_WAIT_MS);
  t.mock.timers.tick(firstWait - 1);
  await nextTurn();
  assert.equal(calls, 1);
  t.mock.timers.tick(1);
  await result;
  assert.equal(calls, 2);
});
