/**
 * hello-dsh —— DSH 增量插件样板。
 *
 * 形态：一个导出 `name` + `apply` 的 ESM 模块。`apply` 在插件加载时被调用一次，
 * 所有通过 `ctx` 注册的东西（工具、事件、定时器）都会在插件卸载时被自动清理。
 *
 * 纯 JS、无构建步骤：`npm pack` 出来的 tarball 就是可安装产物。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'hello-dsh'

/**
 * `inject` 让 Cordis 等到这些服务就绪后再调用 `apply`。
 * 这里需要工具注册表，所以声明 `tools`。
 */
export const inject = ['tools']

/**
 * 注册一个 `hello_dsh` 工具，模型可以主动调用它。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文
 * @param {{ greeting?: string }} [config] 来自 profile 同名行的 `config` 字段
 */
export function apply(ctx, config) {
  const greeting = config?.greeting ?? '你好'

  // 启动时打一行日志：样板插件的第一职责是「证明自己被加载了」。
  // 容器里 `make logs | grep hello-dsh` 应该能看到它。
  console.error('[hello-dsh] plugin loaded, greeting =', greeting)

  ctx.tools.register(
    defineTool({
      name: 'hello_dsh',
      description: '打个招呼，用于验证插件是否已正确加载。',
      parameters: {
        who: { type: 'string', required: true, description: '要打招呼的对象' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args) {
        return `${greeting}，${args.who}！这条消息来自 hello-dsh 插件。`
      },
    }),
  )
}
