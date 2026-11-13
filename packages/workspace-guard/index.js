/**
 * workspace-guard —— 把用户的工作区钉在 `/workspace` 下。
 *
 * 为什么需要：`/workspace` 是**宿主目录的 bind mount**，写进去的东西在宿主上有一份真身，
 * 容器重建（发版、休眠唤醒、换镜像）之后还在。而 `/home/dsh/xxx`、`/tmp/xxx` 属于
 * **容器可写层**，`docker rm` 那一刻就蒸发。
 *
 * dsh 原来的行为：用户在界面上「新建项目」选哪个目录，会话 cwd 就是哪个目录。
 * 容器里 Documents 目录查不到，用户随手建在 `/home/dsh/测试1`，于是脚本、报表、克隆下来的
 * 仓库全在可写层——发版即丢，只留一份会话日志能考古。
 *
 * 这个插件管两件事：
 *
 *  1. **新建工作区一律改写到 `<root>/<name>`**。拦截点是 `workspaceRegistry.create(path, title)`
 *     ——「把某个目录登记成工作区」的唯一入口（界面新建走 controller → registry），
 *     改在它上面就覆盖了所有上游调用方，不用动 dsh 源码。
 *     注意 `create` 内部先 `realpath` 再 `stat`，**目录必须已经存在**，所以我们要先 mkdir。
 *  2. **启动时确保根目录本身是一个工作区**（`ensureRoot`）。dsh 的 `bootstrap()` 只在
 *     `initialized === false` 时跑一次，之后新出现的目录不会自动变成工作区；根目录没登记，
 *     cwd 落在这里的会话就只能在「未分组」里待着。
 *
 * 不做旧数据迁移：根外面的旧登记由 `migrate-workspaces.mjs` 在启动前摘掉（见 docs/19），
 * 这里只对「新建」负责。
 *
 * @module plugins/workspace-guard
 */
import { mkdir, readdir } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'

export const name = 'workspace-guard'

/** 等到工作区注册表就绪再 `apply`。 */
export const inject = ['workspaceRegistry']

const DEFAULT_ROOT = '/workspace'
const TAG = '[workspace-guard]'
/** 根工作区在侧栏里显示的名字。 */
const ROOT_TITLE = '工作区'
/** 代理（助理）的独立工作区：目录名与侧栏标题。 */
const AGENT_WORKSPACE_NAME = 'agents'
const AGENT_WORKSPACE_TITLE = '代理工作区'
/** 首次使用时自动落的工作区名（对应 `<root>/default-workspace`）。 */
const DEFAULT_WORKSPACE_NAME = 'default-workspace'

/**
 * 打一行带前缀的日志，便于 `docker logs | grep workspace-guard` 定位。
 *
 * 走 stderr：`dsh --json` 把事件流写在 stdout 上，插件往 stdout 写会污染机器可读输出。
 *
 * @param {string} message 日志正文
 */
function log(message) {
	console.error(`${TAG} ${message}`)
}

/**
 * 清洗单个目录名：去掉分隔符与空名，`.`/`..` 一律视为空。
 *
 * @param {string} segment 请求路径的最后一段
 * @returns {string} 可安全拼在 root 后面的名字，空串表示不可用
 */
function sanitize(segment) {
	if (typeof segment !== 'string') return ''
	const cleaned = segment.replaceAll('\0', '').replaceAll(sep, '').trim()
	if (cleaned === '' || cleaned === '.' || cleaned === '..') return ''
	return cleaned
}

/**
 * 把任意请求路径映射到 `${root}/<name>`。
 *
 * 幂等：已经在 root 里的路径（含 root 本身）原样返回，所以重复套用不会变成
 * `/workspace/workspace/...`。
 *
 * @param {string} root 工作区根目录，容器内绝对路径
 * @param {string} requested 上游传进来的目录
 * @returns {string} 实际要登记（并已存在）的目录
 */
function targetOf(root, requested) {
	if (typeof requested !== 'string' || requested === '') return root
	const absolute = resolve(requested)
	if (absolute === root || absolute.startsWith(root + sep)) return absolute
	const segment = sanitize(basename(absolute))
	return segment === '' ? root : join(root, segment)
}

/**
 * 启动自检：列出不在 root 里的工作区。这些会话的 cwd 仍在可写层，发版会丢产物。
 *
 * @param {string} root 工作区根目录
 * @param {object} registry `ctx.workspaceRegistry`
 */
function warnEscaped(root, registry) {
	let rows = []
	try {
		rows = registry.list()
	} catch {
		return
	}
	const escaped = rows.filter(
		(entity) => typeof entity?.path === 'string' && entity.path !== root && !entity.path.startsWith(root + sep),
	)
	if (escaped.length === 0) return
	log(`${escaped.length} 个旧工作区不在 ${root} 里（不迁移，产物仍在可写层）：${escaped.map((e) => e.path).join(', ')}`)
}

