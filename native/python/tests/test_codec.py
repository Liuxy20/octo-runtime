import copy
import unittest
from decimal import Decimal
from unittest.mock import AsyncMock, patch
from octo_runtime import Client, KernelError, UNSET, encode, loads, dumps
from octo_runtime.client import identify


class CodecTests(unittest.IsolatedAsyncioTestCase):
    async def test_unset_is_absent_at_codec_identity_and_rpc_boundaries(self):
        value = {
            "inputs": [{"type": "text", "text": "test"}],
            "contexts": {"schema": "octo.context-envelope/v3", "items": []},
            "runId": UNSET,
            "future": {
                "missing": UNSET,
                "null": None,
                "zero": 0,
                "false": False,
                "empty": "",
                "big": 900719925474099312345,
                "decimal": Decimal("1.25"),
            },
        }
        encoded = loads(encode("InvokeInputWire", value))
        self.assertNotIn("runId", encoded)
        self.assertNotIn("missing", encoded["future"])
        self.assertEqual(
            encoded["future"],
            {k: v for k, v in value["future"].items() if v is not UNSET},
        )
        request = identify(value)
        self.assertIsInstance(request["runId"], str)
        self.assertNotIn("missing", copy.deepcopy(request)["future"])
        self.assertIs(value["runId"], UNSET)  # Normalization must not mutate the caller's input.
        with self.assertRaises(KernelError):
            encode("InvokeInputWire", {**value, "runId": None})
        with self.assertRaises(KernelError):
            encode("InvokeInputWire", {**value, "inputs": UNSET})

        conn = AsyncMock()

        async def response():
            sent = loads(conn.write.call_args.args[0])
            self.assertNotIn("kernel_instance_id", sent["params"])
            return dumps(
                {
                    "jsonrpc": "2.0",
                    "id": sent["id"],
                    "error": {
                        "code": -32000,
                        "message": "test",
                        "data": {"code": "TEST_REMOTE"},
                    },
                }
            )

        conn.line.side_effect = response
        async with Client("unused.sock") as client:
            with patch.object(
                client, "status", side_effect=KernelError("TEST_STATUS")
            ) as status:
                with self.assertRaisesRegex(KernelError, "TEST_STATUS"):
                    await client.submit(
                        value, {"executionEnvOverrides": UNSET, "streamLimits": UNSET}
                    )
                status.assert_awaited_once()
            with patch.object(client.transport, "open", return_value=conn):
                with self.assertRaisesRegex(KernelError, "TEST_REMOTE"):
                    await client.rpc_get(
                        {
                            "key": {
                                "run_id": "r",
                                "invocation_id": "i",
                                "agent_session_id": "s",
                                "session_generation": 0,
                                "protocol_mode": "native",
                            },
                            "kernel_instance_id": UNSET,
                        }
                    )
