# Channel Gateway 与 Harness 代理

[English](../../../en/guides/harnesses/channel-gateway.md) | [Harness 目录](../harnesses.md)

本页用于配置“仅 Harness 使用代理、Channel Gateway Extra 不继承代理变量”。不要求开启 TUN。Runtime 已支持逐轮环境变量，无需新增 Adapter 或修改源码。各 Harness 的安装、认证和差异见[专题目录](../harnesses.md)。

## 安装与准备

1. 按 [CLI 安装与运维](../../getting-started/cli.md)安装 Runtime，使用 Node.js 24.x 或 26.x；安装所选 Harness 并以运行 Runtime 的账号认证。Runtime 不自动安装 Harness。
2. 准备可用的 Octo IM Bot、API 地址及受保护凭据。不要把真实 token 放入 Git 或公开终端日志。
3. 准备已有的绝对工作目录及正在监听的本地代理。本例使用 HTTP CONNECT 代理 `http://127.0.0.1:7890`；HTTPS 目标的代理 URL 仍为 http。远端 Kernel 使用它所在机器的回环地址，而不是 UI 机器的地址。
4. 区分两种认证：`bf_token` 用于 Octo IM；`agy` 或其他 Harness 的原生登录用于模型服务。代理配置不替代任何一种认证。

## 仅 Harness 使用代理

替换以下命令中的 API 地址、Bot 身份、凭据和工作目录，然后直接执行。配置内容内联传入，无需创建配置文件。示例使用 Antigravity；其他 Harness 使用各自专题的 adapter 字段和审批模式。此命令会替换整个声明，必须保留已有其他 Bot。以下写法适用于 Bash / Zsh；包含真实凭据的命令不要保存到共享 shell 历史。

```bash
octo-runtime channel-gateway extraset <<< '{
  "module": "@mininglamp-oss/octo-runtime-extra-channel-gateway",
  "enabled": true,
  "config": {
    "bots": [
      {
        "api_url": "https://im.example.com/api",
        "bot_id": "<BOT_ID>",
        "bot_name": "local-assistant",
        "bf_token": "<BOT_TOKEN>",
        "adapter": {
          "adapter_type": "antigravity",
          "workdir": "/absolute/workspace",
          "model": "<MODEL_ID>",
          "effort": "medium"
        },
        "context": {
          "schema": "octo.context-envelope/v3",
          "items": [
            {
              "namespace": "octo.execution",
              "name": "envs",
              "payload": {
                "env_variables": [
                  {
                    "key": "http_proxy",
                    "value": "http://127.0.0.1:7890"
                  },
                  {
                    "key": "HTTP_PROXY",
                    "value": "http://127.0.0.1:7890"
                  },
                  {
                    "key": "https_proxy",
                    "value": "http://127.0.0.1:7890"
                  },
                  {
                    "key": "HTTPS_PROXY",
                    "value": "http://127.0.0.1:7890"
                  },
                  {
                    "key": "all_proxy",
                    "value": "http://127.0.0.1:7890"
                  },
                  {
                    "key": "ALL_PROXY",
                    "value": "http://127.0.0.1:7890"
                  },
                  {
                    "key": "no_proxy",
                    "value": "localhost,127.0.0.1,::1"
                  },
                  {
                    "key": "NO_PROXY",
                    "value": "localhost,127.0.0.1,::1"
                  }
                ]
              }
            }
          ]
        }
      }
    ]
  }
}'
```

> **可选参数**：`bot_name` 是 Bot 的显示名称；`model` 和 `effort` 均可省略，省略时使用所选 Harness 自身的默认设置。`<MODEL_ID>` 请替换为该 Harness 支持的模型 ID；`effort` 可填 `low`、`medium`、`high` 或 `xhigh`，实际支持范围由 Adapter 和 Harness 决定。

代理项的位置是 `config.bots[i].context.items`，不是 `adapter.envs`、顶层 `envs` 或宿主进程的全局环境。`env_variables` 必须是 `{key,value}` 列表，不接受字典；不展开 `$http_proxy`，因此示例重复完整地址。键必须唯一，空列表不会清除继承环境。没有代理需求时移除该 envs 项。

