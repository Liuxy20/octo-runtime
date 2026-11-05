import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { readRegistryIntegrity, registryErrorCode } from "./check-release-registry.mjs";

const execute = promisify(execFile);
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parts(version) {
  if (!stableVersion.test(version)) throw new Error(`不是稳定 SemVer：${version}`);
  return version.split(".").map(BigInt);
}

export function compareStableVersions(left, right) {
  const leftParts = parts(left);
  const rightParts = parts(right);
  for (let index = 0; index < leftParts.length; index++) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}

export function classifyVersion(candidate, latest) {
  if (latest === null) return "first";
  const comparison = compareStableVersions(candidate, latest);
  if (comparison > 0) return "newer";
  if (comparison < 0) return "older";
  return "equal";
}

export function selectHighestCompleteVersion(completeVersions) {
  if (completeVersions.length === 0)
    throw new Error("没有同时完成 npm 与 GitHub Release 的稳定版本");
  return [...new Set(completeVersions)].sort(compareStableVersions).at(-1);
}

function selectLatestFloor(...latestVersions) {
  const versions = latestVersions.filter((version) => version !== null && version !== undefined);
  return versions.length === 0 ? null : selectHighestCompleteVersion(versions);
}

export async function reconcileLatest(
  client,
  {
    maxAttempts = 5,
    dryRun = false,
    candidate = null,
    retryDelay = () => new Promise((resolve) => setTimeout(resolve, 2000))
  } = {}
) {
  if (candidate !== null) {
    if (!dryRun) throw new Error("--candidate 仅能与 --dry-run 一起使用");
    if (candidate === "0.0.0" || !stableVersion.test(candidate))
      throw new Error(`候选版本不是可发布的稳定 SemVer：${candidate}`);
  }
  let observed;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const before = await client.readState();
    // 候选只参与发布前模拟；远端完整性证据始终来自 readState，不能被候选输入补造。
    const plannedVersions =
      candidate === null ? before.completeVersions : [...before.completeVersions, candidate];
    const latestFloor = selectLatestFloor(
      before.npmLatest,
      before.clientNpmLatest,
      before.githubLatest
    );
    const paired = Object.hasOwn(before, "clientNpmLatest");
    if (plannedVersions.length === 0 && latestFloor !== null) {
      if (!dryRun && attempt < maxAttempts) {
        await retryDelay();
        continue;
      }
      throw new Error(
        `当前 latest ${latestFloor} 暂时没有完整 Release 资产：${JSON.stringify(before)}`
      );
    }
    const target = selectHighestCompleteVersion(plannedVersions);
    const relation = classifyVersion(target, before.npmLatest);
    if (latestFloor !== null && compareStableVersions(target, latestFloor) < 0) {
      if (!dryRun && attempt < maxAttempts) {
        await retryDelay();
        continue;
      }
      throw new Error(
        `拒绝把 latest 从 ${latestFloor} 回退到暂时完整的 ${target}：${JSON.stringify(before)}`
      );
    }
    const actions = [
      ...(before.npmLatest === target ? [] : [["npm", target]]),
      ...(!paired || before.clientNpmLatest === target ? [] : [["npm-client", target]]),
      ...(before.githubLatest === target ? [] : [["github", target]])
    ];

    if (dryRun) {
      const targetVerified = before.completeVersions.includes(target);
      return {
        target,
        relation,
        attempts: attempt,
        targetVerified,
        ...(candidate === null
          ? {}
          : {
              candidate: {
                version: candidate,
                verified: before.completeVersions.includes(candidate)
              }
            }),
        actions: targetVerified ? actions : [],
        ...(!targetVerified
          ? {
              conditionalActions: actions,
              warning:
                "Candidate release completeness is not verified. This is a simulation, not release readiness; conditional actions require successful publication and integrity verification."
            }
          : {})
      };
    }

    if (before.npmLatest !== target) await client.setNpmLatest(target);
    if (paired && before.clientNpmLatest !== target) await client.setClientNpmLatest(target);
    if (before.githubLatest !== target) await client.setGitHubLatest(target);

    observed = await client.readState();
    if (observed.completeVersions.length === 0) {
      if (attempt < maxAttempts) {
        await retryDelay();
        continue;
      }
      throw new Error(`写入后没有完整 Release 资产：${JSON.stringify(observed)}`);
    }
    const expected = selectHighestCompleteVersion(observed.completeVersions);
    if (
      observed.npmLatest === expected &&
      observed.githubLatest === expected &&
      (!paired || observed.clientNpmLatest === expected)
    ) {
      return { target: expected, relation, attempts: attempt };
    }
  }
  throw new Error(`latest 状态在 ${maxAttempts} 次协调后仍未收敛：${JSON.stringify(observed)}`);
}

async function run(command, arguments_, options) {
  const { stdout } = await execute(command, arguments_, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    ...options
  });
  return stdout.trim();
}

async function npmView(runCommand, packageName, field) {
  let output;
  try {
    output = await runCommand(
      "npm",
      [
        "view",
        packageName,
        field,
        "--json",
        "--registry=https://registry.npmjs.org",
        "--prefer-online",
        "--fetch-retries=0"
      ],
      { timeout: 30_000 }
    );
  } catch (error) {
    if (registryErrorCode(error) === "E404") return null;
    throw error;
  }
  try {
    JSON.parse(output);
  } catch {
    throw new Error(`Invalid npm registry JSON response: ${packageName} ${field}`);
  }
  return output;
}