/**
 * 接管注册表方法，返回还原函数。
 *
 * 包三个方法：
 *   `create`             登记新工作区（界面「新建项目」走这里）
 *   `resolveByPath`       按目录反查归属工作区
 *   `initializeDefault`  首次使用时的自动工作区——它直接调 `createCanonical`，
 *                         绕过 `create`，所以要单独把目录解析器换掉
 *
 * @param {object} registry `ctx.workspaceRegistry`
 * @param {string} root 工作区根目录
 * @returns {() => void} 卸载时把方法还原回原型上的实现
 */
function install(registry, root) {
	const originalCreate = registry.create.bind(registry)
	const originalResolveByPath = registry.resolveByPath.bind(registry)
	const originalInitializeDefault =
		typeof registry.initializeDefault === 'function' ? registry.initializeDefault.bind(registry) : undefined

	registry.create = async (path, title) => {
		const target = targetOf(root, path)
		// create 内部要 realpath + stat，目录不存在会直接抛错，所以先建出来
		await mkdir(target, { recursive: true })
		const entity = await originalCreate(target, title)
		if (typeof entity?.path === 'string' && entity.path !== target) {
			log(`注意：create 返回 ${entity.path}，与目标 ${target} 不一致（realpath 或已登记过）`)
		}
		return entity
	}

	registry.resolveByPath = async (path) => {
		const target = targetOf(root, path)
		if (target !== path) {
			const found = await originalResolveByPath(target).catch(() => undefined)
			if (found !== undefined) return found
		}
		return await originalResolveByPath(path)
	}

	if (originalInitializeDefault !== undefined) {
		registry.initializeDefault = (resolveDirectory) =>
			originalInitializeDefault(async () => {
				try {
					return targetOf(root, await resolveDirectory())
				} catch (error) {
					// 容器里没有 xdg-user-dir，系统 Documents 目录查不到，原本会直接放弃自动创建。
					// 这里退回根目录下的固定名字，让首次使用仍然落在持久挂载上。
					log(`默认目录解析失败（${error.message}），退回 ${join(root, DEFAULT_WORKSPACE_NAME)}`)
					return join(root, DEFAULT_WORKSPACE_NAME)
				}
			})
	}

	log(`已接管 workspaceRegistry.create：新建工作区一律落在 ${root}/<name>`)
	warnEscaped(root, registry)

	return () => {
		// 删掉实例上的自有属性，原型上的原实现自动恢复
		delete registry.create
		delete registry.resolveByPath
		delete registry.initializeDefault
		log('已还原 workspaceRegistry')
	}
}

/**
 * 把磁盘上已存在、但没登记进工作区的会话补回侧栏。
 *
 * 为什么会有这种会话：控制面用 `dsh --profile headless` 跑助理，headless 只把会话写进
 * `sessions/--workspace--/`，**不会**调 workspaceRegistry。结果它虽然有 cwd=/workspace、
 * 产物也落在持久盘上，侧栏里却看不到——用户以为「机器人那轮对话没留下记录」。
 *
 * `entity.attachSession(id)` 是 dsh 自己的挂载入口：它会读会话 header、校验 cwd 与工作区
 * 路径一致，再写回 `storages/workspace.json`（走 dsh 的串行写链，不会和 UI 抢写）。
 * 所以这里只负责「找出没挂的」，挂载本身交给 dsh。
 *
 * @param {object} registry `ctx.workspaceRegistry`
 * @param {string} root 工作区根目录
 * @returns {Promise<void>}
 */
/**
 * 会话目录名是 cwd 的 slug：`/workspace` → `--workspace--`，`/workspace/agents` → `--workspace-agents--`。
 *
 * @param {string} home DSH_HOME
 * @param {string} path 工作区绝对路径
 * @returns {string} 会话目录
 */
function sessionDirOf(home, path) {
	return join(home, 'sessions', `--${path.replace(/^\/+/, '').replace(/\/+/g, '-')}--`)
}

async function adoptSessions(registry, root) {
	if (process.env.DSH_WORKSPACE_ADOPT_SESSIONS === '0') return
	const home = process.env.DSH_HOME || '/home/dsh/.dsh'
	const dir = sessionDirOf(home, root)
	let ids = []
	try {
		ids = await readdir(dir)
	} catch {
		return
	}
	if (ids.length === 0) return
	let entity
	try {
		entity = await registry.resolveByPath(root)
	} catch {
		return
	}
	if (!entity || typeof entity.attachSession !== 'function') return
	const onDisk = new Set(ids)
	// 先摘掉「文件已经不在这里」的会话：它们被搬去别的工作区（例如助理会话迁到代理工作区），
	// 留着会在侧栏出现一条点不开的记录。
	for (const id of entity.sessionIds) {
		if (onDisk.has(id)) continue
		try {
			await entity.detachSession(id)
			log(`摘除 ${id}（会话文件已不在 ${root}）`)
		} catch (error) {
			log(`摘除 ${id} 失败：${error.message}`)
		}
	}
	const known = new Set(entity.sessionIds)
	const pending = ids.filter((id) => id.startsWith('session-') && !known.has(id))
	if (pending.length === 0) return
	let adopted = 0
	for (const id of pending) {
		try {
			await entity.attachSession(id)
			adopted += 1
		} catch (error) {
			// 单个会话 cwd 不在 root 下就跳过，不能因为一个坏会话挡住其余
			log(`会话 ${id} 挂载失败：${error.message}`)
		}
	}
	if (adopted > 0) log(`补登记 ${adopted} 个未归组会话到 ${root}（否则它们只在磁盘上，侧栏看不到）`)
}

