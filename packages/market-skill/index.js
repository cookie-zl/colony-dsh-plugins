/**
 * market-skill —— 技能来源改为「控制面 API」，容器里不落任何技能文件。
 *
 * 动机：原先技能靠 `docker exec` 写进数据卷，于是出现四个问题——休眠/归档的团队装不了、
 * 卷和 packages.json 会漂移、团队回收就丢技能、「用完即毁」做不到。dsh 的技能加载本身
 * 是 provider 注册表（`ctx.skills.registerProvider`），`@deepseek-ai/dsh-skill-filesystem`
 * 只是其中一种实现，所以换成 HTTP 拉取不需要改内核。
 *
 * 两条分发通道，按包内文件数自动选择：
 *
 *   单个 SKILL.md  → GET /market/skills/:name/:version       纯文本，返回 opaque
 *   多文件（带 references/ scripts/）
 *                  → GET /market/skills/:name/:version/bundle  tar.gz，物化到
 *                    <DSH_HOME>/market-skills/<name>@<ver>-<digest:8>/ 后返回 directory
 *
 * 物化目录**绝不能放 `<DSH_HOME>/skills/`**：那是 `dsh-skill-filesystem` 的 user-dsh 根
 * （rank 400），放那儿会让同一个技能有两个 provider 提供，filesystem 那份赢——于是
 * 「在门户里停用了这个技能，容器里那份还在生效」，又回到两套事实。放在 market-skills/
 * 下，filesystem provider 根本不扫它，技能是否可见完全由库决定。这条是整个方案支点。
 *
 * 其余三条边界，代码里都做了显式处理，不要误以为可以忽略：
 *   1. 控制面不可达时新会话没有技能 —— 返回 `complete: false` 让内核保留 last-good，
 *      不用磁盘副本兜底（那等于把落盘方案再养一遍）。
 *   2. dsh 的目录缓存没有 TTL，只认 `invalidate()` —— 所以这里比 `rev`，变了才通知。
 *   3. 包内容只按 digest 判断要不要重下 —— 不比 mtime、不比版本号。
 *
 * 环境变量（全部由 compose / team-up.sh 注入）：
 *   MARKET_API_URL    控制面地址，默认 http://host.docker.internal:9700
 *   MARKET_API_TOKEN  每团队一枚的只读 token（不是 console-token）
 *   DSH_TEAM          团队标识，只用于日志与 metadata，鉴权完全靠 token
 *   DSH_HOME          容器内 dsh 主目录，默认 ~/.dsh（物化落点相对它算）
 *   MARKET_SKILL_CACHE       物化目录，默认 <DSH_HOME>/market-skills
 *   MARKET_SKILL_TTL_MS      进程内缓存时长，默认 5000
 *   MARKET_SKILL_TIMEOUT_MS  单次请求超时，默认 2000
 *   MARKET_SKILL_RANK        与同名技能竞争时的优先级，默认 550（本地来源都赢它）
 *   MARKET_SKILL_PREWARM     启动后异步预拉的多文件包个数，默认 5，设 0 关闭
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { gunzipSync } from 'node:zlib'

export const name = 'market-skill'

/** 需要技能注册表；`apply` 会在它就绪后才被调用。 */
export const inject = ['skills']

/** 本 provider 在 `ctx.skills` 里的名字。 */
const PROVIDER = 'market'

/** 物化目录里的标记文件：判断「这个目录是不是我要的那一版」只看它。 */
const MARKER = '.dsh-market.json'

const cfg = {
	base: (process.env.MARKET_API_URL || 'http://host.docker.internal:9700').replace(/\/+$/, ''),
	token: process.env.MARKET_API_TOKEN || '',
	team: process.env.DSH_TEAM || '',
	ttlMs: Number(process.env.MARKET_SKILL_TTL_MS || 5000),
	timeoutMs: Number(process.env.MARKET_SKILL_TIMEOUT_MS || 2000),
	rank: Number(process.env.MARKET_SKILL_RANK || 550),
	cache: process.env.MARKET_SKILL_CACHE || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'market-skills'),
	prewarm: Number(process.env.MARKET_SKILL_PREWARM ?? 5),
}

