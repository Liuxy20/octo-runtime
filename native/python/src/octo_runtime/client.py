"""Native attached Kernel SDK; the caller owns cancellation, draining and closing."""

from __future__ import annotations
import asyncio
import copy
import json
import math
import re
import sys
import uuid
from contextlib import suppress
from decimal import Decimal
from urllib.parse import urlsplit
from . import octo_runtime_generated as models
from .octo_runtime_generated import RULES, DEFINITIONS, METHODS, BEHAVIOR, RPCMethods

B = BEHAVIOR

class KernelError(Exception):
    def __init__(self, code: str, data=None, *, remote=False):
        super().__init__(code)
        self.code, self.data, self.remote = code, data, remote


UNSET = object()


def normalize(value):
    """Copy JSON containers while omitting UNSET fields; preserve null, zero values and opaque numbers."""

    def visit(v):
        if isinstance(v, dict):
            return {k: visit(x) for k, x in v.items() if x is not UNSET}
        if isinstance(v, list):
            return [visit(x) for x in v]
        return v

    try:
        return visit(value)
    except RecursionError as e:
        raise KernelError("INVALID_JSON") from e


def dumps(value) -> bytes:
    def encode(v):
        if v is None:
            return "null"
        if v is True:
            return "true"
        if v is False:
            return "false"
        if isinstance(v, str):
            if any(0xD800 <= ord(c) <= 0xDFFF for c in v):
                raise KernelError("INVALID_JSON_UNICODE")
            return json.dumps(v, ensure_ascii=False, separators=(",", ":"))
        if isinstance(v, (int, Decimal)):
            if isinstance(v, Decimal) and not v.is_finite():
                raise KernelError("INVALID_JSON_NUMBER")
            return str(v)
        if isinstance(v, float):
            if not math.isfinite(v):
                raise KernelError("INVALID_JSON_NUMBER")
            return repr(v)
        if isinstance(v, (list, tuple)):
            return "[" + ",".join(encode(x) for x in v) + "]"
        if isinstance(v, dict):
            if any(not isinstance(k, str) for k in v):
                raise KernelError("INVALID_JSON_KEY")
            return (
                "{"
                + ",".join(
                    encode(k) + ":" + encode(x) for k, x in v.items() if x is not UNSET
                )
                + "}"
            )
        raise KernelError("INVALID_JSON_VALUE")

    try:
        return encode(value).encode("utf-8")
    except (RecursionError, UnicodeError) as e:
        raise KernelError("INVALID_JSON") from e


def loads(data: bytes):
    def constant(_):
        raise KernelError("INVALID_JSON_NUMBER")

    try:
        value = json.loads(
            data.decode("utf-8", errors="strict"),
            parse_float=Decimal,
            parse_constant=constant,
        )
        dumps(value)  # Reject decoded lone surrogates instead of replacing invalid strings.
        return value
    except (ValueError, UnicodeError, RecursionError) as e:
        raise KernelError("INVALID_JSON") from e


def validate(definition: str, value):
    # Return independent containers so identity defaults and copies operate only on present fields.
    value = normalize(value)
    dumps(value)
    check(DEFINITIONS[definition], value)
    return value


def decode(definition: str, data: bytes):
    return validate(definition, loads(data))


def encode(definition: str, value) -> bytes:
    return dumps(validate(definition, value))


