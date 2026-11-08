# Packages

Internal workspace packages compose the execution infrastructure and are not independently published.

| Package                                          | Responsibility                                          |
| ------------------------------------------------ | ------------------------------------------------------- |
| [Protocol](octo-runtime-protocol/README.md)      | Types, schema, wire validation                          |
| [Client](octo-runtime-client/README.md)          | Independently installable client for an existing Kernel |
| [Core](octo-runtime-executor-core/README.md)     | AgentExecutor and shared execution                      |
| [Kernel](octo-runtime-executor-kernel/README.md) | RPC, admission, observation and lifecycle               |
| [Host](octo-runtime-host-sdk/README.md)          | Home, identity and endpoint conventions                 |

Provider adapters integrate Harness frameworks. Runtime and client are separate self-contained npm distributions. Channels belong to [octo-channel-gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway)。
