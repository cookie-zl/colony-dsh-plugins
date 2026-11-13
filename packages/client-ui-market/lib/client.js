/**
 * client-ui-market 的浏览器侧。
 *
 * 形态与 dsh 官方 client 插件一致：一个裸 ESM 文件，通过 window.__ModuleLoader__
 * 注册工厂，工厂里只能用基线模块（react / react/jsx-runtime 等）。
 * 没有构建步骤 —— 手写这份 wrapper，`npm pack` 出来的 tarball 直接可用。
 *
 * 为什么不用 JSX：仓库的插件约定是「纯 JS 无构建」，JSX 需要先过一遍 tsdown。
 * 这里用 jsx 运行时的函数调用形式，语义等价。
 *
 * 数据来自 auth 服务的 /__auth/api/market —— 与门户的「技能」页同一个源、同一套权限。
 * 不直连控制面：控制面 token 不能进浏览器。
 */
window.__ModuleLoader__.load({
	id: '@my-dsh/client-ui-market',
	factory: (require) => {
		var module = { exports: {} }
		var exports = module.exports
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

		const React = require('react')
		const jsxRuntime = require('react/jsx-runtime')
		const jsx = jsxRuntime.jsx
		const jsxs = jsxRuntime.jsxs

		/** 主面板 id：侧栏那一项和 main slot 的 key 必须是同一个值。 */
		const PANEL_ID = 'market'

		/**
		 * 极简 createElement：统一处理 children。
		 * 数组 children 一律走 jsxs（React 的 jsx 单元素入口收到数组会告警）。
		 */
		function h(tag, props, ...kids) {
			const p = { ...(props || {}) }
			if (kids.length === 1) {
				p.children = kids[0]
			} else if (kids.length > 1) {
				p.children = kids
			}
			return Array.isArray(p.children) ? jsxs(tag, p) : jsx(tag, p)
		}

		/**
		 * 颜色一律走继承与半透明，不写死底色：
		 * dsh 有亮/暗两套主题，写死 #fff 在暗色下会变成一块刺眼的白板。
		 */
		const S = {
			page: {
				minHeight: '100%',
				padding: '28px 32px 72px',
				boxSizing: 'border-box',
				font: 'inherit',
				color: 'inherit',
			},
			wrap: { maxWidth: 1040, margin: '0 auto' },
			head: { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 },
			h1: { fontSize: 18, fontWeight: 500, margin: 0 },
			sub: { fontSize: 13, opacity: 0.55 },
			spacer: { flex: 1 },
			tabs: { display: 'flex', gap: 6, margin: '20px 0 12px' },
			tab: (on) => ({
				padding: '5px 12px',
				fontSize: 13,
				borderRadius: 999,
				cursor: 'pointer',
				border: `1px solid ${on ? 'transparent' : 'rgba(127,127,127,.28)'}`,
				background: on ? 'rgba(127,127,127,.16)' : 'transparent',
				color: 'inherit',
				fontWeight: on ? 500 : 400,
			}),
			section: { marginTop: 22 },
			h2: {
				fontSize: 12,
				fontWeight: 500,
				letterSpacing: '.04em',
				textTransform: 'uppercase',
				opacity: 0.5,
				margin: '0 0 10px',
			},
			grid: {
				display: 'grid',
				gridTemplateColumns: 'repeat(auto-fill, minmax(248px, 1fr))',
				gap: 10,
			},
			card: {
				border: '1px solid rgba(127,127,127,.24)',
				borderRadius: 12,
				padding: '14px 15px',
				display: 'flex',
				flexDirection: 'column',
				gap: 6,
				minHeight: 118,
			},
			cardHead: { display: 'flex', alignItems: 'center', gap: 8 },
			cardTitle: { fontSize: 14, fontWeight: 500 },
			cardName: { fontSize: 11.5, opacity: 0.45, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
			cardDesc: { fontSize: 12.5, lineHeight: 1.55, opacity: 0.72, flex: 1 },
			cardFoot: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 },
			tag: {
				fontSize: 11,
				padding: '1px 7px',
				borderRadius: 999,
				background: 'rgba(127,127,127,.14)',
				opacity: 0.8,
			},
			btn: (primary, danger) => ({
				font: 'inherit',
				fontSize: 12.5,
				padding: '4px 11px',
				borderRadius: 8,
				cursor: 'pointer',
				border: primary ? '1px solid transparent' : '1px solid rgba(127,127,127,.3)',
				background: primary ? 'rgba(60,120,255,.92)' : 'transparent',
				color: primary ? '#fff' : danger ? '#c0392b' : 'inherit',
				opacity: 1,
			}),
			row: {
				display: 'flex',
				alignItems: 'center',
				gap: 10,
				padding: '9px 12px',
				borderRadius: 10,
				border: '1px solid rgba(127,127,127,.16)',
				marginBottom: 6,
			},
			mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5 },
			banner: (bad) => ({
				marginTop: 14,
				padding: '9px 12px',
				borderRadius: 10,
				fontSize: 13,
				lineHeight: 1.55,
				border: `1px solid ${bad ? 'rgba(192,57,43,.4)' : 'rgba(127,127,127,.25)'}`,
				background: bad ? 'rgba(192,57,43,.08)' : 'rgba(127,127,127,.07)',
			}),
			empty: {
				fontSize: 13,
				opacity: 0.55,
				padding: '18px 4px',
			},
		}

		/** 侧栏图标：一个简化的「货架」轮廓，与 dsh 自带的线性图标同尺寸。 */
		function MarketIcon({ size = 18 }) {
			return h(
				'svg',
				{
					width: size,
					height: size,
					viewBox: '0 0 16 16',
					fill: 'none',
					stroke: 'currentColor',
					strokeWidth: 1.2,
					strokeLinecap: 'round',
					strokeLinejoin: 'round',
					'aria-hidden': 'true',
				},
				h('path', { d: 'M2.5 6.2 3.6 3h8.8l1.1 3.2' }),
				h('path', { d: 'M2.5 6.2a1.5 1.5 0 0 0 2.9.5 1.5 1.5 0 0 0 2.9 0 1.5 1.5 0 0 0 2.9 0 1.5 1.5 0 0 0 2.9-.5' }),
				h('path', { d: 'M3.4 7.9v5.1h9.2V7.9' }),
			)
		}

		/** 读市场快照。认证靠浏览器已有的 dsh-sso Cookie，同源请求会自动带上。 */
		async function loadMarket() {
			const res = await fetch('/__auth/api/market', {
				credentials: 'same-origin',
				headers: { Accept: 'application/json' },
			})
			const data = await res.json().catch(() => ({}))
			if (!res.ok) throw new Error(data.error || `读取失败（HTTP ${res.status}）`)
			return data
		}

		/** 执行一个动作（安装/卸载/启停），成功后返回最新快照。 */
		async function runAction(payload) {
			const res = await fetch('/__auth/api/market/action', {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
				body: JSON.stringify(payload),
			})
			const data = await res.json().catch(() => ({}))
			if (!res.ok) {
				const error = new Error(data.error || `操作失败（HTTP ${res.status}）`)
				error.code = data.code
				error.detail = data.detail
				throw error
			}
			return data
		}

		/** 已装项的一行：名字 + 版本 + 来源 + 启停/卸载。 */
		function InstalledRow({ item, kind, manage, busy, onToggle, onUninstall }) {
			const shared = item.from.startsWith('share:')
			return h(
				'div',
				{ style: S.row },
				h(
					'div',
					{ style: { flex: 1, minWidth: 0 } },
					h(
						'div',
						{ style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
						h('span', { style: S.mono }, item.name),
						h('span', { style: { ...S.tag, opacity: 0.65 } }, `v${item.version || '—'}`),
						item.enabled ? null : h('span', { style: { ...S.tag, opacity: 0.9 } }, '已停用'),
						shared ? h('span', { style: S.tag }, `来自 ${item.from.slice(6)} 分享`) : null,
					),
					item.title ? h('div', { style: { fontSize: 12.5, opacity: 0.6, marginTop: 2 } }, item.title) : null,
				),
				manage && kind === 'skill'
					? h(
							'button',
							{
								type: 'button',
								style: S.btn(false, false),
								disabled: busy,
								onClick: () => onToggle(item, !item.enabled),
							},
							item.enabled ? '停用' : '启用',
						)
					: null,
				manage
					? h(
							'button',
							{
								type: 'button',
								style: S.btn(false, true),
								disabled: busy,
								onClick: () => onUninstall(item, kind),
							},
							'卸载',
						)
					: null,
			)
		}

		/** 市场里的一张卡片：标题 + 名字 + 描述 + 安装按钮。 */
		function MarketCard({ item, kind, manage, installed, busy, onInstall }) {
			return h(
				'div',
				{ style: S.card },
				h(
					'div',
					{ style: S.cardHead },
					h('span', { style: S.cardTitle }, item.title || item.name),
					h('div', { style: S.spacer }),
					h('span', { style: S.tag }, `v${item.version}`),
				),
				h('div', { style: S.cardName }, `${kind === 'mcp' ? 'mcp' : 'skill'} · ${item.name}`),
				h('div', { style: S.cardDesc }, item.desc || '没有描述'),
				h(
					'div',
					{ style: S.cardFoot },
					h(
						'span',
						{ style: S.tag },
						item.visibility === 'private' ? '私有' : '公开',
					),
					item.owner ? h('span', { style: { fontSize: 11.5, opacity: 0.45 } }, `来自 ${item.owner}`) : null,
					h('div', { style: S.spacer }),
					installed
						? h('span', { style: { fontSize: 12, opacity: 0.5 } }, '已安装')
						: manage
							? h(
									'button',
									{
										type: 'button',
										style: S.btn(true, false),
										disabled: busy,
										onClick: () => onInstall(item, kind),
									},
									'安装',
								)
							: null,
				),
			)
		}

		/** 主面板。 */
		function MarketPage() {
			const [state, setState] = React.useState({
				loading: true,
				data: null,
				error: '',
				tab: 'skill',
				busy: '',
				shadow: null,
			})

			const refresh = React.useCallback(async () => {
				setState((s) => ({ ...s, loading: true, error: '', shadow: null }))
				try {
					const data = await loadMarket()
					setState((s) => ({ ...s, loading: false, data, error: '' }))
				} catch (err) {
					setState((s) => ({ ...s, loading: false, error: err.message }))
				}
			}, [])

			// 只在首次挂载时拉一次：面板切走再回来不该重新请求
			React.useEffect(() => {
				refresh()
			}, [refresh])

			const act = async (payload, label) => {
				setState((s) => ({ ...s, busy: label, error: '', shadow: null }))
				try {
					const data = await runAction(payload)
					setState((s) => ({ ...s, busy: '', data, error: '' }))
				} catch (err) {
					// 被本地同名技能遮蔽：控制面给 409 SHADOWED，这里改成一句能落地的话 + 强制安装入口
					if (err.code === 'SHADOWED') {
						setState((s) => ({
							...s,
							busy: '',
							shadow: { ...payload, path: err.detail?.shadow?.path || '', source: err.detail?.shadow?.source || '' },
							error: err.message,
						}))
						return
					}
					setState((s) => ({ ...s, busy: '', error: err.message }))
				}
			}

			const onInstall = (item, kind) => act({ action: 'install', kind, name: item.name }, `install:${item.name}`)
			const onUninstall = (item, kind) => {
				if (!window.confirm(`卸载 ${item.name}？团队里的会话会立刻看不到它。`)) return
				act({ action: 'uninstall', kind, name: item.name }, `uninstall:${item.name}`)
			}
			const onToggle = (item, enabled) => act({ action: 'toggle', kind: 'skill', name: item.name, enabled }, `toggle:${item.name}`)

			const data = state.data
			const tab = state.tab
			const kindKey = tab === 'mcp' ? 'mcp' : 'skills'
			const bucket = data ? data[kindKey] || { installed: [], market: [] } : { installed: [], market: [] }
			const installedNames = new Set(bucket.installed.map((i) => i.name))

			const tabs = h(
				'div',
				{ style: S.tabs },
				h(
					'button',
					{ type: 'button', style: S.tab(tab === 'skill'), onClick: () => setState((s) => ({ ...s, tab: 'skill' })) },
					data ? `技能 ${data.skills.market.length}` : '技能',
				),
				h(
					'button',
					{ type: 'button', style: S.tab(tab === 'mcp'), onClick: () => setState((s) => ({ ...s, tab: 'mcp' })) },
					data ? `连接器 ${data.mcp.market.length}` : '连接器',
				),
			)

			const header = h(
				'div',
				{ style: { ...S.head, marginTop: 2 } },
				h('h1', { style: S.h1 }, '市场'),
				h('span', { style: S.sub }, data ? `${data.teamName} · 已装 ${data.skills.installed.length + data.mcp.installed.length} 项` : '技能与连接器'),
				h('div', { style: S.spacer }),
				h(
					'button',
					{ type: 'button', style: S.btn(false, false), disabled: state.loading, onClick: refresh },
					state.loading ? '读取中…' : '刷新',
				),
			)

			const banners = []
			if (state.error) {
				banners.push(
					h(
						'div',
						{ key: 'err', style: S.banner(true), role: 'alert' },
						h('div', null, state.error),
						state.shadow
							? h(
									'div',
									{ style: { marginTop: 8 } },
									h(
										'button',
										{
											type: 'button',
											style: S.btn(false, false),
											disabled: Boolean(state.busy),
											onClick: () => act({ ...state.shadow, force: true }, `install:${state.shadow.name}`),
										},
										'仍然安装（市场版优先生效）',
									),
									state.shadow.path
										? h('div', { style: { marginTop: 6, fontSize: 12, opacity: 0.65 } }, `冲突文件：${state.shadow.path}`)
										: null,
								)
							: null,
					),
				)
			}
			if (data && !data.manage) {
				banners.push(
					h('div', { key: 'ro', style: S.banner(false) }, '你不是这个团队的 owner，只能查看，不能安装或卸载。'),
				)
			}
			if (data && data.stale) {
				banners.push(h('div', { key: 'stale', style: S.banner(false) }, '实例可能在休眠：下面是台账里的记录，没做卷内校验。'))
			}

			const installedList = bucket.installed.length
				? bucket.installed.map((item) =>
						h(InstalledRow, {
							key: `in-${item.name}`,
							item,
							kind: tab,
							manage: data.manage,
							busy: state.busy === `toggle:${item.name}` || state.busy === `uninstall:${item.name}`,
							onToggle,
							onUninstall,
						}),
					)
				: h('div', { style: S.empty }, `还没有装任何${tab === 'mcp' ? '连接器' : '技能'}。新团队从这里开始是空的。`)

			const marketList = bucket.market.length
				? bucket.market.map((item) =>
						h(MarketCard, {
							key: `mk-${item.name}`,
							item,
							kind: tab,
							manage: data.manage,
							installed: installedNames.has(item.name),
							busy: state.busy === `install:${item.name}`,
							onInstall,
						}),
					)
				: h('div', { style: S.empty }, '市场里还没有可装的包。可以从门户的「技能」页把本团队的包发布上来。')

			return h(
				'div',
				{ style: S.page },
				h(
					'div',
					{ style: S.wrap },
					header,
					banners,
					tabs,
					state.loading && !data ? h('div', { style: S.empty }, '读取中…') : null,
					data
						? h(
								React.Fragment,
								null,
								h(
									'div',
									{ style: S.section },
									h('h2', { style: S.h2 }, '本团队已装'),
									h('div', { style: { display: 'flex', flexDirection: 'column' } }, installedList),
								),
								h(
									'div',
									{ style: S.section },
									h('h2', { style: S.h2 }, '市场'),
									h('div', { style: S.grid }, marketList),
								),
							)
						: null,
				),
			)
		}

		/** 需要的客户端服务：插槽注册表（面板与侧栏项都靠它）。 */
		const inject = ['slots', 'layout']

		/**
		 * 注册侧栏项与主面板。
		 * @param ctx - 客户端根上下文
		 */
		function apply(ctx) {
			ctx.slots.inject('main', () =>
				ctx.slots.register({ name: 'main', key: PANEL_ID }, MarketPage),
			)
			ctx.slots.inject('sidebar.panellist', () =>
				ctx.slots.register(
					{
						name: 'sidebar.panellist',
						id: PANEL_ID,
						order: 5,
						label: () => '市场',
					},
					MarketIcon,
				),
			)
		}

		exports.apply = apply
		exports.inject = inject
		return module.exports
	},
})
