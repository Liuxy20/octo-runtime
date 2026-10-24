# 原生 RPC Client 与 playboard demo

Go、Python 各自实现原生 SDK 和 CLI demo，直接连接已有 Executor Kernel 的 Unix socket / Windows named pipe。客户端运行时不调用 Node、不启动 CLI 子进程、不读取 Schema。Kernel 和 Provider 由宿主管理。

| 语言   | SDK               | playboard demo                                     | 工具链最低版本 |
| ------ | ----------------- | -------------------------------------------------- | -------------- |
| Go     | [go](go/)         | [demo_playboard.go](go/examples/demo_playboard.go) | Go 1.25        |
| Python | [python](python/) | [demo_playboard.py](python/demo_playboard.py)      | Python 3.11    |

两套 demo 的命令和输出相同。完整命令见 [playboard 使用说明](examples/README.md)。代码位于本仓库 `native/`，没有外部 demo 仓库依赖。

SDK 运行时按“一份生成代码 + 一份手写代码”组织：Python 为 `octo_runtime_generated.py` + `client.py`，`__init__.py` 仅导出公开 API；Go 为 `octo_runtime_generated.go` + `client.go`，另有 8 行的 `pipe_windows.go` 绑定 Windows 专用 API，由编译器自动选择。Transport 是手写实现的内部细节，调用方始终使用一个 SDK 包。测试、demo 和包元数据另计；源码注释使用英文。

## 构建和运行

从仓库根目录执行；先由宿主安装并启动 Kernel，取得实际 endpoint。macOS/Linux 默认 Runtime Home 的地址通常是 `$HOME/.octo-runtime/sockets/octo-runtime-executor-kernel.sock`，自定义 Home 请使用对应地址。Windows 使用宿主提供的完整 pipe 名，不拼接猜测 hash。

```sh
mkdir -p .tmp
(cd native/go && go build -o ../../.tmp/playboard-demo-go ./examples/demo_playboard.go)
uv sync --project native/python --frozen --python 3.11

export OCTO_KERNEL_ENDPOINT="$HOME/.octo-runtime/sockets/octo-runtime-executor-kernel.sock"
.tmp/playboard-demo-go playboard --request native/examples/request.json --receipt .tmp/go-run.json
native/python/.venv/bin/python -I native/python/demo_playboard.py playboard --request native/examples/request.json --receipt .tmp/python-run.json
```

Windows 的 Python 路径是 `native/python/.venv/Scripts/python.exe`，Go 可执行文件带 `.exe`。Python 仅在 Windows 安装锁定的 `pywin32` wheel。

## SDK 使用边界

- `Attach` / `Client` 只附着服务。`Invoke` / `invoke` 在开始迭代时提交；先 `Status`/`List` 检查服务和 Adapter，再消费流到终态。
- 默认 `native` 返回完整 HostFrame；显式 `canonical` 返回 CanonicalEvent。订阅游标、Kernel instance 和原调用身份不能被新运行替换。
- `Submit` / `submit` 返回接纳回执。需要高级控制时，保留原 `RunRef`，调用 `get`、`subscribe`、`cancel`、`respond`、`respond_native`。接纳 ACK、取消 ACK 与执行终态是不同事实。
- Go 的 `context`、Python 的显式 `CancelToken` 请求执行取消并继续读尾流。关闭迭代器或 Python `Task.cancel()` 只停止观察；宿主仍需处置登记中的未完成执行。
- SDK `Close` / `close` 不停止 Kernel、不批量取消 Run。owner 退出时先 `stop_admission`，再带绝对截止时间 `drain`；`unresolved` 非空不能按成功处理。
- 未知业务错误 code 保留；ACK 不确定时只按原身份查询，不能自动重提 invoke/respond/cancel。`RUN_OUTCOME_UNKNOWN` 保留在 registry，供宿主决策。
- Go 使用 `Optional[T]`/`Some` 区分缺省；Python 使用 TypedDict 缺键/`UNSET`。显式 `null` 仅用于允许空值的字段。开放对象扩展和原生载荷保留 JSON；本地数值保真不改变 TS 服务端 `JSON.parse` 的数值边界。

## 协议生成

