# hello-dsh

最小的可用插件：注册一个 `hello_dsh` 工具。复制这个目录就是新插件的起点。

```bash
cp -r plugins/hello-dsh plugins/my-plugin
# 改两处：package.json 的 name / cordis.patch.yml 里的 name 和 id
```

## 结构

| 文件 | 必需 | 作用 |
| --- | --- | --- |
| `package.json` | 是 | `dsh.bundle.patch` 指向组合包的配置层；`engines.dsh` 声明兼容的 dsh 版本 |
| `cordis.patch.yml` | 是 | 被 profile 引用时插入哪些行 |
| `index.js` | 是 | 插件实现，导出 `name` + `apply` |

`peerDependencies` 里的 `@deepseek-ai/dsh-tools` 必须**同时**不装进产物：dsh 的 profile-resolution loader 会把宿主自带的实例路由给它，插件不能自带一份，否则 `ctx.tools` 里的类型和实例会对不上。

## 开发循环

```bash
# 改完代码：重建镜像 + 替换容器，约 10 秒
make reload

# 只想看产物长什么样
cd plugins/hello-dsh && npm pack
# → my-dsh-hello-dsh-0.1.0.tgz（scope 的 @ 会去掉）
```

`make reload` 之后，日志里应该有：

```
[hello-dsh] plugin loaded, greeting = 你好
```

验证装进去的版本确实被加载：

```bash
docker exec -it <容器> sh -lc 'dsh --profile web --dump-config | grep -n hello-dsh'
```

## 目录约定的边界

- 一个插件一个目录，目录名 = 包名最后一段；
- 不要在插件里读宿主的绝对路径、不要 `import` 另一个插件的内部文件——要么走 `ctx` 服务，要么拆成独立包；
- 带原生依赖（`node-pty`、`koffi` 等）的插件必须同时写进 `pnpm-workspace.yaml` 的 `allowBuilds`，否则 pnpm 会跳过它的安装脚本；
- 需要前端 UI 的插件要声明 `dsh.client`，属于另一套机制，不在本样板范围内。
