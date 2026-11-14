# Colony Plugins

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）用的插件集合。
纯 ESM，无构建步骤，`apply(ctx)` 直接跑在 dsh 进程里。

**你不需要任何平台就能用它们**：装上 `workspace-guard`，你本机跑的 dsh 也会把工作区落在持久目录里。

| 包 | 一句话 | 依赖 |
|---|---|---|
| `@colony/dsh-workspace-guard` | 把新建工作区强制落在 `/workspace/<name>`，会话 cwd 与产物都在持久挂载里；顺带把 headless 建的会话补登记进侧栏 | 无 |
| `@colony/dsh-changes-collector` | 把 `workspace/changes` 的轮级摘要与逐文件 diff 落成卷里的 JSON，供控制面收进对象层 | 无 |
| `@colony/dsh-market-skill` | 从控制面 API 加载团队技能，容器内不落任何技能文件 | 控制面 API |
| `@colony/dsh-client-ui-market` | 侧栏「市场」面板：技能与连接器的浏览、安装、启停 | 控制面 API |
| `@colony/dsh-client-ui-assistants` | 侧栏「助理」面板：把钉钉 / 飞书机器人接到一个固定会话上 | 控制面 API |
| `@colony/dsh-hello` | 样板插件：注册一个 `hello_dsh` 工具 | 无 |

## 安装

单个插件直接指目录（开发时最顺手）：

```bash
dsh plugin add /path/to/colony-dsh-plugins/packages/workspace-guard
```

打成 tarball 再装（跟镜像里的做法一致）：

```bash
cd packages/workspace-guard && npm pack
dsh plugin add ./colony-workspace-guard-0.1.0.tgz
```

一次装全部：

```bash
for d in packages/*/; do (cd "$d" && npm pack --pack-destination /tmp/plugins); done
for f in /tmp/plugins/*.tgz; do dsh plugin add "$f"; done
```

> 插件是**进程内代码**，`apply(ctx)` 的权限等于 dsh 本身。装之前读一眼 `index.js`，
> 别装来路不明的包。这也是本项目所有插件都只有几百行、不引第三方依赖的原因。

## 命名与字段约定

跟生态对齐（对 npm 上 1.4 万个带 `dsh-plugin` 关键字的包归纳出来，不是自创）：

| 项 | 约定 | 例 |
|---|---|---|
| 包名 | `dsh-<name>`，或 `@<scope>/dsh-<name>` | `dsh-cost-meter`、`@colony/dsh-workspace-guard` |
| keywords | 必含 `dsh`、`dsh-plugin`、`deepseek-harness`；带 UI 的再加 `dsh-client-plugin` | — |
| `dsh.bundle.patch` | 指向配置层文件，缺了能装但不会生效 | `./cordis.patch.yml` |
| `dsh.client` | 仅浏览器侧插件：`platform: "web"` + `inject` 依赖的 UI 包 | `inject: ["@deepseek-ai/dsh-client-ui-sidebar"]` |
| `dsh.compatibility` / `engines` | 声明兼容的 dsh 与 node 版本，dsh 0.3 会破接口 | `dsh: ">=0.2.0 <0.3.0"`、`node: ">=22"` |

`@colony/dsh-hello` 是最小样板：一个 `index.js` + 一个 `cordis.patch.yml` + 一个 `dsh.bundle` 字段，
照抄就能起一个新插件。CI 会校验上面这几条，命名或字段不对直接红。

## 兼容性

每个包在 `package.json` 里声明了 `engines.dsh`，当前都是 `>=0.2.0 <0.3.0`。
dsh 0.3 会改插件接口，届时按包升级，不保证跨大版本兼容。

## 每个插件长什么样

```
packages/<name>/
  package.json       # 声明 dsh.bundle.patch，告诉 dsh 装哪个配置层
  cordis.patch.yml   # 配置层：insert 一个插件条目，可带 config
  index.js           # export const name / apply(ctx)
  lib/               # 需要浏览器侧的插件才有（client-ui-*）
```

`client-ui-*` 走 `lib/index.js`（服务端注册 slot）+ `lib/client.js`（浏览器侧渲染）双入口，
`cordis.patch.yml` 里同时声明两侧。

## 与平台仓的关系

这些插件同时被一个「团队版平台」仓库以快照方式内置（镜像里自动打包安装）。

**上游在平台仓**：本仓的 `packages/` 由平台仓 `make mirror-plugins` 导出，是面向使用者的
分发形态——你可以直接装、可以直接提 issue，但代码改动请提到平台仓（那里才有 dsh 容器与
数据库夹具，插件的行为验证都在那儿）。在 CI 里加一条「快照是否落后于上游」的检查即可防漂移。

这样分工的理由很简单：这几个插件深度依赖平台侧接口（市场、助理都要调控制面），
拆成独立上游会让每次联调都要跨仓打补丁。

## 开发

```bash
node --check packages/workspace-guard/index.js   # 语法
node packages/hello-dsh/index.js                 # 纯 JS，误跑会报错但不产生副作用
```

插件的完整自测在平台仓（`make verify-workspace-guard` 等），因为那里才有 dsh 容器与数据库夹具。

## 许可

[Apache-2.0](LICENSE)。