// 进程级缓存：一个 dsh 进程一份，与 scope 无关。
// 内核那层按 scope 分是为了作用域正确性；这里只负责把「N 个会话 × 每步一次」压成 1 次请求。
const state = { rev: null, at: 0, items: [] }
/** 单飞：内核会重试，多个会话同时 miss 时不能各打一次请求。 */
let inflight = null
/** 按目录单飞：同一版本被多个会话同时加载时只解包一次。 */
const materializing = new Map()

/**
 * 给 fetch 找一个会「超时或被调用方取消，先到先算」的信号。
 *
 * @param {AbortSignal} [signal] 调用方传入的取消信号
 * @returns {AbortSignal}
 */
function signalFor(signal) {
	const timeout = AbortSignal.timeout(cfg.timeoutMs)
	if (!signal) return timeout
	return typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : timeout
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex')

/** 剥掉 SKILL.md 的 frontmatter。与控制面 `bundle.mjs` 里的同名函数保持同一份语义。 */
function stripFrontmatter(text) {
	const body = String(text ?? '').replace(/^\uFEFF/, '')
	if (!body.startsWith('---')) return body
	const end = body.indexOf('\n---', 3)
	if (end === -1) return body
	const after = body.indexOf('\n', end + 4)
	return after === -1 ? '' : body.slice(after + 1).replace(/^\s*\n/, '')
}

/**
 * 包内路径规范化。与控制面同一套规则——两边不一致就等于给了一条绕过路径。
 *
 * @param {string} raw
 * @returns {string|null} 不安全则 null
 */
function safeEntryPath(raw) {
	let path = String(raw ?? '').replace(/\\/g, '/').trim()
	if (!path || path.includes('\u0000') || path.startsWith('/') || /^[A-Za-z]:/.test(path)) return null
	while (path.startsWith('./')) path = path.slice(2)
	const parts = []
	for (const part of path.split('/')) {
		if (part === '' || part === '.') continue
		if (part === '..') return null
		parts.push(part)
	}
	return parts.length ? parts.join('/') : null
}

/**
 * 解 tar.gz。只认普通文件与目录条目，其余类型一律报错。
 *
 * 为什么自己解而不调 `tar` 命令：tar 的符号链接条目可以指向包外，后续条目再写穿过去，
 * 事前检查名字挡不住。只接受 typeflag '0' 就没有这类语义，代价是几十行解析代码。
 * 这段是与 `deploy/orchestrator/bundle.mjs` 的只读镜像——那边写、这边读，
 * 解法器里没有「打包」逻辑，所以不会出现两个写实现漂移的问题。
 *
 * @param {Buffer} buffer
 * @returns {Array<{path:string, data:Buffer, executable:boolean}>}
 */
function parseTarGz(buffer) {
	const raw = gunzipSync(buffer)
	const files = []
	let offset = 0
	let pendingName = null
	while (offset + 512 <= raw.length) {
		const header = raw.subarray(offset, offset + 512)
		if (header.every((byte) => byte === 0)) break
		const flagByte = header[156]
		const flag = flagByte === 0 ? '0' : String.fromCharCode(flagByte)
		const size = Number.parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim(), 8) || 0
		const nameField = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
		const prefixField = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '')
		const bodyStart = offset + 512
		const body = raw.subarray(bodyStart, bodyStart + size)
		offset = bodyStart + size + ((512 - (size % 512)) % 512)

		if (flag === 'L') {
			pendingName = body.toString('utf8').replace(/\0.*$/, '')
			continue
		}
		if (flag === 'x' || flag === 'g') {
			const text = body.toString('utf8')
			const match = /\d+ path=([\s\S]*?)\n/.exec(text)
			if (match) pendingName = match[1]
			continue
		}
		if (flag === '5') continue
		if (flag !== '0') throw new Error(`包内含不支持的条目类型（typeflag=${JSON.stringify(flag)}）`)
		const declared = pendingName ?? (prefixField ? `${prefixField}/${nameField}` : nameField)
		pendingName = null
		const path = safeEntryPath(declared)
		if (!path) throw new Error(`包内路径不安全：${JSON.stringify(declared)}`)
		const mode = Number.parseInt(header.subarray(100, 108).toString('utf8').replace(/\0.*$/, '').trim(), 8) || 0o644
		files.push({ path, data: Buffer.from(body), executable: (mode & 0o111) !== 0 })
	}
	if (!files.length) throw new Error('包里没有任何文件')
	if (!files.some((f) => f.path === 'SKILL.md')) throw new Error('包根目录缺少 SKILL.md')
	return files
}

