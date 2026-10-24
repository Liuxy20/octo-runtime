"""Call an existing Kernel through the Python SDK; emit only NDJSON on stdout."""

from __future__ import annotations
import argparse
import asyncio
import os
import math
import signal
import sys
import tempfile
import uuid
from pathlib import Path
from contextlib import suppress
from octo_runtime import (
    Client,
    CancelToken,
    KernelError,
    dumps,
    loads,
    validate,
)

MAX_INPUT = 32 * 1024 * 1024


def read_json(path):
    if not path:
        raise ValueError("a JSON file path is required")
    if path == "-":
        data = sys.stdin.buffer.read(MAX_INPUT + 1)
    else:
        with open(path, "rb") as file:
            data = file.read(MAX_INPUT + 1)
    if len(data) > MAX_INPUT:
        raise KernelError("INVOKE_REQUEST_TOO_LARGE")
    return loads(data)


def emit(value):
    sys.stdout.buffer.write(dumps(value) + b"\n")
    sys.stdout.buffer.flush()


def duration(text):
    for suffix, factor in [("ms", 0.001), ("s", 1), ("m", 60), ("h", 3600)]:
        if text.endswith(suffix):
            return float(text[: -len(suffix)]) * factor
    return float(text)


def save_receipt(path, value):
    parent = Path(path).parent
    with tempfile.NamedTemporaryFile(
        mode="wb", prefix=".receipt-", dir=parent, delete=False
    ) as file:
        name = file.name
        file.write(dumps(value) + b"\n")
    try:
        os.replace(name, path)
    finally:
        with suppress(FileNotFoundError):
            os.unlink(name)


def parser():
    p = argparse.ArgumentParser(
        prog="playboard-demo-python",
        description="Native Octo Runtime playground (Python). Connects to an existing Kernel.",
    )
    p.add_argument(
        "command",
        choices=[
            "status",
            "list",
            "playboard",
            "get",
            "subscribe",
            "cancel",
            "respond",
            "native-respond",
        ],
    )
    p.add_argument("--endpoint", default=os.getenv("OCTO_KERNEL_ENDPOINT", ""))
    p.add_argument("--request", default="-")
    p.add_argument("--prompt", default="")
    p.add_argument("--adapter", default="codex")
    p.add_argument("--mode", default="canonical", choices=["native", "canonical"])
    p.add_argument("--approval", default="ask")
    p.add_argument("--timeout", type=duration, default=0)
    p.add_argument("--cancel-grace", type=duration, default=10)
    p.add_argument("--receipt", default="")
    p.add_argument("--ref", default="")
    p.add_argument("--after", type=int, default=0)
    p.add_argument("--reason", default="demo_user_cancelled")
    p.add_argument("--response", default="-")
    p.add_argument("--responses", default="")
    return p