数据唯一来源是 `packages/octo-runtime-protocol/schema/` 下的 `protocol.schema.json`、`kernel-ipc.schema.json` 和 `kernel-client.behavior.json`。`native/codegen` 只生成协议类型、校验规则、行为常量和 RPC 接口。客户端流程、生命周期和 transport 在各语言包内各维护一份手写源码，不再复制为模板和生成文件。

```sh
node native/codegen/generate.mjs
node native/codegen/generate.mjs --check
node --test native/tests/codegen.test.mjs
```

重新生成需要 Node、gofmt；`--check` 只需要 Node，核对 Schema、生成器、产物清单及每个文件的 SHA-256 摘要，修改、缺失或遗留产物都会报错。它不重新运行语言 formatter；完整重新生成的字节一致性由 `codegen.test.mjs` 验证。安装/运行已生成 SDK 不需要生成工具。

修改 Schema 或 emitter 后重新生成，禁止只改生成文件。未知关键字在写文件前失败。模型保留公共根及其类型依赖；两种语言的校验规则使用去重后的节点图。

`rules` 是 codec 使用的 Schema 校验表，用于字段、类型和跨字段检查，不是单独的规则系统或用户配置。它与模型、行为常量和 RPC 方法一起保存在各语言唯一的生成源码中，运行时不读取 Schema 文件。

### 生成来源

每个生成源码的头注释直接包含 `octo-runtime schema commit`、Schema SHA-256 和生成器 SHA-256；版本指向 `octo-runtime` 中最后修改协议源的 commit，而非 SDK 构建时碰巧所在的 HEAD。单个文件也能追溯协议版本；它不是 npm/SDK 的发行版本。

[`generated-manifest.json`](generated-manifest.json) 是生成产物的来源记录：

- `provenance.schemaCommit`：最后修改权威 Schema 目录的 Git commit。
- `provenance.generatorCommit`：最后修改 `native/codegen/` 的 Git commit。
- `sourceHash` / `generatorHash`：实际输入和生成器源码的 SHA-256，精确覆盖未提交改动。
- `files` / `fileHashes`：完整输出清单及各文件 SHA-256。

只有相应目录没有未提交改动时才记录 commit；自定义 Schema、无 Git 或未提交输入记录 `null`，不能把旧 commit 当作精确版本。提交 Schema/生成器后再次生成，即可固定两个来源 commit；随后提交产物。历史版本可按两个 commit 分别检出 Schema 和生成器重建，比较 `fileHashes`；formatter 差异也会反映在输出摘要中。`--check` 仅验证内容完整性，不依赖 Git，也不重新证明历史 commit 的真实性。

## 验证

Native 是可选功能，不接入 GitHub Actions 或 CI Gate。以下检查按需在本地运行；未执行的平台不能记为通过。

先 `pnpm install --frozen-lockfile` / `pnpm build` 构建测试 Kernel，安装各语言工具链，执行上述 Python `uv sync`。

```sh
(cd native/go && go test -race ./...)
uv run --project native/python --frozen python -m unittest discover -s native/python/tests -p 'test_*.py'
node native/tests/run.mjs --language all --evidence .tmp/native-evidence.json
# 单语言或单套件
node native/tests/run.mjs --language all --suite lifecycle
node native/tests/run.mjs --language go --suite playboard-demo
node native/tests/run.mjs --language python --suite package
# 显式真实 Provider 联调；使用已有 Kernel，不由脚本启动/停止它
node native/tests/live-demo.mjs --endpoint "$OCTO_KERNEL_ENDPOINT" --language all
```

自动化使用真实 Kernel、隔离 worker 和 fake Provider，验证两套客户端；CLI 子进程清空 `PATH`。真实 Provider smoke 单独执行，会实际调用所选模型，保存终态/计数/回执证据，不保存 Provider 原始内容。

当前范围仅包含 Go、Python 两套完整 SDK；Rust SDK、生成器及工具链要求已移除。macOS arm64 两语言各 45 项协议、故障、demo 和包外消费测试通过，包含 354 条协议样例。Windows/Linux 和完整容量/竞态仍待验证，真实 Provider 的既有结果与本轮自动化分开记录，见 [实施记录](../.octospec/tasks/51-native-rpc-clients/implementation.md)。

本轮六项审查修复及新增回归见[修复记录](../.octospec/tasks/51-native-rpc-clients/review-fixes.md)。Windows 关闭取消测试在非 Windows 主机使用 API stub，只证明控制流与最终释放顺序。