/**
 * 清单指纹：与控制面 `filesDigest` 必须逐字节一致，否则校验永远失败。
 *
 * @param {Array<{path:string, data:Buffer, executable?:boolean}>} files
 * @returns {string}
 */
function filesDigest(files) {
	const manifest = files
		.map((f) => `${f.path}\u0000${sha256(f.data)}\u0000${f.executable ? 1 : 0}`)
		.sort()
		.join('\n')
	return sha256(Buffer.from(manifest, 'utf8'))
}

/** 确定性目录名：同一版同一份内容永远落到同一个路径，`list()` 就能提前给出它。 */
function dirOf(name, version, digest) {
	return join(cfg.cache, `${name}@${version}-${String(digest || '').slice(0, 8) || 'nomarker'}`)
}

/** @returns {string|null} 目录里标记文件记录的 digest */
function markerDigest(dir) {
	try {
		const marker = JSON.parse(readFileSync(join(dir, MARKER), 'utf8'))
		return typeof marker.digest === 'string' ? marker.digest : null
	} catch {
		return null
	}
}

/**
 * 把某个多文件包物化到本地目录，返回目录路径。
 *
 * digest 一致就直接用（零网络）——这是「重启后免下载」的全部实现，不需要额外的 bootstrap。
 *
 * @param {{name:string, version:string, digest:string, manifest?:string}} target
 * @param {{signal?: AbortSignal}} [options]
 * @returns {Promise<string|null>} 控制面说「没这个版本」时返回 null
 */
async function materialize(target, options) {
	const { name, version, digest } = target
	const dir = dirOf(name, version, digest)
	if (markerDigest(dir) === digest) return dir
	if (materializing.has(dir)) return materializing.get(dir)

	const task = (async () => {
		const res = await fetch(
			`${cfg.base}/market/skills/${encodeURIComponent(name)}/${encodeURIComponent(version)}/bundle`,
			{ headers: { authorization: `Bearer ${cfg.token}` }, signal: signalFor(options?.signal) },
		)
		if (res.status === 404) return null
		if (!res.ok) throw new Error(`GET /market/skills/${name}/${version}/bundle → HTTP ${res.status}`)
		const expected = String(res.headers.get('x-dsh-manifest') || '')
		const files = parseTarGz(Buffer.from(await res.arrayBuffer()))
		const actual = filesDigest(files)
		// 传输完整性：解出来的清单必须和服务端算的一致。不一致就是坏包，宁可不装。
		if (expected && expected !== actual) throw new Error(`包校验失败：期望 ${expected.slice(0, 12)}…，实得 ${actual.slice(0, 12)}…`)

		const temp = `${dir}.tmp-${process.pid}-${Date.now()}`
		rmSync(temp, { recursive: true, force: true })
		mkdirSync(temp, { recursive: true })
		for (const file of files) {
			const target = join(temp, file.path)
			mkdirSync(dirname(target), { recursive: true })
			writeFileSync(target, file.data, { mode: file.executable ? 0o755 : 0o644 })
		}
		writeFileSync(
			join(temp, MARKER),
			JSON.stringify(
				{
					itemId: `${name}@${version}`,
					digest,
					files: files.map((f) => ({ path: f.path, sha256: sha256(f.data), size: f.data.length })),
				},
				null,
				2,
			),
		)
		// 原子替换：解到一半的目录绝不能被当成「已就绪」，否则下次读到半个包
		rmSync(dir, { recursive: true, force: true })
		renameSync(temp, dir)
		return dir
	})().finally(() => materializing.delete(dir))

	materializing.set(dir, task)
	return task
}

/**
 * 清理旧物化目录，同名只留最近 `keep` 个版本。
 *
 * 不按时间过期而是按数量：这是缓存，判断「还在不在用」要靠库，不靠 mtime。
 *
 * @param {number} keep
 */