async def run(args):
    token = CancelToken()
    loop = asyncio.get_running_loop()
    interrupted = False
    old = {}

    def interrupt(*_):
        nonlocal interrupted
        interrupted = True
        loop.call_soon_threadsafe(token.cancel, "caller_aborted")

    for sig in (signal.SIGINT, signal.SIGTERM):
        old[sig] = signal.signal(sig, interrupt)
    try:
        async with Client(args.endpoint) as client:
            if args.command == "status":
                emit(await client.status())
                return 0
            if args.command == "list":
                emit(await client.list())
                return 0
            if args.command in (
                "get",
                "subscribe",
                "cancel",
                "respond",
                "native-respond",
            ):
                ref = validate("KernelRunRef", read_json(args.ref))
                if args.command == "get":
                    emit(await client.get(ref, ref["kernel_instance_id"]))
                elif args.command == "cancel":
                    emit(await client.cancel(ref, args.reason))
                elif args.command == "subscribe":
                    stream = client.subscribe(ref, args.after)
                    stopped = asyncio.create_task(token.event.wait())
                    timer = (
                        loop.call_later(args.timeout, token.cancel, "deadline_exceeded")
                        if args.timeout
                        else None
                    )
                    pending = None
                    try:
                        while True:
                            pending = asyncio.create_task(anext(stream))
                            done, _ = await asyncio.wait(
                                (pending, stopped), return_when=asyncio.FIRST_COMPLETED
                            )
                            if stopped in done:
                                return 130 if interrupted else 124
                            try:
                                emit(pending.result())
                            except StopAsyncIteration:
                                break
                    finally:
                        if timer:
                            timer.cancel()
                        stopped.cancel()
                        if pending:
                            pending.cancel()
                        await asyncio.gather(
                            stopped,
                            *([pending] if pending else []),
                            return_exceptions=True,
                        )
                        await stream.aclose()
                else:
                    reply = read_json(args.response)
                    if args.command == "respond":
                        await client.respond(
                            ref, validate("InteractionResponseWire", reply)
                        )
                    else:
                        await client.respond_native(
                            ref, validate("NativeInteractionResponse", reply)
                        )
                    emit({})
                return 0
            request = (
                {
                    "protocol_mode": args.mode,
                    "inputs": [{"type": "text", "text": args.prompt}],
                    "contexts": {
                        "schema": "octo.context-envelope/v3",
                        "items": [
                            {
                                "namespace": "octo.execution",
                                "name": "adapter",
                                "payload": {"type": args.adapter},
                            },
                            {
                                "namespace": "octo.security",
                                "name": "approval_policy",
                                "payload": {"mode": args.approval},
                            },
                        ],
                    },
                }
                if args.prompt
                else read_json(args.request)
            )
            validate("InvokeInputWire", request)
            for key in ("runId", "invocationId", "sessionId"):
                request.setdefault(key, str(uuid.uuid4()))
            original_key = {
                "run_id": request["runId"],
                "invocation_id": request["invocationId"],
                "agent_session_id": request["sessionId"],
                "session_generation": request.get("sessionGeneration", 0),
                "protocol_mode": request.get("protocol_mode", "native"),
            }
            expected_instance = (
                (await client.status())["kernel_instance_id"] if args.receipt else None
            )
            replies = read_json(args.responses) if args.responses else []
            if not isinstance(replies, list):
                raise ValueError("--responses must contain a JSON array")
            for reply in replies:
                if reply.get("kind") not in ("native", "canonical"):
                    raise ValueError("reply.kind must be native or canonical")
                validate(
                    "NativeInteractionResponse"
                    if reply["kind"] == "native"
                    else "InteractionResponseWire",
                    reply["response"],
                )

            async def deadline():
                await asyncio.sleep(args.timeout)
                token.cancel("deadline_exceeded")

            async def grace():
                await token.event.wait()
                await asyncio.sleep(args.cancel_grace)
                await client.close()

            timer = asyncio.create_task(deadline()) if args.timeout else None
            closer = asyncio.create_task(grace())
            stream = client.invoke(request, cancel_token=token)
            exit_code = 1
            saved = False
            failure = None
            answered = set()
            try:
                async for event in stream:
                    records = client.invocations()
                    if args.receipt and not saved:
                        reference = records[0].get("ref") if records else None
                        if reference is None:
                            reference = (
                                await client.get(original_key, expected_instance)
                            )["ref"]
                        save_receipt(args.receipt, reference)
                        saved = True
                    emit(event)
                    control = event.get("control", {})
                    if (
                        event.get("kind") == "control"
                        and control.get("type") == "state"
                    ):
                        exit_code = {"completed": 0, "cancelled": 130}.get(
                            control["state"], 1
                        )
                    if event.get("type") in (
                        "run.completed",
                        "run.cancelled",
                        "run.failed",
                    ):
                        exit_code = {
                            "run.completed": 0,
                            "run.cancelled": 130,
                            "run.failed": 1,
                        }[event["type"]]
                    native = bool(event.get("kind"))
                    interaction = (
                        event.get("type") == "interaction.requested"
                        or (
                            event.get("kind") == "control"
                            and control.get("type") == "interaction"
                            and control.get("status") == "pending"
                        )
                        or (
                            event.get("kind") == "native"
                            and event.get("messageKind") == "request"
                        )
                    )
                    if interaction:
                        target = (
                            control.get("requestId", event.get("payload", {}).get("id"))
                            if native
                            else event["payload"]["interactionId"]
                        )
                        # Native request and control.pending describe the same request; do not submit the answer twice.
                        answer_key = (native, dumps(target))
                        if answer_key in answered:
                            continue
                        match = next(
                            (
                                r
                                for r in replies
                                if not r.get("used")
                                and (r["kind"] == "native") == native
                                and r["response"].get(
                                    "requestId" if native else "interactionId"
                                )
                                == target
                            ),
                            None,
                        )
                        if match is None:
                            print(
                                "INTERACTION_PENDING: use respond/native-respond --ref <receipt> --response <reply.json> in another terminal; Ctrl-C cancels this run.",
                                file=sys.stderr,
                            )
                            continue
                        if not records:
                            raise KernelError("INVOCATION_NOT_TRACKED")
                        invocation = records[0]["key"]["invocation_id"]
                        if native:
                            await client.respond_native_interaction(
                                invocation, match["response"]
                            )
                        else:
                            await client.respond_interaction(
                                invocation, match["response"]
                            )
                        match["used"] = True
                        answered.add(answer_key)
            except (KernelError, OSError) as e:
                failure = e
            finally:
                await stream.aclose()
                client.stop_admission()
                for task in (timer, closer):
                    if task:
                        task.cancel()
                await asyncio.gather(
                    *(t for t in (timer, closer) if t), return_exceptions=True
                )
            if client.invocations():
                result = await client.drain(
                    deadline=loop.time() + args.cancel_grace, reason="playboard_exit"
                )
                if not result["complete"]:
                    print(
                        f"DRAIN_INCOMPLETE: {len(result['unresolved'])} invocation(s) remain unresolved",
                        file=sys.stderr,
                    )
                    failure = failure or KernelError("RUN_OUTCOME_UNKNOWN")
            if failure:
                if (
                    isinstance(failure, KernelError)
                    and failure.code == "CALLER_ABORTED"
                ):
                    return 130 if interrupted else 124
                raise failure
            return exit_code
    finally:
        for sig, handler in old.items():
            signal.signal(sig, handler)


def main():
    args = parser().parse_args()
    if not args.endpoint:
        parser().error("set --endpoint or OCTO_KERNEL_ENDPOINT")
    if (
        not math.isfinite(args.cancel_grace)
        or not math.isfinite(args.timeout)
        or args.cancel_grace <= 0
        or args.timeout < 0
        or args.after < 0
    ):
        parser().error("invalid timeout, cancel-grace or cursor")
    try:
        code = asyncio.run(run(args))
    except (KernelError, ValueError, OSError) as e:
        print(getattr(e, "code", str(e)), file=sys.stderr)
        code = 1
    sys.exit(code)


if __name__ == "__main__":
    main()