def check(index, value, path="$"):
    r = RULES[index]

    def bad():
        raise KernelError("VALIDATION_ERROR", {"path": path})

    def number(v):
        return isinstance(v, (int, Decimal, float)) and not isinstance(v, bool)

    def equal(a, b):
        if isinstance(a, bool) != isinstance(b, bool):
            return False
        return a == b

    def matches(i):
        try:
            check(i, value, path)
            return True
        except KernelError:
            return False

    if "ref" in r:
        return check(r["ref"], value, path)
    if "type" in r:
        types = r["type"] if isinstance(r["type"], list) else [r["type"]]
        predicates = {
            "null": value is None,
            "boolean": isinstance(value, bool),
            "string": isinstance(value, str),
            "array": isinstance(value, list),
            "object": isinstance(value, dict),
            "number": number(value),
            "integer": number(value) and value == int(value),
        }
        if not any(predicates[t] for t in types):
            bad()
    if "const" in r and not equal(value, r["const"]):
        bad()
    if "enum" in r and not any(equal(value, x) for x in r["enum"]):
        bad()
    if number(value):
        if "minimum" in r and value < r["minimum"]:
            bad()
        if "maximum" in r and value > r["maximum"]:
            bad()
    if isinstance(value, str):
        if len(value) < r.get("minLength", 0) or len(value) > r.get(
            "maxLength", math.inf
        ):
            bad()
        if "pattern" in r and re.search(r["pattern"], value) is None:
            bad()
    if isinstance(value, dict):
        if len(value) < r.get("minProperties", 0) or len(value) > r.get(
            "maxProperties", math.inf
        ):
            bad()
        if any(k not in value for k in r.get("required", [])):
            bad()
        for k, v in value.items():
            if "propertyNames" in r:
                check(r["propertyNames"], k, path)
            if k in r.get("properties", {}):
                check(r["properties"][k], v, path + "." + k)
            elif r.get("strict"):
                bad()
            elif "additionalProperties" in r:
                check(r["additionalProperties"], v, path + "." + k)
    if isinstance(value, list):
        if len(value) < r.get("minItems", 0) or len(value) > r.get(
            "maxItems", math.inf
        ):
            bad()
        if "items" in r:
            for i, v in enumerate(value):
                check(r["items"], v, f"{path}[{i}]")
        if r.get("uniqueItems") and any(
            equal(value[i], value[j]) for i in range(len(value)) for j in range(i)
        ):
            bad()
        if "contains" in r:
            found = False
            for v in value:
                try:
                    check(r["contains"], v, path)
                    found = True
                    break
                except KernelError:
                    pass
            if not found:
                bad()
    for i in r.get("allOf", []):
        check(i, value, path)
    if "oneOf" in r and sum(matches(i) for i in r["oneOf"]) != 1:
        bad()
    if "anyOf" in r and not any(matches(i) for i in r["anyOf"]):
        bad()
    if "not" in r and matches(r["not"]):
        bad()
    if "if" in r:
        branch = "then" if matches(r["if"]) else "else"
        if branch in r:
            check(r[branch], value, path)
    for extension, limit in r.get("extensions", {}).items():
        if extension == "x-octo-unicode-scalar-strings":
            pass  # validated at the codec boundary
        elif extension == "x-octo-max-json-bytes":
            if len(dumps(value)) > limit:
                bad()
        elif extension == "x-octo-max-json-depth":

            def depth(v):
                return (
                    1
                    + max(
                        (depth(x) for x in (v.values() if isinstance(v, dict) else v)),
                        default=0,
                    )
                    if isinstance(v, (list, dict)) and v
                    else 0
                )

            if depth(value) > limit:
                bad()
        elif extension == "x-octo-max-utf8-bytes":
            if isinstance(value, str) and len(value.encode("utf-8")) > limit:
                bad()
        elif extension == "x-octo-max-utf16-length":
            if isinstance(value, str) and len(value.encode("utf-16-le")) // 2 > limit:
                bad()
        elif extension == "x-octo-http-url":
            if isinstance(value, str):
                try:
                    u = urlsplit(value)
                    if (
                        u.scheme not in ("http", "https")
                        or not u.hostname
                        or u.username is not None
                        or any(c.isspace() for c in u.hostname)
                    ):
                        bad()
                    # Reading port validates its syntax and range; urlsplit alone only splits the authority.
                    _ = u.port
                except ValueError:
                    bad()
        elif extension == "x-octo-unique-header-names":
            if len({k.lower() for k in value}) != len(value):
                bad()
        elif extension in (
            "x-octo-unique-type-keys",
            "x-octo-unique-env-keys",
            "x-octo-unique-resource-refs",
        ):
            field, keys = {
                "x-octo-unique-type-keys": ("items", ["namespace", "name"]),
                "x-octo-unique-env-keys": ("env_variables", ["key"]),
                "x-octo-unique-resource-refs": ("entries", ["resource_ref"]),
            }[extension]
            a = value[field]
            if len({tuple(x[k] for k in keys) for x in a}) != len(a):
                bad()
        elif extension == "x-octo-matching-trigger-fields":
            fact = value["trigger_fact"]
            if (
                value["trigger_message_id"] != fact["message_id"]
                or ("trigger_seq" in value) != ("message_seq" in fact)
                or value.get("trigger_seq") != fact.get("message_seq")
            ):
                bad()
        elif extension == "x-octo-runtime-selection-invariants":
            a = value["authorized_candidates"]
            ids = {x["runtime_id"] for x in a}
            priorities = {x["priority"] for x in a}
            if len(ids) != len(a) or len(priorities) != len(a):
                bad()
            if value["selection_mode"] == "explicit":
                if (
                    len(a) != 1
                    or value.get("explicit_runtime_id") not in ids
                    or value["failover"] != "none"
                ):
                    bad()
            elif "explicit_runtime_id" in value:
                bad()
        else:
            raise RuntimeError("unsupported compiled refinement " + extension)


if sys.platform == "win32":
    import win32file
    import win32event
    import win32con
    import pywintypes


