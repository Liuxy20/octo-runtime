# Go 原生 Client

最低 Go 1.25。公开包为 `github.com/Mininglamp-OSS/octo-runtime/native/go`，当前源码版本未发布。

```sh
go test -race ./...
go build -o ../../.tmp/playboard-demo-go ./examples/demo_playboard.go
```

[demo_playboard.go](examples/demo_playboard.go) 包含 `Attach`、输入解码、lazy `Invoke`、`Invocations`、原回执查询、交互、context 取消和 owner drain 的完整接入示例。`Decode[T]`/`Encode` 执行协议校验；仅 `json.Unmarshal` 不能替代 wire 校验。开放对象额外字段保存在 `Extra`，原生 JSON 使用 `json.RawMessage`。

运行时只有三个源码文件：`octo_runtime_generated.go` 放生成的类型、校验表和 RPC 方法；`client.go` 放全部手写实现，包含 codec、生命周期及 Unix/Windows transport；8 行的 `pipe_windows.go` 仅绑定 go-winio 的 Windows 专用 API，由 Go 编译器自动选择。使用方始终导入同一个 SDK 包，不需要选择或复制平台文件。源码注释使用英文。

Go 的 `runtime.GOOS` 分支只控制运行时执行，无法隐藏编译时 import 或不存在的符号。依赖中的 `DialPipeContext` 仅在 Windows 构建时存在，因此绑定必须放在编译器识别的 `_windows.go` 文件；连接、超时和关闭逻辑仍集中在 `client.go`。

单测统一放在 `client_test.go`，不再按 codec、lifecycle、transport 拆文件。Go 在同包内测试私有实现，因此测试文件与源码同目录；`_test.go` 不参与 SDK 使用方的正常构建。

统一命令和验证入口见 [native README](../README.md) 与 [demo 说明](../examples/README.md)。