function prune(keep = 2) {
	let entries = []
	try {
		entries = readdirSync(cfg.cache, { withFileTypes: true }).filter((e) => e.isDirectory())
	} catch {
		return
	}
	const byName = new Map()
	for (const entry of entries) {
		const owner = entry.name.split('@')[0]
		const list = byName.get(owner) || []
		let at = 0
		try {
			at = statSync(join(cfg.cache, entry.name)).mtimeMs
		} catch {
			continue
		}
		list.push({ name: entry.name, at })
		byName.set(owner, list)
	}
	for (const list of byName.values()) {
		list.sort((a, b) => b.at - a.at)
		for (const stale of list.slice(keep)) rmSync(join(cfg.cache, stale.name), { recursive: true, force: true })
	}
}

/**
 * 把接口返回的一行转成内核认识的候选。
 *
 * `locator` 里定锚了版本号，`get()` 按它取正文——这样「列表看到的版本」和「实际加载的版本」
 * 永远是同一版，不会出现会话中途换版。
 *
 * @param {object} item 接口返回的技能摘要
 * @returns {object} SkillCandidate
 */
function toCandidate(item) {
	const version = String(item.version || '0.0.0')
	const digest = String(item.digest || '')
	const hasBundle = Boolean(item.bundle?.hasBundle) && Boolean(digest)
	return {
		name: String(item.name),
		description: String(item.description || ''),
		...(item.whenToUse ? { whenToUse: String(item.whenToUse) } : {}),
		invocation: { modelInvocable: true, userInvocable: true },
		provider: PROVIDER,
		source: 'market',
		// 多文件包的落点是可以提前算出来的（名字+版本+digest 都定了），
		// 所以列表阶段就给出真实目录，加载时只是「确保它已经在那儿」。
		resourceBase: hasBundle
			? { kind: 'directory', path: dirOf(String(item.name), version, digest) }
			: { kind: 'opaque', description: '正文经控制面 API 下发，技能内不含可执行脚本与相对资源' },
		rank: Number(item.rank) || cfg.rank,
		locator: String(item.locator || `${item.name}@${version}`),
		metadata: { version, digest, team: cfg.team, hasBundle, files: item.bundle?.count ?? 1 },
	}
}

/**
 * 拉一次目录。
 *
 * @param {{signal?: AbortSignal}} [options]
 * @returns {Promise<{rev: string, items: object[], team: string}>}
 */
async function fetchCatalog(options) {
	const res = await fetch(`${cfg.base}/market/skills`, {
		headers: { authorization: `Bearer ${cfg.token}`, accept: 'application/json' },
		signal: signalFor(options?.signal),
	})
	if (!res.ok) throw new Error(`GET /market/skills → HTTP ${res.status}`)
	return await res.json()
}

/**
 * 把 locator 拆回「名字 + 版本」。名字里允许 `.` `_` `-`，但不可能有 `@`（包名规则已限定），
 * 所以从最后一个 `@` 切是安全的。
 *
 * @param {unknown} locator
 * @returns {{name:string, version:string}|null}
 */
function splitLocator(locator) {
	const text = String(locator || '')
	const at = text.lastIndexOf('@')
	if (at <= 0) return null
	return { name: text.slice(0, at), version: text.slice(at + 1) }
}

/**
 * 注册 provider。
 *
 * @param {import('@deepseek-ai/dsh-skill').SkillProviderControl} control
 * @returns {import('@deepseek-ai/dsh-skill').SkillProvider}
 */