function stableLatest(output) {
  const version = output === null ? null : JSON.parse(output);
  return typeof version === "string" && version !== "0.0.0" && stableVersion.test(version)
    ? version
    : null;
}

export function createCommandClient({ packageName, repository, runCommand = run, paired = false }) {
  const clientName = "@mininglamp-oss/octo-runtime-client";
  async function readReleaseIntegrity(version, archive) {
    const directory = await mkdtemp(join(tmpdir(), "octo-release-integrity-"));
    try {
      await runCommand(
        "gh",
        [
          "release",
          "download",
          `v${version}`,
          "--pattern",
          archive,
          "--dir",
          directory,
          "--repo",
          repository
        ],
        { timeout: 120_000 }
      );
      return `sha512-${createHash("sha512")
        .update(await readFile(join(directory, archive)))
        .digest("base64")}`;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  return {
    async readState() {
      const versionsOutput = await npmView(runCommand, packageName, "versions");
      const parsedVersions = versionsOutput === null ? [] : JSON.parse(versionsOutput);
      const npmVersions = (
        Array.isArray(parsedVersions) ? parsedVersions : [parsedVersions]
      ).filter(
        (version) =>
          typeof version === "string" && version !== "0.0.0" && stableVersion.test(version)
      );
      const latestOutput = await npmView(runCommand, `${packageName}@latest`, "version");
      const npmLatest = stableLatest(latestOutput);
      let clientVersions;
      let clientNpmLatest;
      if (paired) {
        const output = await npmView(runCommand, clientName, "versions");
        const versions = output === null ? [] : JSON.parse(output);
        clientVersions = new Set(Array.isArray(versions) ? versions : [versions]);
        clientNpmLatest = stableLatest(
          await npmView(runCommand, `${clientName}@latest`, "version")
        );
      }
      const releases = JSON.parse(
        await runCommand("gh", [
          "release",
          "list",
          "--limit",
          "1000",
          "--json",
          "tagName,isDraft,isPrerelease,isLatest",
          "--repo",
          repository
        ])
      );
      const byVersion = new Map(
        releases
          .filter(
            (release) =>
              !release.isDraft &&
              !release.isPrerelease &&
              release.tagName.startsWith("v") &&
              stableVersion.test(release.tagName.slice(1))
          )
          .map((release) => [release.tagName.slice(1), release])
      );
      const completeVersions = [];
      for (const version of npmVersions.sort(compareStableVersions).reverse()) {
        if (paired && !clientVersions.has(version)) continue;
        if (!byVersion.has(version)) continue;
        const release = JSON.parse(
          await runCommand("gh", [
            "release",
            "view",
            `v${version}`,
            "--json",
            "assets",
            "--repo",
            repository
          ])
        );
        const names = [packageName, ...(paired ? [clientName] : [])];
        const archives = names.map(
          (name) => `${name.replace(/^@/, "").replace("/", "-")}-${version}.tgz`
        );
        if (archives.every((archive) => release.assets.some((asset) => asset.name === archive))) {
          for (const [index, name] of names.entries()) {
            const npmIntegrity = await readRegistryIntegrity(
              version,
              "https://registry.npmjs.org",
              {
                runCommand,
                name
              }
            );
            if (npmIntegrity === null)
              throw new Error(`Missing npm archive integrity: ${name}@${version}`);
            if ((await readReleaseIntegrity(version, archives[index])) !== npmIntegrity)
              throw new Error(`GitHub Release archive integrity mismatch: ${name}@${version}`);
          }
          completeVersions.push(version);
          break;
        }
      }
      const latestRelease = releases.find((release) => release.isLatest);
      const githubLatest =
        latestRelease?.tagName.startsWith("v") && stableVersion.test(latestRelease.tagName.slice(1))
          ? latestRelease.tagName.slice(1)
          : null;
      return {
        completeVersions,
        npmLatest,
        githubLatest,
        ...(paired ? { clientNpmLatest } : {})
      };
    },
    async setNpmLatest(version) {
      await runCommand("npm", [
        "dist-tag",
        "add",
        `${packageName}@${version}`,
        "latest",
        "--registry=https://registry.npmjs.org"
      ]);
    },
    async setClientNpmLatest(version) {
      await runCommand("npm", [
        "dist-tag",
        "add",
        `${clientName}@${version}`,
        "latest",
        "--registry=https://registry.npmjs.org"
      ]);
    },
    async setGitHubLatest(version) {
      await runCommand("gh", ["release", "edit", `v${version}`, "--latest", "--repo", repository]);
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const packageName = process.env.OCTO_RELEASE_PACKAGE ?? "@mininglamp-oss/octo-runtime";
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) throw new Error("缺少 GITHUB_REPOSITORY");
  const dryRun = process.argv.includes("--dry-run");
  const candidateIndex = process.argv.indexOf("--candidate");
  const candidate = candidateIndex === -1 ? null : (process.argv[candidateIndex + 1] ?? null);
  if (dryRun && candidate === null) throw new Error("dry-run 缺少 --candidate VERSION");
  if (!dryRun && candidate !== null) throw new Error("--candidate 仅能与 --dry-run 一起使用");
  const result = await reconcileLatest(
    createCommandClient({ packageName, repository, paired: process.argv.includes("--paired") }),
    {
      dryRun,
      candidate
    }
  );
  console.log(JSON.stringify(result));
}