作用范围：所选 Bot 的本轮 Provider 子进程及其按原生规则继承环境的工具/stdio MCP。其他 Bot 不会获得这些覆盖；Gateway 的 HTTP/WebSocket 连接不读取该 Context 来设置自身代理。它是进程环境隔离，不是网络沙箱，也不保证每个上游网络库都识别这些变量。

OpenClaw 是例外：它连接独立运行的 Gateway，拒绝非空逐轮 envs；在 OpenClaw 服务启动环境设置代理，见 [OpenClaw 专题](openclaw.md)。

## 启动或重新加载

上面的 `extraset` 命令保存完整声明；写盘成功不表示运行中的 Extra 已加载，业务配置在 Extra 加载时校验。新安装先启动 Kernel，再启动 Gateway：

```sh
octo-runtime executor-kernel start
octo-runtime channel-gateway start
```

已有 Gateway 服务更新后执行 `octo-runtime channel-gateway restart`。使用自定义 Home 时，每条命令传入相同的 `--home`。SDK 宿主将上述 `config` 交给 `createExtraService`，变更配置后关闭并重新创建整个 Extra；装配见 [Extra 指南](../extras.md)。

这些命令假定宿主环境没有代理变量。若此前全局 export 过代理，必须清除新启动进程继承的大小写 HTTP/HTTPS/ALL_PROXY 变量，并按原服务管理器更新服务环境后重新启动受影响宿主。终端 unset 不会改变已运行服务，也不保证覆盖服务管理器预设环境。不要为了 Provider 代理把变量写入共同的 Runtime/Extra 服务环境。

## 验证顺序

1. 在临时工作目录对原生 Harness 发一个无工具的小请求，先确认原生账号和代理可用；此步骤不验证 IM。Antigravity 的 Gateway 配置与启动步骤见[专题](antigravity.md)。
2. 在 Octo IM 向该 Bot 发送唯一短标记，要求只返回该标记、不调用工具。
3. 确认 Gateway 连接、Provider 返回唯一成功终态，并从 IM 历史回读完整标记。连接成功、排队回执和进度卡均不能替代结果回读。
4. 核对宿主启动环境没有代理变量；若要求证明 Extra 实际直连，还需核对该宿主的连接目的地址及系统代理设置。

非 TUN 模式下，操作系统系统代理仍是独立因素；网络库是否读取它由原生实现决定。“没有代理变量”不能直接推导“所有连接都直连”。

## 已验证与未验证

2026-11-01，macOS arm64、Node 24.22.2、agy 1.4.12、Runtime 源码 `85411725`：将上述 Bot Context 通过真实 Gateway 配置校验与 dispatcher、独立 Kernel、Antigravity Adapter 发起请求，约 12 秒获得预期标记及唯一 `run.completed`；宿主代理变量在前后均为空，Kernel 清理完成。该次验证未经过 IM 接收和发送。

完整 QA IM 测试在发送前被 Bot 认证拒绝阻塞（`err.server.bot_api.auth_failed`），不能标记 IM 验收通过；也未证明 Extra 的实际连接绕过系统代理。其他 Harness 本轮没有新增真实验收。详细记录见[任务验证](../../../../.octospec/tasks/252-antigravity-proxy/validation.md)。

## 故障定位

- 原生请求失败：先检查 Harness 登录、账号模型权限、代理及服务可达性；不要只凭版本 probe 判定可用。
- 原生成功但 Runtime 失败：检查后台 PATH、工作目录、运行账号以及选中 Bot 的 envs 项。动态 `loadContexts` 返回同名 envs 项时会整项替换静态项，需保留所需全部变量。
- IM Bot 认证失败：修复该 IM 凭据；它与模型账号认证不同，不通过切换其他 Bot 掩盖原账号故障。
- 仅 `all_proxy` 失败：本机 agy 1.4.12 曾出现该现象，完整 HTTP/HTTPS 变量组合成功；未逐项隔离大小写变量，不能宣称唯一必要变量或其他版本的行为。

[环境变量格式](../../reference/contexts.md) · [Extra 自有命令](../extra-commands.md)
