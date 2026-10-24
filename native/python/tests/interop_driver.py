import asyncio
import sys
from pathlib import Path
from contextlib import suppress
from octo_runtime import Client, CancelToken, KernelError, validate, loads, dumps


async def run(m):
    if m["op"] == "codec":
        try:
            validate(m["definition"], m["value"])
            return {"valid": True, "value": m["value"]}
        except KernelError:
            return {"valid": False}
    async with Client(m["endpoint"]) as c:
        status = await c.status()
        adapters = await c.list()
        result = {"instance": status["kernel_instance_id"], "adapters": len(adapters)}
        if m["op"] == "drain-queued-cancels":
            tasks = []
            try:
                for n in range(5):
                    id = f"{m['input']['invocationId']}-{n}"
                    stream = c.invoke({**m["input"], "invocationId": id, "runId": id})
                    await anext(stream)
                    await stream.aclose()
                    tasks.append(
                        asyncio.create_task(c.cancel_invocation(id, "test_cancel"))
                    )
                async with asyncio.timeout(5):
                    while not Path(m["gate"] + ".ready").exists():
                        await asyncio.sleep(0.001)
                result["drain"] = await c.drain(
                    deadline=asyncio.get_running_loop().time() + 0.1
                )
                result["repeated"] = await c.drain(
                    deadline=asyncio.get_running_loop().time() + 5
                )
                Path(m["gate"] + ".drained").write_text("drained")
                await asyncio.gather(*tasks, return_exceptions=True)
                return result
            finally:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
        if m["op"] in ("close-admitting", "cancel-close-admitting"):
            token = CancelToken()
            stream = c.invoke(m["input"], cancel_token=token)
            pending = asyncio.create_task(anext(stream))
            async with asyncio.timeout(5):
                while not Path(m["gate"]).exists():
                    await asyncio.sleep(0.001)
                if m["op"] == "cancel-close-admitting":
                    token.cancel()
                    if m.get("yieldWatcher"):
                        await asyncio.sleep(0)
                pending.cancel()
                with suppress(asyncio.CancelledError):
                    await pending
                Path(m["gate"] + ".closed").write_text("closed")
                while True:
                    records = c.invocations()
                    if (
                        len(records) == 1
                        and records[0].get("ref")
                        and (
                            m["op"] == "close-admitting"
                            or records[0]["cancellation"] == "acknowledged"
                        )
                    ):
                        result["registry"] = records
                        return result
                    await asyncio.sleep(0.001)
        if m["op"] in (
            "invoke",
            "interaction",
            "cancel-invocation",
            "abandon",
            "drain",
        ):
            stream = c.invoke(m["input"])
            result["before"] = len(c.invocations())
            result["events"] = []
            try:
                async for event in stream:
                    result["events"].append(event)
                    if m["op"] == "interaction":
                        if (
                            event.get("kind") == "native"
                            and event.get("messageKind") == "request"
                        ):
                            await c.respond_native_interaction(
                                m["input"]["invocationId"],
                                {
                                    "requestId": 42,
                                    "payload": {"id": 42, "result": "approved"},
                                },
                            )
                        if event.get("type") == "interaction.requested":
                            await c.respond_interaction(
                                m["input"]["invocationId"],
                                {"interactionId": "approval", "outcome": "accepted"},
                            )
                    if len(result["events"]) == 1:
                        if m["op"] == "cancel-invocation":
                            result["cancel"] = await c.cancel_invocation(
                                m["input"]["invocationId"], "test_cancel"
                            )
                            await c.cancel_invocation(
                                m["input"]["invocationId"], "second"
                            )
                        if m["op"] == "abandon":
                            await stream.aclose()
                            break
                        if m["op"] == "drain":
                            result["drain"] = await c.drain(
                                deadline=asyncio.get_running_loop().time() + 2,
                                reason="test_drain",
                            )
            except KernelError as e:
                result["error"] = e.code
            finally:
                await stream.aclose()
            result["registry"] = c.invocations()
            return result
        ref = await c.submit(m["input"])
        result["ref"] = ref
        if m["op"] == "cancel":
            result["cancel"] = await c.cancel(ref, "test_cancel")
        result["frames"] = [frame async for frame in c.subscribe(ref)]
        result["snapshot"] = await c.get(ref, ref["kernel_instance_id"])
        return result


for line in sys.stdin.buffer:
    try:
        result = asyncio.run(run(loads(line)))
    except KernelError as e:
        result = {"error": e.code}
    sys.stdout.buffer.write(dumps(result) + b"\n")
    sys.stdout.buffer.flush()