/**
 * 定时补登记。headless 是**另一个进程**建的会话，不会触发本进程事件，
 * 只能轮询磁盘；30 秒一次，代价是几次 readdir + 一次 header 校验。
 *
 * @param {object} registry `ctx.workspaceRegistry`
 * @param {string} root 工作区根目录
 * @returns {() => void} 停止轮询
 */
function adoptLoop(registry, root) {
	const targets = [root, join(root, AGENT_WORKSPACE_NAME)]
	let stopped = false
	const tick = async () => {
		if (stopped) return
		for (const target of targets) {
			try {
				await adoptSessions(registry, target)
			} catch (error) {
				log(`补登记 ${target} 失败：${error.message}`)
			}
		}
	}
	tick()
	const first = setTimeout(tick, 2000)
	first.unref?.()
	const timer = setInterval(tick, 30_000)
	timer.unref?.()
	return () => {
		stopped = true
		clearTimeout(first)
		clearInterval(timer)
	}
}

/**
 * 确保根目录本身被登记成一个工作区。
 *
 * 为什么必须由插件兜这一层：dsh 的 `bootstrap()` 只在 `initialized === false` 时跑一次，
 * 之后新出现的目录不会自动变成工作区。`/workspace` 上如果没有登记，cwd 落在这里的会话
 * 就只能待在「未分组」——那个桶不能新建会话、不能改名、不能拖动，而且从那里点「新会话」
 * 会回落到「最近用过的真实工作区」，等于把用户从安全位置又拉回可写层。
 *
 * `create` 对同一个 canonical path 是幂等的（直接返回已有 entity，且不改 title），
 * 所以每次启动都调一次是安全的。
 *
 * @param {object} registry `ctx.workspaceRegistry`
 * @param {string} root 工作区根目录
 */
function ensureRoot(registry, root) {
	if (process.env.DSH_WORKSPACE_ROOT_ENSURE === '0') return
	Promise.resolve()
		.then(() => registry.create(root, ROOT_TITLE))
		.then(async (entity) => {
			// create 对已存在的 path 只返回 entity、**不改 title**：dsh 的 bootstrap 建出来的
			// 名字是目录末段（`workspace`），侧栏里就成了英文。只把「自动生成的那个名字」
			// 换成中文，用户自己改过的不碰。
			if (entity?.title === basename(root) && typeof entity.setTitle === 'function') {
				await entity.setTitle(ROOT_TITLE)
			}
			log(`根工作区就位：${root}`)
		})
		.catch((error) => log(`确保根工作区失败（不影响启动）：${error.message}`))
}

/**
 * 确保「代理工作区」（`<root>/agents`）存在并登记。
 *
 * 助理的 headless 进程 cwd 钉在这里，所以它们的会话归到独立分组，
 * 不会挤进用户自己的工作区列表；产物仍然在 `/workspace` 之下，保持持久。
 *
 * @param {object} registry `ctx.workspaceRegistry`
 * @param {string} root 工作区根目录
 * @returns {Promise<void>}
 */
function ensureAgentRoot(registry, root) {
	const agentRoot = join(root, AGENT_WORKSPACE_NAME)
	return Promise.resolve()
		.then(() => registry.create(agentRoot, AGENT_WORKSPACE_TITLE))
		.then(() => log(`代理工作区就位：${agentRoot}`))
		.catch((error) => log(`确保代理工作区失败（不影响启动）：${error.message}`))
}

/**
 * 插件入口。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文
 * @param {{ root?: string }} [config] profile 里这一行的 `config`
 */
export function apply(ctx, config) {
	const root = resolve(config?.root ?? process.env.DSH_WORKSPACE_ROOT ?? DEFAULT_ROOT)
	const registry = ctx.workspaceRegistry

	// 降级而不是让容器起不来：这是收敛路径的护栏，不是主流程
	if (typeof registry?.create !== 'function' || typeof registry?.resolveByPath !== 'function') {
		log(`workspaceRegistry 缺少 create/resolveByPath，本次不干预（root=${root}）`)
		return
	}

	ctx.effect(() => install(registry, root))
	ensureRoot(registry, root)
	ensureAgentRoot(registry, root)
	ctx.effect(() => adoptLoop(registry, root))
}