class _WindowsPipe:
    """Private asynchronous named-pipe IO; retain resources until OVERLAPPED completion."""

    def __init__(self, handle):
        self.handle, self.pending, self.closed = handle, set(), False
        self._closing = None

    async def operation(self, data=None, n=65536):
        if self.closed:
            raise OSError("closed")
        ov = pywintypes.OVERLAPPED()
        ov.hEvent = win32event.CreateEvent(None, True, False, None)
        # Allow one pending IO operation per connection, with at most 32 connections per client.
        self.pending.add(ov)
        buffer = None
        try:
            if data is None:
                _, buffer = win32file.ReadFile(self.handle, n, ov)
            else:
                buffer = data
                win32file.WriteFile(self.handle, buffer, ov)

            async def completion():
                while (
                    win32event.WaitForSingleObject(ov.hEvent, 0)
                    == win32con.WAIT_TIMEOUT
                ):
                    await asyncio.sleep(0.002)
                return win32file.GetOverlappedResult(self.handle, ov, False)

            task = asyncio.create_task(completion())
            try:
                count = await asyncio.shield(task)
            except asyncio.CancelledError:
                cancellation_error = None
                try:
                    win32file.CancelIoEx(self.handle, ov)
                except pywintypes.error as e:
                    if e.winerror != 1168:
                        cancellation_error = e
                # CancelIoEx failure does not confirm completion; retain the buffer and event.
                while not task.done():
                    try:
                        await asyncio.shield(task)
                    except asyncio.CancelledError:
                        continue
                    except pywintypes.error:
                        break
                if task.done() and not task.cancelled():
                    try:
                        task.result()
                    except pywintypes.error:
                        pass
                if cancellation_error is not None:
                    raise cancellation_error
                raise
            return bytes(buffer[:count]) if data is None else count
        except pywintypes.error as e:
            raise OSError(e.winerror, "pipe IO failed") from e
        finally:
            self.pending.discard(ov)
            win32file.CloseHandle(ov.hEvent)

    async def read(self, n):
        return await self.operation(n=n)

    async def write(self, data):
        while data:
            count = await self.operation(data=data)
            if count <= 0:
                raise OSError("partial write")
            data = data[count:]

    async def close(self):
        # Share cleanup across closes; caller cancellation cannot release handles before completion.
        if self._closing is None:
            self.closed = True
            self._closing = asyncio.create_task(self._finish_close())
        interrupted = False
        while not self._closing.done():
            try:
                await asyncio.shield(self._closing)
            except asyncio.CancelledError:
                interrupted = True
        self._closing.result()
        if interrupted:
            raise asyncio.CancelledError

    async def _finish_close(self):
        cancellation_error = None
        for ov in list(self.pending):
            try:
                win32file.CancelIoEx(self.handle, ov)
            except pywintypes.error as e:
                if e.winerror != 1168:
                    cancellation_error = e
        while self.pending:
            await asyncio.sleep(0.002)
        win32file.CloseHandle(self.handle)
        if cancellation_error is not None:
            raise cancellation_error


async def _open_windows_pipe(endpoint):
    while True:
        try:
            handle = win32file.CreateFile(
                endpoint,
                win32con.GENERIC_READ | win32con.GENERIC_WRITE,
                0,
                None,
                win32con.OPEN_EXISTING,
                win32con.FILE_FLAG_OVERLAPPED,
                None,
            )
            return _WindowsPipe(handle)
        except pywintypes.error as e:
            if e.winerror != 231:
                raise OSError(e.winerror, "pipe connect failed") from e
            await asyncio.sleep(0.01)


class _UnixChannel:
    def __init__(self, reader, writer):
        self.reader, self.writer = reader, writer

    async def read(self, n):
        return await self.reader.read(n)

    async def write(self, data):
        self.writer.write(data)
        await self.writer.drain()

    async def close(self):
        # Abort queued writes during cleanup so a non-reading peer cannot outlive the RPC deadline.
        # Already-written requests may execute; the RPC layer preserves uncertain outcomes.
        self.writer.transport.abort()
        self.writer.close()
        try:
            await self.writer.wait_closed()
        except (OSError, ConnectionError):
            pass


