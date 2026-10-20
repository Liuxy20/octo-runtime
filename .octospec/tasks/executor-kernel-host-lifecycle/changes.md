---
type: Plan
title: 逐文件责任搬迁与旧 daemon 删除清单
description: 指定新模块路径、切换阶段、删除点和可构建检查点，不建立旧架构兼容层。
tags: [architecture, lifecycle, planning, installation]
timestamp: 2026-10-20T00:00:00Z
---

# 改动原则与最终结构

用户已选择直接改名拆分或删除重写。复用正确执行代码，重写混合编排；最终没有旧 daemon
程序、旧包、旧命令或旧 SDK API。开发过程中的可构建检查点不等于发布两套架构。
下表保留责任搬迁目标；运行代码已实施，实际文件布局如下。验证证据见 [实施记录](implementation.md)。

```text
apps/cli/                              薄 HostApp 命令层
packages/octo-runtime-executor-core/    已有唯一执行实现
packages/octo-runtime-executor-kernel/
  src/server.ts                        公共执行 IPC，无 Extra
  src/client.ts                        attach、查回、续订
  src/host-run-service.ts              有界源流消费/窗口
  src/{process,rpc,serve,runner}.ts     worker 传输与启动
  src/supervisor.ts                    探活、预算、替换、受管回收
  src/{endpoint,invocation-manifest}.ts 端点租约与孤儿回收
  src/entry.ts                         独立服务入口
packages/octo-runtime-host-sdk/
  src/kernel.ts                        owned Kernel handle
  src/{extra,extras,extra-config,extra-entry,extra-port}.ts
  src/{dependencies,process-channel}.ts 函数代理与有界 IPC
  src/{launch,native}.ts               Node/原生组件生命周期
  src/{home,identity,endpoint}.ts       显式宿主值与既有状态保护
public/{executor-kernel,host,extra}.ts
```

## C01–C24 文件去向

