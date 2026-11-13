/**
 * changes-collector —— 把「这一轮改了哪些文件、每个文件改了什么」抄到卷里。
 *
 * ## 为什么必须在这里做
 * `@deepseek-ai/dsh-workspace-changes` 只在会话日志里追加一条 `workspace/changes` 事件，
 * 事件体只有 `{turn}`；真正的文件清单在 Host 内存，逐文件 diff 在 Session 私有的临时目录里，
 * **Session 一释放就全删**（插件自己的 dispose 里 `rm -rf`）。所以：
 *   - 会话日志能回答「第几轮改过东西」，回答不了「改了哪些文件」；
 *   - 容器重建/进程重启之后，历史轮次连那张卡片都没有了。
 *
 * 抄写只能发生在事件到达的这一刻：此时 `ctx.workspaceChanges.summary/diff` 都还活着。
 * 落点是数据卷 `<DSH_HOME>/changes/<sessionId>/t<turn>.json`，控制面定期收进对象层
 * （`deploy/orchestrator/artifacts.mjs`）。**以轮为文件名**：同一轮可能追加两次事件
 * （轮内记录一次、turn/end 再补一次，后者代表最终状态），按轮覆盖才是对的语义。
 *
 * ## 时序上的一个坑
 * `session.append()` 是同步派发 `session/event`，而 recorder 是在 `append()` **返回之后**
 * 才 `records.set(event.seq, …)`。所以在事件回调里直接调 `summary()` 一定拿到 undefined，
 * 必须让出一轮事件循环再取（这里用 25ms × 最多 40 次的轮询兜住慢机器）。
 *
 * @module plugins/changes-collector
 */
import { mkdir, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'changes-collector'

/** 没有 workspaceChanges 就没有可抄的东西；等它就绪再 apply，缺了也不会把容器搞崩。 */
export const inject = ['workspaceChanges']

const TAG = '[changes-collector]'

/** 只允许安全字符进路径：sessionId 来自会话头，理论上已经安全，这里是最后一道。 */
const SAFE_ID = /^[A-Za-z0-9._-]+$/

/**
 * 打一行带前缀的日志。
 *
 * **必须走 stderr**：`dsh --profile headless --json` 把 JSONL 事件流写在 stdout 上，
 * 插件往 stdout 写一个字，整条流就不是 JSON 了（实测把下游解析直接打挂）。
 * web 入口下 stdout 是日志，但 stderr 同样是日志，两边都不会丢。
 *
 * @param {string} message 日志正文
 */
function log(message) {
	console.error(`${TAG} ${message}`)
}

/**
 * 抄写目录：默认落在数据卷里，容器重建后仍在。
 *
 * @param {{dir?: string}} config 插件配置
 * @returns {string} 绝对路径
 */
function rootOf(config) {
	if (typeof config.dir === 'string' && config.dir.trim() !== '') return config.dir
	const home = process.env.DSH_HOME || join(homedir(), '.dsh')
	return join(home, 'changes')
}

/**
 * 等到 recorder 把这一轮的摘要登记进去。
 *
 * @param {object} service `ctx.workspaceChanges`
 * @param {string} sessionId 会话 id
 * @param {number} seq 事件序号
 * @returns {Promise<object|undefined>} 摘要；一直没出现就返回 undefined
 */
async function waitSummary(service, sessionId, seq) {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		const summary = service.summary(sessionId, seq)
		if (summary !== undefined) return summary
		await new Promise((done) => setTimeout(done, 25))
	}
	return undefined
}

/**
 * 把一条 diff 结果压成可存档的形状。
 *
 * `workspace/changes` 的 diff 有三种 kind：`text`（带 hunks）、`binary`、`oversized`；
 * 会话在算完之前被释放时返回 undefined，这里单独标成 `gone`，免得看起来像「没改动」。
 *
 * @param {object|undefined} diff `ctx.workspaceChanges.diff()` 的结果
 * @param {object} file 摘要里的文件条目
 * @returns {object} 文件条目（合并 diff 字段）
 */
function combine(diff, file) {
	const base = {
		path: file.path,
		display: file.display,
		added: file.added ?? 0,
		deleted: file.deleted ?? 0,
		kind: 'gone',
		action: 'modified',
	}
	if (diff === undefined) return base
	if (diff.kind !== 'text') return { ...base, kind: diff.kind }
	return {
		...base,
		kind: 'text',
		// before=false 是新建、after=false 是删除。摘要本身不带动作，只有对比结果知道。
		action: diff.before === false ? 'created' : diff.after === false ? 'deleted' : 'modified',
		coarse: Boolean(diff.coarse),
		hunks: diff.hunks ?? [],
	}
}

/**
 * 序列化并做体积兜底。
 *
 * 一个轮次改 200 个文件、每个文件几千行，JSON 能到几十 MB——那会把控制面的
 * `syncArtifacts` 拖成分钟级。所以超限时先丢 hunks（保留清单与行数），
 * 再超限就截断文件列表。**永远保留清单**：用户最先要的是「改了哪些」。
 *
 * @param {object} record 完整记录
 * @param {number} maxBytes 允许的字节数
 * @returns {string} JSON 文本
 */