function createProvider(control) {
	const provider = {
		name: PROVIDER,

		async list(options) {
			// 没配 token 就安静地什么都不提供：本地开发的容器不一定连得上控制面，
			// 为此让整个技能域报错没有意义。
			if (!cfg.token) return { candidates: [], complete: true }

			if (state.rev !== null && Date.now() - state.at < cfg.ttlMs) {
				return { candidates: state.items, complete: true }
			}
			if (inflight) return inflight

			inflight = (async () => {
				try {
					const data = await fetchCatalog(options)
					const previous = state.rev
					state.rev = String(data.rev || '')
					state.at = Date.now()
					state.items = (data.items || []).map(toCandidate)
					// 版本变了才让内核重扫；否则每次 list 都会触发全量失效，反而制造抖动
					if (previous !== null && previous !== state.rev) {
						setTimeout(() => control.invalidate(), 0)
					}
					return { candidates: state.items, complete: true }
				} catch (error) {
					// 失败不写缓存（complete:false 内核也不会缓存）：接口恢复后下一次请求自动重试。
					// 返回上一份结果而不是空数组，避免控制面抖一下就让模型「失忆」。
					console.error(`[market-skill] 拉技能目录失败：${error.message}`)
					return { candidates: state.items, complete: false }
				} finally {
					inflight = null
				}
			})()
			return inflight
		},

		async get(candidate, options) {
			const parts = splitLocator(candidate.locator)
			if (!parts) return undefined
			const { name: skillName, version } = parts
			const hasBundle = Boolean(candidate.metadata?.hasBundle)
			const digest = String(candidate.metadata?.digest || '')

			if (hasBundle) {
				const dir = await materialize({ name: skillName, version, digest }, options)
				// null = 团队已卸载/停用/版本被换掉，属于正常失效，返回 undefined 让内核去重扫
				if (!dir) return undefined
				const file = join(dir, 'SKILL.md')
				if (!existsSync(file)) return undefined
				return {
					name: candidate.name,
					description: candidate.description,
					...(candidate.whenToUse ? { whenToUse: candidate.whenToUse } : {}),
					invocation: candidate.invocation,
					provider: PROVIDER,
					source: 'market',
					resourceBase: { kind: 'directory', path: dir },
					// 给出绝对路径，模型想读 references/ 下的文件时不必自己拼
					path: file,
					metadata: candidate.metadata,
					content: stripFrontmatter(readFileSync(file, 'utf8')),
				}
			}

			const res = await fetch(
				`${cfg.base}/market/skills/${encodeURIComponent(skillName)}/${encodeURIComponent(version)}`,
				{ headers: { authorization: `Bearer ${cfg.token}` }, signal: signalFor(options?.signal) },
			)
			if (res.status === 404) return undefined
			if (!res.ok) throw new Error(`GET /market/skills/${skillName}/${version} → HTTP ${res.status}`)

			return {
				name: candidate.name,
				description: candidate.description,
				...(candidate.whenToUse ? { whenToUse: candidate.whenToUse } : {}),
				invocation: candidate.invocation,
				provider: PROVIDER,
				source: 'market',
				resourceBase: candidate.resourceBase,
				metadata: candidate.metadata,
				content: await res.text(),
			}
		},
	}

	return provider
}

/**
 * 启动后异步预拉多文件包。
 *
 * 不放在 entrypoint 里同步做完：团队装 20 个技能、共 100 MB，每次冷启动都要等，
 * 而绝大多数会话一个都用不到。串行也是刻意的——SQLite 单写、控制面还要现场打包，
 * 并发只会互相拖慢。
 *
 * @param {import('@deepseek-ai/dsh-skill').SkillProvider} provider
 */
async function prewarm(provider) {
	if (!(cfg.prewarm > 0)) return
	try {
		prune()
		const listed = await provider.list({})
		const pending = listed.candidates.filter((c) => c.metadata?.hasBundle).slice(0, cfg.prewarm)
		for (const candidate of pending) {
			try {
				await provider.get(candidate, {})
			} catch (error) {
				// 失败只记日志不重试：下次真有人用到，get() 会自己再拉一次
				console.error(`[market-skill] 预热 ${candidate.name} 失败：${error.message}`)
			}
		}
	} catch (error) {
		console.error(`[market-skill] 预热中止：${error.message}`)
	}
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
	if (!cfg.token) {
		console.warn('[market-skill] 没有 MARKET_API_TOKEN，本容器不会从控制面加载技能')
		return
	}
	/** @type {import('@deepseek-ai/dsh-skill').SkillProvider[]} */
	const created = []
	ctx.skills.registerProvider((control) => {
		const provider = createProvider(control)
		created.push(provider)
		return provider
	})
	// stderr：`dsh --json` 的事件流占着 stdout，插件不能往那上面写
	console.error(`[market-skill] 已启用：team=${cfg.team} base=${cfg.base} rank=${cfg.rank} cache=${cfg.cache}`)
	// 不阻塞 dsh 启动：预热失败/超时都不影响会话可用，只是第一次用到时慢一点
	setTimeout(() => {
		for (const provider of created) void prewarm(provider)
	}, 0)
}

/** 测试用：不经过 Cordis 直接拿到 provider。 */
export const __testing = { createProvider, toCandidate, parseTarGz, filesDigest, safeEntryPath, stripFrontmatter, dirOf, cfg }
