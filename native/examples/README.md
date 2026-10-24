# Go / Python playboard demo

每个 demo 都直接调用同目录 SDK，提供请求输入、流式事件、回执查询、重订阅、取消和交互回复。以下用 `DEMO` 表示某一语言的启动命令：

| 语言   | 从仓库根目录启动                                                    |
| ------ | ------------------------------------------------------------------- |
| Go     | `.tmp/playboard-demo-go`                                            |
| Python | `native/python/.venv/bin/python -I native/python/demo_playboard.py` |

构建见 [native README](../README.md)。所有命令都需要 `--endpoint` 或 `OCTO_KERNEL_ENDPOINT`。`stdout` 是逐行 JSON，诊断及等待交互提示写入 `stderr`，方便终端查看和脚本保存。

```sh
DEMO status
DEMO list
DEMO playboard --prompt 'Reply with OK without using tools.' --adapter codex --mode native --receipt run.json --timeout 60s
DEMO playboard --request native/examples/request.json --receipt run.json
cat request.json | DEMO playboard --receipt run.json
DEMO get --ref run.json
DEMO subscribe --ref run.json --after 0
DEMO cancel --ref run.json --reason user_cancelled
```

`--request` 文件中的字段是完整 InvokeInput，优先于 `--mode`/`--adapter`/`--approval`，后三项只用于 `--prompt` 构造请求。[request.json](request.json) 使用 Codex、canonical 输出、ask 审批，不包含凭据。固定 workspace 可在 contexts 中显式添加：

```json
{
  "namespace": "octo.execution",
  "name": "workspace",
  "payload": { "mode": "fixed", "path": "/absolute/workspace" }
}
```

建议总是使用 `--receipt`。收到事件后保存原 `RunRef`；很快结束的调用也会按原身份查询并保存回执。文件权限在 Unix 上为 `0600`。`get`、取消和回复都使用这份原始回执。

## 交互与审批

遇到待回答事件时 demo 保持订阅，不自动批准。观察事件中的 `interactionId`（canonical）或 `requestId`/原生 `payload.id`（native），在另一个终端调用同一 CLI：

```sh
DEMO respond --ref run.json --response answer.json
DEMO native-respond --ref run.json --response native-answer.json
```

Canonical 回答示例（替换实际 ID）：

```json
{ "interactionId": "actual-interaction-id", "outcome": "accepted" }
```

Codex native 审批示例（ID 必须保留实际数字/字符串类型，载荷必须匹配对应原生方法）：

```json
{ "requestId": 42, "payload": { "jsonrpc": "2.0", "id": 42, "result": { "decision": "accept" } } }
```

可使用 `--responses answers.json` 提供显式匹配回答数组；格式见 [responses.json](responses.json)，该文件的 ID/回答仅用于测试 fixture，不能当成通用审批策略。每个匹配回答最多提交一次；原生 request 与 pending 通知重复描述同一请求时不会重复发送。没有匹配项继续等待人工回答。

## 退出与所有权

`Ctrl-C`/SIGTERM 和 `--timeout 60s` 请求取消当前 demo 自己的执行，继续观察尾流；`--cancel-grace 10s` 限制取消后等待。终态成功退出 `0`，失败/未知退出 `1`，参数错误通常退出 `2`，人工中断退出 `130`，本地执行截止退出 `124`。取消 ACK 本身不表示执行已结束。

CLI 退出前显式 drain 自己登记的执行，不拥有 Kernel 或其他客户端的 Run。单独 `subscribe` 中断只停止该订阅。`get` 保留原 instance 校验，服务重启时不会自动查询另一个实例的同名 Run。