export function serializeRecord(record, maxBytes) {
	const full = JSON.stringify(record)
	if (Buffer.byteLength(full) <= maxBytes) return full
	const lean = {
		...record,
		files: record.files.map(({ hunks, ...rest }) => ({ ...rest, hunks: [] })),
		detailOmitted: true,
	}
	const text = JSON.stringify(lean)
	if (Buffer.byteLength(text) <= maxBytes) return text
	const head = { ...lean, files: lean.files.slice(0, 50), truncated: true }
	return JSON.stringify(head)
}

/**
 * 按轮号裁剪历史文件，只留最近 `maxTurns` 轮。
 *
 * 控制面正常情况下会「收走即删」，但控制面可能没在跑（本机调试、发版窗口），
 * 没有这个上限的话一个活跃会话能把卷写满。
 *
 * @param {string} dir 会话的抄写目录
 * @param {number} maxTurns 保留轮数
 */
async function prune(dir, maxTurns) {
	const names = (await readdir(dir)).filter((n) => /^t\d+\.json$/.test(n))
	if (names.length <= maxTurns) return
	const ordered = names.sort((a, b) => Number(b.slice(1, -5)) - Number(a.slice(1, -5)))
	for (const name of ordered.slice(maxTurns)) await unlink(join(dir, name)).catch(() => {})
}

/**
 * 观察每个会话的 `workspace/changes`，把摘要与逐文件对比抄进卷里。
 *
 * @param {object} ctx Host 上下文
 * @param {{dir?: string, maxFiles?: number, maxBytes?: number, maxTurns?: number}} [config] 配置
 */
export function apply(ctx, config = {}) {
	const root = rootOf(config)
	const maxFiles = Number(config.maxFiles ?? 200)
	const maxBytes = Number(config.maxBytes ?? 1_048_576)
	const maxTurns = Number(config.maxTurns ?? 200)
	const lifetime = new AbortController()
	/** 每会话一条串行链：同一轮的两次记录不能并行写同一个文件。 */
	const chains = new Map()

	/**
	 * 按会话串行执行，避免同一轮的两个事件互相覆盖。
	 *
	 * @param {string} key 会话 id
	 * @param {() => Promise<void>} task 任务
	 */
	const enqueue = (key, task) => {
		const previous = chains.get(key) ?? Promise.resolve()
		const next = previous.then(task).catch((error) => {
			if (!lifetime.signal.aborted) log(`记录失败（${key}）：${error?.message || error}`)
		})
		chains.set(key, next)
	}

	/**
	 * 一个事件的完整抄写流程。
	 *
	 * @param {object} session 会话
	 * @param {object} event `workspace/changes` 事件
	 */
	const collect = async (session, event) => {
		const sessionId = String(session.id)
		if (!SAFE_ID.test(sessionId)) return
		const summary = await waitSummary(ctx.workspaceChanges, sessionId, event.seq)
		if (summary === undefined) {
			// recorder 已经随 Session 释放时会发生：没有可抄的内容，不是错误
			return
		}
		const files = []
		for (const [index, file] of (summary.files ?? []).slice(0, maxFiles).entries()) {
			let diff
			try {
				diff = await ctx.workspaceChanges.diff(sessionId, event.seq, index, lifetime.signal)
			} catch (error) {
				if (lifetime.signal.aborted) return
				diff = undefined
				log(`取 diff 失败（${file?.path}）：${error?.message || error}`)
			}
			files.push(combine(diff, file))
		}
		// 摘要被 maxFiles 截断时，total 仍报告完整数量；这里把差额显式记下来
		if ((summary.total ?? files.length) > files.length) {
			log(`第 ${summary.turn} 轮有 ${summary.total} 个文件，只记了前 ${files.length} 个（maxFiles=${maxFiles}）`)
		}
		const record = {
			version: 1,
			session: sessionId,
			turn: summary.turn,
			seq: event.seq,
			cwd: summary.cwd ?? null,
			recordedAt: new Date().toISOString(),
			total: summary.total ?? files.length,
			added: summary.added ?? 0,
			deleted: summary.deleted ?? 0,
			files,
		}
		const dir = join(root, sessionId)
		await mkdir(dir, { recursive: true })
		const target = join(dir, `t${summary.turn}.json`)
		const temp = `${target}.tmp-${process.pid}`
		await writeFile(temp, serializeRecord(record, maxBytes))
		// 原子替换：控制面可能正在读，半截 JSON 会让它把这一轮整条丢掉
		await rename(temp, target)
		await prune(dir, maxTurns)
	}

	ctx.on('session/event', (session, event) => {
		if (event.type !== 'workspace/changes') return
		const sessionId = String(session.id)
		// 让出一轮事件循环：recorder 的 records.set 在 append() 返回之后才发生
		setTimeout(() => {
			enqueue(sessionId, () => collect(session, event))
		}, 0)
	})

	ctx.effect(() => () => {
		// 只中止在算的 diff。目录不删：里面可能是还没被控制面收走的轮次，
		// 删掉等于把产物扔了（与 workspace-changes 释放时删临时目录的行为刻意不同）。
		lifetime.abort()
		chains.clear()
	})

	log(`已接管：轮级变更摘要写入 ${root}/<session>/t<turn>.json`)
}