| ID | 当前源码 / 产物 | 目标及必要变化 | 阶段 / 删除点 |
| --- | --- | --- | --- |
| C01 | adapter-host/src/host-run-service.ts | Kernel/src/run-service.ts；独立消费源，连接不拥有 iterator；保留中央窗口 | M1 搬迁；全仓 import 切换后删原文件 |
| C02 | adapter-host/src/rpc.ts | Kernel/src/worker/rpc.ts；执行 NDJSON 保留，新增完整请求截止/pending清理 | M1 |
| C03 | adapter-host/src/process.ts | Kernel/src/worker/process.ts；保留15秒就绪、stderr尾部、进程组；增加控制IPC | M1/M2 |
| C04 | adapter-host/src/serve.ts、runner.ts | Kernel/src/worker/serve.ts、runner.ts；创建同一 AgentExecutor，主循环响应ping | M1/M2 |
| C05 | adapter-host/src/module-specifier.ts、runtime-configuration.ts | worker同名工具；不重复 Core 解析，保留 Windows 路径规则 | M1 |
| C06 | adapter-host/src/socket-server.ts | 正确 framing/权限逻辑并入新 Kernel server，旧 socket 壳删除 | M1 |
| C07 | adapter-host/src/index.ts、package.json | 所有传输消费者切到 Kernel；Core 消费者直接 import Core；删除旧别名和整个 adapter-host 包 | M5 最后清理，不留 re-export 包 |
| C08 | daemon/src/server.ts | 执行分发进入 Kernel server；配置值合成进入 Host；worker恢复改为独立 supervisor；原混合server删除 | M1拆出，M5删除整个旧包 |
| C09 | daemon/src/runtime/run-stream.ts、runtime-contract.ts | Kernel client；统一 Schema、实例身份、ACK未知与有界修复，取消与close分开 | M1 |
| C10 | daemon/src/runtime/supervisor.ts、runner.ts | Host SDK kernel.ts；owned启动/停止重写，parent控制与公共执行端点分开 | M4；旧账号/模块会话结构不照搬 |
| C11 | daemon/src/extras.ts、extra-config.ts | Host SDK extra/loader.ts、config.ts；保留函数入口、名称/容量、失败所有权 | M3a |
| C12 | daemon/src/runtime/local-extras.ts | 执行端口适配逻辑进入 Extra runner；业务不再装配在SDK进程 | M3a；M3b接专用函数代理 |
| C13 | daemon/src/context-loader.ts | Host SDK extra/context-loader.ts；保持5秒/8个真实占额、合并/预检规则，分离 proxy物理操作池 | M3b |
| C14 | daemon/src/runtime/home.ts、identity.ts、runtime-endpoint.ts、invocation-manifest.ts | Home/identity移Host SDK；受管worker清单移Kernel；endpoint统一导出函数 | M1/M4；磁盘身份schema不变 |
| C15 | daemon/src/runtime/daemon-runtime.ts、types.ts、index.ts | 新Host能力对象取代createDaemonRuntime/startAccount一体入口；账号作用域由Host显式组合 | M4新API；M5删旧API，不做别名 |
| C16 | daemon/src/modules.ts、各Extra/daemon-module.ts | 删除旧DaemonModules容器及daemon-module入口；Extra业务在现有extra.ts内保留 | M3a业务入口切换；M5删容器 |
| C17 | apps/daemon/src/*、apps/daemon/package.json | Kernel独立entry与Host Extra runner承接必要启动；旧launcher/应用包删除 | M5 |
| C18 | apps/cli/src/main.ts、help.ts、index.ts | 新服务命令组、逐服务状态/exit code；删除daemon分支 | M5 |
| C19 | apps/cli/src/service-control.ts | 按component生成独立ServiceSpec；复用cross-service后端，无旧service ID分支 | M5 |
| C20 | apps/cli/src/extras.ts、state.ts | 保留完整声明/原子写/文件保护；显式channel-gateway restart生效，不增加reload动作；路径仍home/extras/name/config.json | M5 |
| C21 | apps/cli/src/temporary-daemon.ts、daemon-output.ts、playboard.ts | 改名temporary-kernel.ts、service-output.ts；playboard只拥有本次临时Kernel | M5；旧文件删除 |
| C22 | 三个Extra的extra.ts、package.json及公开Extra类型imports | 业务入口仍函数式，导入新公共类型/执行端口；不重写IM/WeCom/WebUI业务 | M3a/M3b |
| C23 | 根package.json、pnpm-lock.yaml、public/*、脚本中的runner URL | 加/删内部生产依赖、exports/bin/生成声明；删除旧bin和旧路径；不借机升级第三方依赖 | 各阶段同步，M6 tgz负向验证 |
| C24 | test/*、test-support/*、verify-release/verify-windows-release/verify-daemon-deployment、CI与指南 | 测试迁到新入口并保留语义；daemon专项脚本改名kernel；文档和规则反映真实实现 | 各阶段对应检查，M6总验收 |

对每行先用 rg 补全真实 import/URL 消费者再编辑；表是责任与路径合同，不意味着只改列出的几个文件。
禁止通过复制完整旧包同时维护两份实现；允许 git mv 后在新边界内删改。

## 可构建切换顺序

1. M0：新增公共 IPC Schema/fixture 和模块骨架；旧调用仍是未处理源码，不增加新兼容导出。
2. M1/M2：传输文件搬到 Kernel，同一次变更更新仍在开发中的消费者 imports。旧 server 暂时可消费新传输，但新 Kernel 绝不依赖旧 daemon；M5 前不得交付该旧入口。
3. M3a：引入独立 Extra runner，内置入口逐个可运行；M3b加入动态函数代理。旧容器的业务引用退出。
4. M4：Host SDK入口、身份工具及消费测试切换；旧DaemonRuntime删除与相关源码调用点更新必须同一检查点完成。
5. M5：CLI/临时执行切换后删除apps/daemon、daemon/adapter-host剩余目录、旧bin/API/命令和服务定义代码。分支发布面只剩新结构。
6. M6：静态守卫和仓库外tgz确认无旧入口、无内部路径外泄。未改外部产品源码不得声称该产品已适配，必要调用改动交给 #50。

每次移动要求 `pnpm typecheck` 与受影响合同测试可通过；不要求在未完成的检查点发布。
中途失败在本分支修复或调整本次未发布改动，不提供运行时降级旧daemon的选项。

## 新服务命名与命令

CLI公开生命周期命令按用户指定固定为：

```text
octo-runtime executor-kernel uninstall|install|start|restart|stop|run
octo-runtime channel-gateway uninstall|install|start|restart|stop|run
```

这两个命令组均只控制自己的服务；配置变更后使用channel-gateway restart应用最新声明，
不提供额外reload动作。其他Extra/外部binary的共享SDK启动合同仍验收，公开CLI扩展留在#49。

实际未增加 temporary-kernel/service-output 文件；playboard 直接使用 owned Kernel，旧两文件删除。Kernel worker 工具保持平铺以减少无必要目录层级。

CLI endpoint统一由一个函数产生：POSIX为 `<home>/sockets/octo-runtime-executor-kernel.sock`；
Windows为命名管道 `octo-runtime-kernel-<规范化home的SHA256前16位>`，保留同一平台Home规范化规则。
显式endpoint覆盖必须两端一致；SDK无CLI目录要求。临时Kernel使用独立临时目录/随机管道，不占正式名称。
旧daemon端点不自动探测、不重命名、不删除。

服务ID采用 `cn.mininglamp.octo-runtime.h<homeHash16>.<component>`，component为executor-kernel、
extra-名称或loop-daemon；平台名称分别从同一ID生成。HomeHash只分区，不是安全边界。
旧 `cn.mininglamp.octo-runtime.daemon` 不被新代码安装、查询或接管。

| 操作 | 固定语义 |
| --- | --- |
| run | 前台运行目标组件；退出只停止该目标拥有的子进程。 |
| install | 显式写该组件服务定义；首次默认自启关闭，--autostart=true/false显式设置；重复install未指定时保持现值；缺依赖失败。 |
| start / restart | 只作用于已安装目标，未安装报SERVICE_NOT_INSTALLED；不隐式install或修改自启。 |
| stop / uninstall | 只停止该目标；uninstall删除服务定义，保留身份/配置/Provider数据。 |
| channel-gateway restart | 读取完整声明，确认旧进程停止后启动新进程；Kernel和其他Extra不变。 |
| 全局status --json | 返回两个组件独立健康维度；探测本身不安装、启动或修复。 |

CLI exit code：0为所请求操作完成；2为参数/声明非法；3为组件缺失或未安装；4为未就绪/不可达；
5为关闭不完整；1为其他失败。status在服务停止时仍可成功返回状态，只有查询本身失败才非0。
存在进程不等于ready；启动就绪截止30秒（含worker15秒），受控关闭5秒加平台强制回收预算。
旧命令组走普通未知命令，不增加旧名称兼容分支。
两个新命令组的help精确列出六个动作；不额外暴露enable/disable/status子命令。
channel-gateway run在Kernel未就绪时如实显示execution unavailable，不暗中启动Kernel。
executor-kernel stop使ChannelGateway的执行连接不可用，但不停止其独立进程或伪报业务执行成功。

## 源码删除与用户状态保护

删除的是本仓代码、导出和新发行物内的旧入口，不是用户正在运行的服务/目录。
规划和自动化只操作隔离Home与本次创建进程。机器上已有旧服务的卸载/停止由实际部署操作显式处理，
本任务不新增检测/迁移框架，也不自动删Home、复制身份或重置profile。
用户要求“旧daemon没了”落实为A27静态和产物负向断言，不能只改文档名称而留下旧程序。
