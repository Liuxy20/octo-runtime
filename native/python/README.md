# Python 原生 Client

最低 Python 3.11，asyncio API。发行包为 `octo-runtime-client`，导入名为 `octo_runtime`，当前源码版本未发布。

```sh
uv sync --frozen --python 3.11
.venv/bin/python -I demo_playboard.py status --endpoint /path/kernel.sock
uv run --frozen python -m unittest discover -s tests -p 'test_*.py'
uv build
```

运行时只有两个实现文件：`octo_runtime_generated.py` 放生成的类型、校验表和 RPC 方法；`client.py` 放全部手写实现，包含 codec、生命周期及私有 transport 类。`__init__.py` 仅导出公开 API，支持 `from octo_runtime import Client` 和 `from octo_runtime.client import Client`。源码注释使用英文。

Windows 使用 `.venv/Scripts/python.exe`，平台依赖 `pywin32==311`。所有平台使用同一个 SDK 包和导入入口；异步 Unix socket / Windows named pipe 均在 `client.py` 内自动选择，Linux/macOS 不加载 `pywin32`，调用方无需选择平台脚本。

[demo_playboard.py](demo_playboard.py) 包含 `async with Client(...)`、lazy `invoke`、原回执查询、交互、显式 `CancelToken` 和 owner drain。模型为生成的 TypedDict；缺键或 `UNSET` 表示缺省，`None` 表示显式 null。使用 `loads`/`dumps` 保留 opaque JSON 的 Decimal/大整数，使用 `decode`/`validate` 校验 wire。

`Task.cancel()` 和 `aclose()` 仅结束观察；要停止服务端执行，使用 `CancelToken` 或显式控制方法。统一命令和验证入口见 [native README](../README.md) 与 [demo 说明](../examples/README.md)。
