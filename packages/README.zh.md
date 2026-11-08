# 包目录

执行基础设施由以下 workspace 包组成，内部包不单独发布。

| Package                                          | Responsibility                                          |
| ------------------------------------------------ | ------------------------------------------------------- |
| [Protocol](octo-runtime-protocol/README.md)      | Types, schema, wire validation                          |
| [Client](octo-runtime-client/README.md)          | Independently installable client for an existing Kernel |
| [Core](octo-runtime-executor-core/README.md)     | AgentExecutor and shared execution                      |
| [Kernel](octo-runtime-executor-kernel/README.md) | RPC, admission, observation and lifecycle               |
| [Host](octo-runtime-host-sdk/README.md)          | Home, identity and endpoint conventions                 |

Provider Adapter 负责适配 Harness。完整 Runtime 和独立 client 是两个自包含 npm 发行包。业务渠道迁至 [octo-channel-gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway)。