class _Channel:
    def __init__(self, stream, owner):
        self.stream, self.owner, self.buffer, self.closed = (
            stream,
            owner,
            bytearray(),
            False,
        )

    async def line(self):
        maximum = BEHAVIOR["limits"]["lineBytes"]
        scanned = 0
        while True:
            # Do not rescan prefixes without newlines; scan the next buffered line from zero.
            offset = self.buffer.find(b"\n", scanned)
            if offset >= 0:
                if offset > maximum:
                    raise KernelError("HOST_FRAME_TOO_LARGE")
                line = bytes(self.buffer[:offset])
                del self.buffer[: offset + 1]
                return line
            if len(self.buffer) > maximum:
                raise KernelError("HOST_FRAME_TOO_LARGE")
            scanned = len(self.buffer)
            try:
                chunk = await self.stream.read(BEHAVIOR["limits"]["readChunkBytes"])
            except OSError as e:
                raise KernelError("CONNECTION_CLOSED") from e
            if not chunk:
                raise KernelError("CONNECTION_CLOSED")
            self.buffer.extend(chunk)

    async def write(self, data):
        try:
            await self.stream.write(data)
        except OSError as e:
            raise KernelError("CONNECTION_CLOSED") from e

    async def close(self):
        if self.closed:
            return
        self.closed = True
        try:
            await self.stream.close()
        finally:
            self.owner.channels.discard(self)


class _Transport:
    def __init__(self, endpoint):
        self.endpoint, self.channels, self.opening, self.closed = (
            endpoint,
            set(),
            0,
            False,
        )

    async def open(self):
        if self.closed:
            raise KernelError("CLIENT_CLOSED")
        if len(self.channels) + self.opening >= BEHAVIOR["limits"]["connections"]:
            raise KernelError("CLIENT_CAPACITY_EXHAUSTED")
        self.opening += 1
        try:
            async with asyncio.timeout(BEHAVIOR["timeoutsMs"]["connect"] / 1000):
                if sys.platform == "win32":
                    stream = await _open_windows_pipe(self.endpoint)
                else:
                    r, w = await asyncio.open_unix_connection(
                        self.endpoint, limit=BEHAVIOR["limits"]["readChunkBytes"]
                    )
                    stream = _UnixChannel(r, w)
            if self.closed:
                await stream.close()
                raise KernelError("CLIENT_CLOSED")
            c = _Channel(stream, self)
            self.channels.add(c)
            return c
        except (OSError, TimeoutError) as e:
            raise KernelError("KERNEL_UNAVAILABLE") from e
        finally:
            self.opening -= 1

    async def close(self):
        self.closed = True
        await asyncio.gather(*(c.close() for c in list(self.channels)))


class CancelToken:
    """Request execution cancellation explicitly; Task.cancel and aclose only stop observation."""

    def __init__(self):
        self.event = asyncio.Event()
        self.reason = "caller_aborted"

    def cancel(self, reason="caller_aborted"):
        self.reason = reason
        self.event.set()

    @property
    def cancelled(self):
        return self.event.is_set()

    def check(self):
        if self.cancelled:
            raise KernelError("CALLER_ABORTED", {"reason": self.reason})


def identity(actual, expected, full=False):
    if (
        "kernel_instance_id" in expected
        and actual.get("kernel_instance_id") != expected["kernel_instance_id"]
    ):
        raise KernelError("KERNEL_INSTANCE_CHANGED")
    if any(
        actual.get(k) != expected.get(k)
        for k in B["receiptFields" if full else "lookupFields"]
    ):
        raise KernelError("RUN_IDENTITY_MISMATCH")


def terminal(frame):
    if (
        frame
        and frame.get("kind") == "control"
        and frame["control"]["type"] == "state"
        and frame["control"]["state"] in B["terminalStates"]
    ):
        return frame["control"]["state"]
    return None


def identify(input):
    request = validate("InvokeInputWire", input)
    for k in ("runId", "invocationId", "sessionId"):
        request.setdefault(k, str(uuid.uuid4()))
    for k, v in B["defaults"].items():
        request.setdefault(B["identityInputFields"][k], v)
    return request


def lookup(input):
    return {k: input[v] for k, v in B["identityInputFields"].items()}


def response(value, id):
    if (
        not isinstance(value, dict)
        or value.get("jsonrpc") != "2.0"
        or value.get("id") != id
        or ("result" in value) == ("error" in value)
    ):
        raise KernelError("INVALID_RESPONSE")
    try:
        validate(
            "IpcErrorResponse" if "error" in value else "IpcSuccessResponse", value
        )
    except KernelError as e:
        raise KernelError("INVALID_RESPONSE") from e
    if "error" in value:
        data = value["error"]["data"]
        raise KernelError(data["code"], data, remote=True)
    return value["result"]


class Client(RPCMethods):
    """Attach to an existing Kernel; the owner stops admission, drains, then closes this client."""

    topology = "kernel-ipc"
    ownership = "attached"

    def __init__(self, endpoint):
        self.transport = _Transport(endpoint)
        self.records = {}
        self.stopped = False
        self.controls = asyncio.Semaphore(B["limits"]["controlConcurrency"])
        self.background = set()
        self._draining = None
        self._drain_deadline = None
        self._control_timeouts = set()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        await self.close()

    def _task(self, coro):
        task = asyncio.create_task(coro)
        self.background.add(task)

        def finish(t):
            self.background.discard(t)
            if not t.cancelled():
                t.exception()  # The registry owns the result; consume the exception to avoid an unhandled-task warning.

        task.add_done_callback(finish)
        return task

    async def close(self):
        """Close this client's observation and control IO without cancelling runs or confirming their outcomes."""
        self.stop_admission()
        await self.transport.close()
        # Close observation and control requests without sending new execution cancellations.
        for task in list(self.background):
            task.cancel()
        await asyncio.gather(*list(self.background), return_exceptions=True)

    async def _rpc(self, method, params, before_write=None, timeout=None):
        # Normalize absent fields before validation and encoding; never replay uncertain side effects.
        rule = METHODS[method]
        params = normalize(params)
        check(rule["params"], params)
        id = str(uuid.uuid4())
        line = (
            dumps({"jsonrpc": "2.0", "id": id, "method": method, "params": params})
            + b"\n"
        )
        if len(line) > B["limits"]["requestBytes"]:
            raise KernelError("INVOKE_REQUEST_TOO_LARGE")
        conn = None
        sent = False
        try:
            async with asyncio.timeout(
                timeout
                or B["timeoutsMs"][
                    "invokeAck" if method == "agent_run.invoke" else "unary"
                ]
                / 1000
            ):
                conn = await self.transport.open()
                if before_write:
                    before_write()
                sent = True
                await conn.write(line)
                result = response(loads(await conn.line()), id)
                try:
                    check(rule["result"], result)
                except KernelError as e:
                    raise KernelError("INVALID_RESPONSE") from e
                return result
        except (TimeoutError, OSError, KernelError) as e:
            if (
                sent
                and rule["side_effect"]
                and method != "agent_run.invoke"
                and not (isinstance(e, KernelError) and e.remote)
            ):
                raise KernelError("OPERATION_OUTCOME_UNKNOWN") from e
            if isinstance(e, TimeoutError):
                raise KernelError("KERNEL_TIMEOUT") from e
            if isinstance(e, OSError):
                raise KernelError("CONNECTION_CLOSED") from e
            raise
        finally:
            if conn:
                await conn.close()

    async def status(self):
        return await self.rpc_status({})

    async def list(self):
        return await self.rpc_list({})

    async def get(self, key, expected_instance=None):
        key = {k: key[k] for k in B["lookupFields"]}
        params = {"key": key}
        if expected_instance is not None:
            params["kernel_instance_id"] = expected_instance
        result = await self.rpc_get(params)
        identity(
            result["ref"],
            {
                **key,
                **(
                    {"kernel_instance_id": expected_instance}
                    if expected_instance is not None
                    else {}
                ),
            },
        )
        if "terminal" in result:
            self._frame_identity(result["terminal"], result["ref"])
            if not terminal(result["terminal"]):
                raise KernelError("HOST_FRAME_INVALID")
        self._reconcile(result)
        return result

    def _frame_identity(self, frame, ref):
        if any(frame.get(k) != ref[k] for k in B["receiptFields"]):
            raise KernelError("RUN_IDENTITY_MISMATCH")

    async def cancel(self, ref, reason=None):
        """Cancel using the original full ref; an ACK means acceptance, and unknown outcomes must not be retried."""
        return await self.rpc_cancel(
            {"ref": ref, **({"reason": reason} if reason is not None else {})}
        )

    async def respond(self, ref, response):
        return await self.rpc_respond({"ref": ref, "response": response})

    async def respond_native(self, ref, response):
        return await self.rpc_respond_native({"ref": ref, "response": response})

    async def submit(self, input, environment=None, *, cancel_token=None):
        """Return the original RunRef without invoke registration; the caller owns observation and cleanup."""
        task = self._task(self._submit(input, environment or {}, cancel_token, None))
        # Task.cancel cannot retract written admission; bounded internal recovery records accepted or unknown.
        return await asyncio.shield(task)

    async def _submit(self, input, environment, token, record):
        if token:
            token.check()
        environment = normalize(environment)
        if "streamLimits" in environment:
            raise KernelError("KERNEL_STREAM_LIMITS_UNSUPPORTED")
        validate("KernelInvokeEnvironmentWire", environment)
        request = identify(input)
        key = lookup(request)
        status = await self.status()
        instance = status["kernel_instance_id"]
        if token:
            token.check()
        if record is not None:
            record["instance"] = instance
        sent = False

        def before_write():
            nonlocal sent
            if token:
                token.check()
            if record is not None and self.stopped:
                raise KernelError("CLIENT_INVOCATION_ADMISSION_CLOSED")
            sent = True
            if record is not None:
                record["submitted"] = True

        try:
            result = await self._rpc(
                "agent_run.invoke",
                {"input": request, **environment, "kernel_instance_id": instance},
                before_write,
            )
            ref = {
                **result["receipt"],
                "kernel_instance_id": result["kernel_instance_id"],
            }
            identity(ref, {**key, "kernel_instance_id": instance})
        except (KernelError, OSError) as e:
            if not sent or (
                isinstance(e, KernelError)
                and (
                    e.remote
                    or e.code in ("KERNEL_INSTANCE_CHANGED", "RUN_IDENTITY_MISMATCH")
                )
            ):
                raise
            ref = None
            try:
                # Recover a lost ACK by querying the original identity; exhausted recovery stays unknown, never reinvoke.
                async with asyncio.timeout(B["timeoutsMs"]["recovery"] / 1000):
                    for delay in B["repairDelaysMs"]:
                        await asyncio.sleep(delay / 1000)
                        try:
                            ref = (await self.get(key, instance))["ref"]
                            break
                        except KernelError as q:
                            if q.code in (
                                "KERNEL_INSTANCE_CHANGED",
                                "RUN_IDENTITY_MISMATCH",
                            ):
                                raise
            except TimeoutError:
                pass
            if ref is None:
                raise KernelError("ACCEPTANCE_UNKNOWN") from e
        if record is None and token and token.cancelled:
            await self.cancel(ref, token.reason)
        return ref

    async def subscribe(self, ref, after_seq=0):
        """Observe the original run from its contiguous cursor; closing or repairing observation never creates a run."""
        ref = validate("KernelRunRef", ref)
        after = after_seq
        repair = 0
        until = None
        while True:
            conn = None
            try:
                budget = B["timeoutsMs"]["unary"] / 1000
                if until is not None:
                    budget = min(budget, until - asyncio.get_running_loop().time())
                    if budget <= 0:
                        raise KernelError("KERNEL_UNAVAILABLE")
                async with asyncio.timeout(budget):
                    params = {"ref": ref, "after_seq": after}
                    check(METHODS["agent_run.subscribe"]["params"], params)
                    conn = await self.transport.open()
                    id = str(uuid.uuid4())
                    await conn.write(
                        dumps(
                            {
                                "jsonrpc": "2.0",
                                "id": id,
                                "method": "agent_run.subscribe",
                                "params": params,
                            }
                        )
                        + b"\n"
                    )
                    snapshot = response(loads(await conn.line()), id)
                    validate("KernelRunSnapshot", snapshot)
                    identity(snapshot["ref"], ref, True)
                    if "terminal" in snapshot:
                        self._frame_identity(snapshot["terminal"], ref)
                        if not terminal(snapshot["terminal"]):
                            raise KernelError("HOST_FRAME_INVALID")
                        self._reconcile(snapshot)
                        if after >= snapshot["latest_seq"]:
                            return
                while True:
                    notice = loads(await conn.line())
                    if (
                        isinstance(notice, dict)
                        and notice.get("method") == "agent_run.stream_error"
                    ):
                        validate("IpcStreamErrorNotification", notice)
                        if (
                            notice["params"]["kernel_instance_id"]
                            != ref["kernel_instance_id"]
                        ):
                            raise KernelError("KERNEL_INSTANCE_CHANGED")
                        raise KernelError(notice["params"]["code"])
                    validate("IpcEventNotification", notice)
                    p = notice["params"]
                    if p["kernel_instance_id"] != ref["kernel_instance_id"]:
                        raise KernelError("KERNEL_INSTANCE_CHANGED")
                    if (
                        p["run_id"] != ref["run_id"]
                        or p["stream_id"] != ref["stream_id"]
                    ):
                        raise KernelError("RUN_IDENTITY_MISMATCH")
                    frame = p["event"]
                    self._frame_identity(frame, ref)
                    if p["seq"] != frame["seq"] or frame["seq"] != after + 1:
                        raise KernelError("STREAM_GAP")
                    after = frame["seq"]
                    self._observe(ref, frame)
                    yield frame
                    if terminal(frame):
                        return
            except (KernelError, TimeoutError, OSError) as e:
                if self.transport.closed:
                    raise KernelError("CLIENT_CLOSED") from e
                if isinstance(e, KernelError) and e.code not in B["retryableErrors"]:
                    raise
                if repair >= len(B["repairDelaysMs"]):
                    raise KernelError("KERNEL_UNAVAILABLE") from e
                if until is None:
                    until = (
                        asyncio.get_running_loop().time()
                        + B["timeoutsMs"]["recovery"] / 1000
                    )
                delay = B["repairDelaysMs"][repair] / 1000
                repair += 1
                if asyncio.get_running_loop().time() + delay >= until:
                    raise KernelError("KERNEL_UNAVAILABLE") from e
                if conn:
                    await conn.close()
                    conn = None
                await asyncio.sleep(delay)
            finally:
                if conn:
                    await conn.close()

    async def invoke(
        self, input, environment=None, *, cancel_token=None, deadline=None
    ):
        """Register and submit on first iteration; native yields HostFrame, canonical yields its events.

        An explicit token or deadline cancels execution while retaining tail events; aclose/Task.cancel stop observation.
        The client owns admission and started controls; unknown runs stay registered until the owner drains them.
        """
        if cancel_token:
            cancel_token.check()
        request = identify(input)
        r = self._begin(lookup(request))
        token = cancel_token or CancelToken()
        watcher = None
        source = None
        deadline_task = None

        async def expire():
            await asyncio.sleep(max(0, deadline - asyncio.get_running_loop().time()))
            token.cancel("deadline_exceeded")

        async def watch():
            await token.event.wait()
            # The client owns admission and controls after cancellation; observer exit cannot retract them.
            await asyncio.shield(self._task(self._cancel_record(r, token.reason)))

        async def admit():
            try:
                ref = await self._submit(request, environment or {}, token, r)
                r["ref"] = ref
                r["phase"] = "accepted" if r["observing"] else "unobserved"
                r["admitted"].set()
                return ref
            except BaseException as e:
                r["admission_error"] = e
                r["phase"] = "acceptance_unknown"
                r["observationError"] = getattr(e, "code", "ACCEPTANCE_UNKNOWN")
                r["admitted"].set()
                if not r["submitted"] or (
                    isinstance(e, KernelError)
                    and e.remote
                    and e.code
                    not in ("RUN_IDENTITY_MISMATCH", "KERNEL_INSTANCE_CHANGED")
                ):
                    self.records.pop(r["key"]["invocation_id"], None)
                raise

        if deadline is not None:
            deadline_task = asyncio.create_task(expire())
        watcher = asyncio.create_task(watch())
        try:
            ref = await asyncio.shield(self._task(admit()))
            source = self.subscribe(ref)
            async for frame in source:
                state = terminal(frame)
                if request["protocol_mode"] == "canonical":
                    if frame["kind"] == "canonical":
                        yield frame["event"]
                    elif frame["kind"] == "control":
                        control = frame["control"]
                        if control["type"] == "gap":
                            raise KernelError("STREAM_GAP")
                        if control["type"] == "error":
                            try:
                                snapshot = await self.get(
                                    r["key"], ref["kernel_instance_id"]
                                )
                            except KernelError:
                                snapshot = {}
                            if terminal(snapshot.get("terminal")) == "lost":
                                raise KernelError("RUN_OUTCOME_UNKNOWN")
                            raise KernelError(control["code"], control)
                else:
                    yield frame
                if state == "lost":
                    raise KernelError("RUN_OUTCOME_UNKNOWN")
            if r["cancel_task"] is not None:
                await asyncio.shield(r["cancel_task"])
            if token.cancelled:
                token.check()
        except BaseException as e:
            r["observationError"] = getattr(e, "code", "OBSERVATION_STOPPED")
            raise
        finally:
            r["observing"] = False
            # Token cancellation and observer closure can race; retain intent even before the watcher runs.
            if token.cancelled and r["cancellation"] == "none":
                self._task(self._cancel_record(r, token.reason))
            if source:
                await source.aclose()
            for task in (watcher, deadline_task):
                if task:
                    task.cancel()
                    with suppress(asyncio.CancelledError, KernelError):
                        await task
            if r["ref"] is not None and r["key"]["invocation_id"] in self.records:
                r["phase"] = "unobserved"

    def _begin(self, key):
        if self.stopped:
            raise KernelError("CLIENT_INVOCATION_ADMISSION_CLOSED")
        id = key["invocation_id"]
        if id in self.records:
            raise KernelError("EXECUTION_IDENTITY_CONFLICT")
        if len(self.records) >= B["limits"]["invocations"]:
            raise KernelError("CLIENT_INVOCATION_CAPACITY_EXHAUSTED")
        r = {
            "key": key,
            "ref": None,
            "phase": "admitting",
            "cancellation": "none",
            "lastSeq": 0,
            "instance": None,
            "submitted": False,
            "observing": True,
            "admitted": asyncio.Event(),
            "admission_error": None,
            "cancel_task": None,
            "reason": None,
        }
        self.records[id] = r
        return r

    def invocations(self):
        return copy.deepcopy(
            [
                {
                    k: r[k]
                    for k in (
                        "key",
                        "ref",
                        "phase",
                        "cancellation",
                        "lastSeq",
                        "observationError",
                    )
                    if k in r and r[k] is not None
                }
                for r in self.records.values()
            ]
        )

    def stop_admission(self):
        self.stopped = True

    def _observe(self, ref, frame):
        r = self.records.get(ref["invocation_id"])
        if r is None or r["ref"] != ref:
            return
        r["lastSeq"] = max(r["lastSeq"], frame["seq"])
        state = terminal(frame)
        if state == "lost":
            r["phase"] = "unobserved"
            r["observationError"] = "RUN_OUTCOME_UNKNOWN"
        elif state:
            self.records.pop(ref["invocation_id"], None)

    def _reconcile(self, snapshot):
        ref = snapshot["ref"]
        r = self.records.get(ref["invocation_id"])
        if r is None or (
            r["instance"] is not None and r["instance"] != ref["kernel_instance_id"]
        ):
            return
        identity(ref, r["key"])
        if r["ref"] is not None:
            identity(ref, r["ref"], True)
        r["ref"] = ref
        r["instance"] = ref["kernel_instance_id"]
        r["admitted"].set()
        if "terminal" in snapshot:
            self._observe(ref, snapshot["terminal"])

    def _record(self, id):
        if id not in self.records:
            raise KernelError("INVOCATION_NOT_TRACKED")
        return self.records[id]

    def _ref(self, id):
        r = self._record(id)
        if r["ref"] is None:
            raise KernelError("INVOCATION_NOT_ACCEPTED")
        return r["ref"]

    async def cancel_invocation(self, id, reason="caller_cancelled"):
        return await self._cancel_record(self._record(id), reason)

    async def respond_interaction(self, id, response):
        return await self.respond(self._ref(id), response)

    async def respond_native_interaction(self, id, response):
        return await self.respond_native(self._ref(id), response)

    async def _cancel_record(self, r, reason):
        if r["reason"] is None:
            r["reason"] = reason
        if r["cancellation"] == "none":
            r["cancellation"] = "requested"

        async def control():
            try:
                # The client owns this task; first drain bounds admission waits, queued work and in-flight IO.
                async with asyncio.timeout_at(self._drain_deadline) as budget:
                    self._control_timeouts.add(budget)
                    try:
                        await r["admitted"].wait()
                        if r["ref"] is None:
                            raise r["admission_error"] or KernelError(
                                "ACCEPTANCE_UNKNOWN"
                            )
                        if r.get("observationError") == "RUN_OUTCOME_UNKNOWN":
                            raise KernelError("RUN_OUTCOME_UNKNOWN")
                        if r["key"]["invocation_id"] not in self.records:
                            return {"accepted": False}
                        async with self.controls:
                            if (
                                self._drain_deadline is not None
                                and asyncio.get_running_loop().time()
                                >= self._drain_deadline
                            ):
                                raise TimeoutError
                            result = await self.cancel(r["ref"], r["reason"])
                    finally:
                        self._control_timeouts.discard(budget)
                r["cancellation"] = "acknowledged"
                return result
            except TimeoutError as e:
                # An unconfirmed cancel ACK does not confirm cancellation; retain the unresolved record.
                r["cancellation"] = "unknown"
                raise KernelError("DRAIN_DEADLINE_EXCEEDED") from e
            except BaseException:
                r["cancellation"] = "unknown"
                raise

        if r["cancel_task"] is None:
            r["cancel_task"] = self._task(control())
        return await asyncio.shield(r["cancel_task"])

    async def drain(self, *, deadline, reason="owner_shutdown"):
        """Drain against an absolute loop deadline; repeated calls share the result, releasing only confirmed terminal runs."""
        self.stop_admission()

        async def run():
            sem = asyncio.Semaphore(B["limits"]["lookupConcurrency"])

            async def reconcile(r):
                async with sem:
                    if r["instance"] is None:
                        return
                    try:
                        snapshot = await self.get(r["key"], r["instance"])
                        if not terminal(snapshot.get("terminal")):
                            await self._cancel_record(r, reason)
                    except KernelError:
                        pass

            try:
                async with asyncio.timeout_at(deadline):
                    while self.records:
                        await asyncio.gather(
                            *(reconcile(r) for r in list(self.records.values()))
                        )
                        if self.records:
                            await asyncio.sleep(0.1)
            except TimeoutError:
                pass
            return {"complete": not self.records, "unresolved": self.invocations()}

        if self._draining is None:
            self._drain_deadline = deadline
            # Bound controls that already started, not only tasks created by drain.
            for budget in self._control_timeouts:
                budget.reschedule(deadline)
            self._draining = self._task(run())
        return await asyncio.shield(self._draining)


__all__ = [
    "Client",
    "CancelToken",
    "KernelError",
    "UNSET",
    "decode",
    "encode",
    "validate",
    "loads",
    "dumps",
    "models",
]
