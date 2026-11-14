/**
 * client-ui-assistants 的浏览器侧。
 *
 * 形态与 client-ui-market 一致：裸 ESM 文件，通过 window.__ModuleLoader__ 注册工厂，
 * 只能 require 基线模块（react / react/jsx-runtime），没有构建步骤，也不用 JSX。
 *
 * 数据全部来自 auth 服务的 /__auth/api/assistants —— 与门户的「助理」页同一个源、同一套权限。
 * 不直连控制面：控制面 token 不能进浏览器，而且平台凭据只在服务端解密。
 */
window.__ModuleLoader__.load({
	id: '@colony-agents/dsh-client-ui-assistants',
	factory: (require) => {
		var module = { exports: {} }
		var exports = module.exports
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

		const React = require('react')
		const jsxRuntime = require('react/jsx-runtime')
		const jsx = jsxRuntime.jsx
		const jsxs = jsxRuntime.jsxs

		/** 主面板 id：侧栏那一项和 main slot 的 key 必须是同一个值。 */
		const PANEL_ID = 'assistants'

		/**
		 * 极简 createElement：统一处理 children。
		 *
		 * 数组 children 一律走 jsxs（React 的 jsx 单元素入口收到数组会告警）。
		 * 多个并列子元素会自动补 key：手写 h() 时很容易漏，而漏一个就是一条控制台告警。
		 */
		function h(tag, props, ...kids) {
			const p = { ...(props || {}) }
			if (kids.length === 1) {
				p.children = kids[0]
			} else if (kids.length > 1) {
				p.children = kids.map((k, i) =>
					React.isValidElement(k) && k.key == null ? React.cloneElement(k, { key: `k${i}` }) : k,
				)
			}
			return Array.isArray(p.children) ? jsxs(tag, p) : jsx(tag, p)
		}

		/**
		 * 颜色一律走继承与半透明，不写死底色：
		 * dsh 有亮/暗两套主题，写死 #fff 在暗色下会变成一块刺眼的白板。
		 */
		const S = {
			/**
			 * 主面板容器。
			 *
			 * dsh 的 centerCol 是 `display:flex; flex-direction:column; overflow:hidden`，
			 * 子项如果只给 `minHeight:100%`，内容超长时会被父级直接裁掉（没有滚动条），
			 * 表现就是「拉到底部就再也滚不动」。所以这里自己当滚动容器：
			 * 高度吃满父级 + `overflowY:auto`，内容再长也能滚。
			 */
			page: {
				height: '100%',
				overflowY: 'auto',
				overflowX: 'hidden',
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
			h2: {
				fontSize: 12,
				fontWeight: 500,
				letterSpacing: '.04em',
				textTransform: 'uppercase',
				opacity: 0.5,
				margin: '0 0 10px',
			},
			/** 助理列表：分行展示，一行一个助理（设置页的常见形态，比卡片更好扫读）。 */
			list: { display: 'flex', flexDirection: 'column', gap: 8 },
			row: {
				display: 'flex',
				alignItems: 'flex-start',
				gap: 12,
				border: '1px solid rgba(127,127,127,.24)',
				borderRadius: 12,
				padding: '12px 14px',
			},
			rowMain: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 },
			rowTitle: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
			rowMeta: { fontSize: 12, opacity: 0.6, lineHeight: 1.6, wordBreak: 'break-all' },
			rowActions: {
				display: 'flex',
				alignItems: 'center',
				gap: 6,
				flexWrap: 'wrap',
				justifyContent: 'flex-end',
				flex: '0 0 auto',
				maxWidth: '46%',
			},
			tag: {
				fontSize: 11,
				padding: '1px 7px',
				borderRadius: 999,
				background: 'rgba(127,127,127,.14)',
				opacity: 0.8,
				whiteSpace: 'nowrap',
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
			}),
			panel: {
				marginTop: 16,
				padding: '16px 17px',
				borderRadius: 12,
				border: '1px solid rgba(127,127,127,.28)',
				background: 'rgba(127,127,127,.05)',
			},
			field: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 },
			fieldLabel: { fontSize: 11.5, opacity: 0.62 },
			input: {
				font: 'inherit',
				fontSize: 13,
				padding: '6px 9px',
				borderRadius: 8,
				border: '1px solid rgba(127,127,127,.3)',
				background: 'transparent',
				color: 'inherit',
				width: '100%',
				boxSizing: 'border-box',
			},
			hint: { fontSize: 11.5, opacity: 0.5, lineHeight: 1.55 },
			mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5 },
			codeBox: {
				display: 'flex',
				alignItems: 'center',
				gap: 8,
				padding: '7px 10px',
				borderRadius: 8,
				border: '1px solid rgba(127,127,127,.22)',
				background: 'rgba(127,127,127,.06)',
			},
			banner: (kind) => ({
				marginTop: 14,
				padding: '9px 12px',
				borderRadius: 10,
				fontSize: 13,
				lineHeight: 1.6,
				border: `1px solid ${
					kind === 'bad' ? 'rgba(192,57,43,.4)' : kind === 'warn' ? 'rgba(200,140,20,.45)' : 'rgba(127,127,127,.25)'
				}`,
				background:
					kind === 'bad'
						? 'rgba(192,57,43,.08)'
						: kind === 'warn'
							? 'rgba(200,140,20,.09)'
							: 'rgba(127,127,127,.07)',
			}),
			empty: { fontSize: 13, opacity: 0.55, padding: '18px 4px' },
			dot: (ok) => ({
				display: 'inline-block',
				width: 6,
				height: 6,
				borderRadius: 999,
				marginRight: 5,
				background: ok ? 'rgba(60,160,90,.95)' : 'rgba(192,57,43,.9)',
			}),
			table: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
			th: { textAlign: 'left', fontWeight: 500, opacity: 0.55, padding: '6px 8px', borderBottom: '1px solid rgba(127,127,127,.2)' },
			td: { padding: '6px 8px', borderBottom: '1px solid rgba(127,127,127,.12)', verticalAlign: 'top' },
			/** 一个平台分组：标题行 + 该平台下的助理。 */
			group: { marginTop: 24 },
			groupHead: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 },
			groupTitle: { fontSize: 14, fontWeight: 500 },
			groupEmpty: {
				fontSize: 12.5,
				opacity: 0.5,
				padding: '14px 15px',
				border: '1px dashed rgba(127,127,127,.28)',
				borderRadius: 12,
			},
			/** 文字按钮：接入说明这类次要动作，不要抢主按钮的视觉重量。 */
			linkBtn: {
				font: 'inherit',
				fontSize: 12.5,
				padding: '2px 4px',
				border: 'none',
				background: 'transparent',
				color: 'inherit',
				opacity: 0.55,
				cursor: 'pointer',
			},
			/** 接入说明：默认收起，需要时才展开——首屏只留「有什么助理」。 */
			detailsBody: {
				marginTop: 8,
				padding: '10px 12px',
				borderRadius: 10,
				border: '1px solid rgba(127,127,127,.2)',
				background: 'rgba(127,127,127,.05)',
				lineHeight: 1.65,
			},

			platformIcon: (id) => ({
				width: 32,
				height: 32,
				borderRadius: 9,
				display: 'grid',
				placeItems: 'center',
				fontSize: 13,
				fontWeight: 600,
				flex: '0 0 auto',
				background: id === 'dingtalk' ? 'rgba(26,115,232,.16)' : 'rgba(51,112,255,.16)',
				color: id === 'dingtalk' ? '#3b8ef0' : '#5b8bff',
			}),
			/**
			 * 表单底部的操作栏：sticky 到底。
			 * 凭据字段很长，保存/取消如果只在表单末尾，用户填到一半想退出就得先滚到底。
			 */
			stickyBar: {
				position: 'sticky',
				bottom: 0,
				display: 'flex',
				alignItems: 'center',
				gap: 8,
				marginTop: 14,
				padding: '10px 0 2px',
				borderTop: '1px solid rgba(127,127,127,.24)',
				background: 'rgba(127,127,127,.08)',
				backdropFilter: 'blur(6px)',
			},
			/** 一轮对话：用户问题 → 思考 → 回复，按聊天记录的形态排。 */
			turn: {
				display: 'flex',
				flexDirection: 'column',
				gap: 8,
				padding: '14px 0',
				borderBottom: '1px solid rgba(127,127,127,.14)',
			},
			turnMeta: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, opacity: 0.55 },
			bubble: (kind) => ({
				maxWidth: kind === 'user' ? '80%' : '90%',
				alignSelf: kind === 'user' ? 'flex-end' : 'flex-start',
				padding: '8px 11px',
				borderRadius: 10,
				fontSize: 13,
				lineHeight: 1.7,
				whiteSpace: 'pre-wrap',
				wordBreak: 'break-word',
				border: `1px solid ${
					kind === 'user'
						? 'rgba(60,120,255,.22)'
						: kind === 'error'
							? 'rgba(192,57,43,.35)'
							: 'rgba(127,127,127,.22)'
				}`,
				background:
					kind === 'user'
						? 'rgba(60,120,255,.10)'
						: kind === 'error'
							? 'rgba(192,57,43,.07)'
							: 'rgba(127,127,127,.07)',
				color: kind === 'error' ? 'rgba(200,70,55,.95)' : 'inherit',
			}),
			thinkingBox: {
				alignSelf: 'flex-start',
				maxWidth: '90%',
				border: '1px dashed rgba(127,127,127,.32)',
				borderRadius: 8,
				padding: '6px 10px',
				fontSize: 12,
				background: 'rgba(127,127,127,.04)',
			},
			thinkingSummary: { cursor: 'pointer', opacity: 0.65, fontSize: 11.5, userSelect: 'none' },
			thinkingBody: { marginTop: 7, whiteSpace: 'pre-wrap', lineHeight: 1.75, opacity: 0.78 },
		}

		/** 侧栏图标：一条对话气泡 + 小天线，与 dsh 自带线性图标同尺寸。 */
		function AssistantsIcon({ size = 18 }) {
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
				h('path', { d: 'M2.2 4.2h11.6v7.1H7.4L4.3 13.6v-2.3H2.2z' }),
				h('path', { d: 'M6.1 4.2V2.6' }),
				h('circle', { cx: '6.1', cy: '2.2', r: '0.5' }),
				h('path', { d: 'M5.4 7.7h5.2' }),
			)
		}

		/** 读面板首屏数据。认证靠浏览器已有的 dsh-sso Cookie，同源请求会自动带上。 */
		async function loadAssistants() {
			const res = await fetch('/__auth/api/assistants', {
				credentials: 'same-origin',
				headers: { Accept: 'application/json' },
			})
			const data = await res.json().catch(() => ({}))
			if (!res.ok) throw new Error(data.error || `读取失败（HTTP ${res.status}）`)
			return data
		}

		/** 执行一个写动作，成功后返回最新快照。 */
		async function runAction(payload) {
			const res = await fetch('/__auth/api/assistants/action', {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
				body: JSON.stringify(payload),
			})
			const data = await res.json().catch(() => ({}))
			if (!res.ok) throw new Error(data.error || `操作失败（HTTP ${res.status}）`)
			return data
		}

		/** 拉某个助理的沟通记录。 */
		async function loadMessages(id) {
			const res = await fetch(`/__auth/api/assistants/messages?id=${encodeURIComponent(id)}`, {
				credentials: 'same-origin',
				headers: { Accept: 'application/json' },
			})
			const data = await res.json().catch(() => ({}))
			if (!res.ok) throw new Error(data.error || `读取失败（HTTP ${res.status}）`)
			return data.messages || []
		}

		/** 复制到剪贴板。非 https 下 clipboard API 可能不可用，退回选中文本让人手抄。 */
		async function copyText(text, el) {
			try {
				await navigator.clipboard.writeText(text)
				return true
			} catch {
				try {
					const range = document.createRange()
					range.selectNodeContents(el)
					const sel = window.getSelection()
					sel.removeAllRanges()
					sel.addRange(range)
				} catch {
					/* 选区失败就算了，用户能自己拖 */
				}
				return false
			}
		}

		/** 一个带标签的输入项。 */
		function Field({ label, hint, children }) {
			return h('div', { style: S.field }, h('div', { style: S.fieldLabel }, label), children, hint ? h('div', { style: S.hint }, hint) : null)
		}

		/** 只读地址 + 复制按钮。 */
		function CopyRow({ label, value }) {
			const ref = React.useRef(null)
			const [done, setDone] = React.useState('')
			return h(
				'div',
				{ style: { marginBottom: 8 } },
				h('div', { style: S.fieldLabel }, label),
				h(
					'div',
					{ style: S.codeBox },
					h('span', { ref, style: { ...S.mono, flex: 1, wordBreak: 'break-all' } }, value),
					h(
						'button',
						{
							type: 'button',
							style: S.btn(false, false),
							onClick: async () => {
								const ok = await copyText(value, ref.current)
								setDone(ok ? '已复制' : '已选中')
								setTimeout(() => setDone(''), 1600)
							},
						},
						done || '复制',
					),
				),
			)
		}

		/** 凭据状态小标：绿点=已配，红点=没配。 */
		function CredDot({ ok, label }) {
			return h('span', { style: { fontSize: 11.5, opacity: 0.72, whiteSpace: 'nowrap' } }, h('span', { style: S.dot(ok) }), label)
		}

		/** 平台标：用一个字，避免把第三方 logo 塞进产品界面。 */
		function PlatformIcon({ id }) {
			return h('div', { style: S.platformIcon(id), 'aria-hidden': 'true' }, id === 'dingtalk' ? '钉' : '飞')
		}

		/**
		 * 一个平台分组：标题行（图标 + 名称 + 数量 + 接入说明 + 接入按钮）+ 该平台下的助理卡片。
		 *
		 * 为什么不做「支持哪些平台」的大卡片：只有两个平台时，那等于两块占满首屏的说明文字。
		 * 用户每天来这个面板是为了看/改已有助理，不是读接入文档。所以「有什么」直接摊开，
		 * 「怎么接」收进 details——需要时点开，不需要时不占地方。
		 *
		 * @param {object} props 平台元信息、该平台下的助理、权限与操作回调
		 * @returns {object} 分组节点
		 */
		function PlatformGroup({ meta, items, manage, inbound, busy, onAdd, onEdit, onMessages, onToggle, onTest, onDelete }) {
			const [open, setOpen] = React.useState(false)
			const count = items.length
			const isDing = meta.id === 'dingtalk'
			const need = isDing
				? '企业自建应用，填 Client ID + Client Secret，机器人「消息接收模式」选 Stream。'
				: '企业自建应用，填 App ID + Verification Token，事件订阅填下面的地址。'
			return h(
				'section',
				{ style: S.group },
				h(
					'div',
					{ style: S.groupHead },
					h(PlatformIcon, { id: meta.id }),
					h(
						'div',
						{ style: { display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 } },
						h('span', { style: S.groupTitle }, meta.label),
						h('span', { style: S.sub }, count ? `${count} 个` : '未接入'),
					),
					h('div', { style: S.spacer }),
					h(
						'button',
						{
							type: 'button',
							style: S.linkBtn,
							onClick: () => setOpen(!open),
							'aria-expanded': open,
						},
						open ? '接入说明 ▾' : '接入说明 ▸',
					),
					manage ? h('button', { type: 'button', style: S.btn(true, false), onClick: () => onAdd(meta.id) }, `接入${meta.label}`) : null,
				),
				open
					? h(
							'div',
							{ style: { ...S.detailsBody, marginBottom: 10 } },
							h('div', null, need),
							isDing
								? h('div', { style: { marginTop: 4, ...S.hint } }, '走 Stream 不需要回调地址：服务端主动连钉钉网关，本机也能收。')
								: h(
										'div',
										{ style: { marginTop: 8 } },
										h(CopyRow, { label: '事件订阅地址', value: inbound?.feishu || inbound?.base || '' }),
										inbound?.local
											? h(
													'div',
													{ style: { marginTop: 6, ...S.hint } },
													'这个是本机地址，飞书要公网可达：本地联调需内网穿透（ngrok / cpolar），或用 ASSISTANT_INBOUND_BASE 配成对外域名。',
												)
											: null,
									),
						)
					: null,
				count
					? h(
							'div',
							{ style: S.list },
							items.map((a) =>
								h(AssistantCard, { key: a.id, a, meta, manage, busy, onEdit, onMessages, onToggle, onTest, onDelete }),
							),
						)
					: h(
							'div',
							{ style: S.groupEmpty },
							manage ? `还没有${meta.label}助理。点上方右侧「接入${meta.label}」建一个。` : `还没有${meta.label}助理。`,
						),
			)
		}

		/** 消息状态 → 颜色。running 是排队/执行中，done 是成功，其余算异常。 */
		function statusStyle(status) {
			if (status === 'done') return { color: 'rgba(60,160,90,.95)' }
			if (status === 'running' || status === 'pending') return { color: 'rgba(60,120,255,.95)' }
			if (status === 'timeout') return { color: 'rgba(200,140,20,.95)' }
			return { color: 'rgba(192,57,43,.95)' }
		}

		/** 一行助理：左边信息（名称 / 机器人 / 群 / 会话 / 凭据），右边操作。 */
		function AssistantCard({ a, meta, manage, busy, onEdit, onMessages, onToggle, onTest, onDelete }) {
			const platformLabel = meta ? meta.label : a.platform
			// 必填项没配 = 回调一定被拒，用红点；可选项用灰点提示缺省行为
			const required = (meta?.credentials || []).filter((c) => c.required)
			const optional = (meta?.credentials || []).filter((c) => !c.required)
			const missing = required.filter((c) => !a.credentials?.[c.field])
			return h(
				'div',
				{ style: S.row },
				h(
					'div',
					{ style: S.rowMain },
					h(
						'div',
						{ style: S.rowTitle },
						h('span', { style: S.cardTitle }, a.name),
						h('span', { style: S.tag }, platformLabel),
						h('span', { style: { ...S.tag, opacity: a.enabled ? 0.9 : 0.5 } }, a.enabled ? '已启用' : '已停用'),
					),
					h(
						'div',
						{ style: S.rowMeta },
						h('span', { style: S.mono }, a.robot_key),
						' · 群 ',
						a.conversation_id || '不限',
						' · 会话 ',
						a.session_id || '首条消息后创建',
					),
					h(
						'div',
						{ style: { display: 'flex', gap: 12, flexWrap: 'wrap' } },
						required.map((c) => h(CredDot, { key: c.field, ok: Boolean(a.credentials?.[c.field]), label: c.label })),
						optional.map((c) => h(CredDot, { key: c.field, ok: Boolean(a.credentials?.[c.field]), label: c.label })),
					),
					a.credentials?.outboundWebhook
						? null
						: h('div', { style: S.hint }, '没配出站 Webhook：回复走回调里带的临时地址，长任务可能因过期发不出去。'),
					missing.length
						? h('div', { style: { ...S.hint, color: 'rgba(192,57,43,.9)', opacity: 1 } }, `缺 ${missing.map((c) => c.label).join('、')}，现在的回调会被拒（401）。`)
						: null,
				),
				h(
					'div',
					{ style: S.rowActions },
					manage
						? h('button', { type: 'button', style: S.btn(false, false), onClick: () => onEdit(a) }, '编辑')
						: null,
					h('button', { type: 'button', style: S.btn(false, false), onClick: () => onMessages(a) }, '沟通记录'),
					manage
						? h(
								'button',
								{
									type: 'button',
									style: S.btn(false, false),
									disabled: Boolean(busy),
									onClick: () => onTest(a),
								},
								busy === `test:${a.id}` ? '跑 dsh 中…' : '测试发送',
							)
						: null,
					manage
						? h(
								'button',
								{
									type: 'button',
									style: S.btn(false, false),
									disabled: Boolean(busy),
									onClick: () => onToggle(a, !a.enabled),
								},
								a.enabled ? '停用' : '启用',
							)
						: null,
					manage
						? h('button', { type: 'button', style: S.btn(false, true), onClick: () => onDelete(a) }, '删除')
						: null,
				),
			)
		}

		/** 新建 / 编辑表单。创建后 platform 与 robotKey 是唯一键，不让改。 */
		function Editor({ draft, platforms, inbound, busy, onChange, onSave, onCancel }) {
			const meta = platforms.find((p) => p.id === draft.platform)
			const editing = Boolean(draft.id)
			const set = (patch) => onChange({ ...draft, ...patch })
			const setCred = (field, value) =>
				onChange({ ...draft, credentials: { ...draft.credentials, [field]: value } })
			const switchPlatform = (id) => onChange({ ...draft, platform: id, robotKey: '', credentials: {} })
			const saveLabel = editing ? '保存' : '创建'
			/** 保存按钮在标题栏和底部各放一个：表单很长，别让人滚来滚去找提交。 */
			const saveButton = () =>
				h(
					'button',
					{ type: 'button', style: S.btn(true, false), disabled: Boolean(busy), onClick: onSave },
					busy === 'save' ? '保存中…' : saveLabel,
				)
			const cancelButton = () =>
				h(
					'button',
					{ type: 'button', style: S.btn(false, false), disabled: Boolean(busy), onClick: onCancel },
					editing ? '退出编辑' : '取消',
				)

			return h(
				'div',
				{ style: S.panel },
				h(
					'div',
					{ style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 } },
					h('div', { style: { fontSize: 14, fontWeight: 500 } }, editing ? `编辑「${draft.name}」` : '新增助理'),
					h('div', { style: S.spacer }),
					saveButton(),
					cancelButton(),
				),
				h(
					'div',
					{ style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0 16px' } },
					h(
						Field,
						{ label: '名称' },
						h('input', {
							style: S.input,
							value: draft.name,
							placeholder: '日报助理',
							onChange: (e) => set({ name: e.target.value }),
						}),
					),
					h(
						Field,
						{ label: '平台', hint: editing ? '平台是唯一键的一部分，创建后不可改。' : '点一下切换，凭据字段会跟着变。' },
						editing
							? h('div', { style: { ...S.input, opacity: 0.6 } }, meta ? meta.label : draft.platform)
							: h(
									'div',
									{ style: { display: 'flex', gap: 6 } },
									platforms.map((p) =>
										h(
											'button',
											{
												key: p.id,
												type: 'button',
												style: {
													...S.btn(draft.platform === p.id, false),
													flex: 1,
													display: 'flex',
													alignItems: 'center',
													justifyContent: 'center',
													gap: 6,
													padding: '7px 10px',
												},
												onClick: () => switchPlatform(p.id),
											},
											h(
												'span',
												{
													style: {
														...S.platformIcon(p.id),
														width: 16,
														height: 16,
														borderRadius: 5,
														fontSize: 9.5,
													},
												},
												p.id === 'dingtalk' ? '钉' : '飞',
											),
											p.label,
										),
									),
								),
					),
					h(
						Field,
						{
							label: meta ? meta.robotKey.label : '机器人标识',
							hint: editing ? '机器人标识是唯一键，创建后不可改。要换机器人请新建一个助理。' : meta?.robotKey.hint,
						},
						h('input', {
							style: { ...S.input, opacity: editing ? 0.6 : 1 },
							value: draft.robotKey,
							placeholder: meta?.robotKey.placeholder || '',
							disabled: editing,
							onChange: (e) => set({ robotKey: e.target.value }),
						}),
					),
					h(
						Field,
						{ label: '群 ID（可选）', hint: '留空 = 这个机器人被拉进的任何一个群里 @ 都会处理；填了就只认这个群。' },
						h('input', {
							style: S.input,
							value: draft.conversationId,
							placeholder: '留空=不限群',
							onChange: (e) => set({ conversationId: e.target.value }),
						}),
					),
				),
				h(
					Field,
					{ label: '人设 / 附加指令（可选）', hint: '会拼在每条群消息前面，用来固定回答口径。留空就按 dsh 默认行为。' },
					h('textarea', {
						style: { ...S.input, minHeight: 56, resize: 'vertical' },
						value: draft.systemPrompt,
						rows: 2,
						placeholder: '例如：回答只给结论和依据，不要客套话。',
						onChange: (e) => set({ systemPrompt: e.target.value }),
					}),
				),
				h(
					'div',
					{ style: { ...S.h2, marginTop: 14 } },
					`凭据（${meta ? meta.label : ''}）`,
				),
				(meta?.credentials || []).map((c) =>
					h(
						Field,
						{ key: c.field, label: `${c.label}${c.required ? '（必填）' : '（可选）'}`, hint: c.hint },
						h('input', {
							style: S.input,
							type: 'password',
							autoComplete: 'new-password',
							value: draft.credentials[c.field] || '',
							placeholder: editing ? '留空表示不修改' : c.required ? '必填' : '可留空',
							onChange: (e) => setCred(c.field, e.target.value),
						}),
					),
				),
				inbound && meta
					? h(
							'div',
							{ style: { marginTop: 6 } },
							h(CopyRow, { label: `回调地址（填到${meta.label}的事件订阅里）`, value: inbound[meta.id] || inbound.base }),
							h('div', { style: S.hint }, meta.callbackNote),
						)
					: null,
				h(
					'div',
					{ style: S.stickyBar },
					saveButton(),
					cancelButton(),
					h('div', { style: S.spacer }),
					h('div', { style: S.hint }, editing ? '改完点「保存」生效' : '带「必填」的凭据没填，消息进不来'),
				),
			)
		}

		/** ISO 时间 → 「11-12 23:36」，按浏览器本地时区。 */
		function whenText(iso) {
			const d = new Date(iso)
			if (Number.isNaN(d.getTime())) return String(iso || '')
			const pad = (n) => String(n).padStart(2, '0')
			return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
		}

		/** 状态 → 中文。表格改成对话视图后，英文状态在气泡旁边太扎眼。 */
		const STATUS_TEXT = {
			queued: '排队中',
			running: '执行中',
			done: '完成',
			ignored: '已忽略（非 @）',
			failed: '失败',
			timeout: '超时',
		}

		/** 解析 usage（存的是 JSON 字符串），解析失败就当没有。 */
		function usageOf(raw) {
			if (!raw) return null
			try {
				const u = JSON.parse(raw)
				return u && typeof u === 'object' ? u : null
			} catch {
				return null
			}
		}

		/**
		 * 一轮对话：用户问题 → 思考（可折叠）→ 回复。
		 *
		 * 思考用浏览器原生 `<details>`：不折叠时长文本会把整页撑爆，
		 * 而想看的人点一下就能展开，不需要自己实现折叠状态。
		 */
		function MessageTurn({ m }) {
			const failed = m.status === 'failed' || m.status === 'timeout'
			const thinking = String(m.thinking || '').trim()
			const usage = usageOf(m.usage)
			const tokens = usage ? usage.outputTokens ?? usage.totalTokens : undefined
			return h(
				'div',
				{ style: S.turn },
				h(
					'div',
					{ style: S.turnMeta },
					h('span', { style: statusStyle(m.status) }, STATUS_TEXT[m.status] || m.status),
					h('span', null, whenText(m.created_at)),
					m.elapsed_ms ? h('span', null, `${(m.elapsed_ms / 1000).toFixed(1)}s`) : null,
					tokens ? h('span', null, `${tokens} tokens`) : null,
					h('div', { style: S.spacer }),
					m.sender_name ? h('span', null, m.sender_name) : null,
				),
				m.inbound ? h('div', { style: S.bubble('user') }, m.inbound) : null,
				thinking
					? h(
							'details',
							{ style: S.thinkingBox },
							h('summary', { style: S.thinkingSummary }, `思考过程 · ${thinking.length} 字`),
							h('div', { style: S.thinkingBody }, thinking),
						)
					: null,
				m.outbound ? h('div', { style: S.bubble('bot') }, m.outbound) : null,
				// 短错误直接显示；headless 的几十行堆栈折起来，别把聊天记录撑成日志文件
				failed && m.error
					? String(m.error).length > 160
						? h(
								'details',
								{ style: S.thinkingBox },
								h('summary', { style: S.thinkingSummary }, `错误详情 · ${String(m.error).length} 字`),
								h('div', { style: { ...S.bubble('error'), marginTop: 7 } }, m.error),
							)
						: h('div', { style: S.bubble('error') }, m.error)
					: null,
				!m.outbound && !thinking && !failed ? h('div', { style: S.hint }, '（这一轮没有产出文本）') : null,
			)
		}

		/** 沟通记录面板：像聊天一样看每一轮的输入、思考与输出。 */
		function Messages({ assistant, messages, loading, onClose, onRefresh }) {
			return h(
				'div',
				{ style: S.panel },
				h(
					'div',
					{ style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 } },
					h('div', { style: { fontSize: 14, fontWeight: 500 } }, `「${assistant.name}」的沟通记录`),
					h('span', { style: S.tag }, `${messages.length} 轮`),
					h('div', { style: S.spacer }),
					h('button', { type: 'button', style: S.btn(false, false), disabled: loading, onClick: onRefresh }, loading ? '读取中…' : '刷新'),
					h('button', { type: 'button', style: S.btn(false, false), onClick: onClose }, '收起'),
				),
				h('div', { style: S.hint }, '最新一轮在最上面。每轮包含群里的提问、模型思考过程（点开看）和最终回复。'),
				loading
					? h('div', { style: S.empty }, '读取中…')
					: messages.length
						? h('div', null, messages.map((m) => h(MessageTurn, { key: m.id, m })))
						: h('div', { style: S.empty }, '还没有记录。群里 @ 一下机器人，或者在卡片上点「测试发送」。'),
			)
		}

		/** 主面板。 */
		function AssistantsPage() {
			const [state, setState] = React.useState({
				loading: true,
				data: null,
				error: '',
				notice: '',
				draft: null,
				busy: '',
				messagesFor: null,
				messages: [],
				messagesLoading: false,
			})
			const set = (patch) => setState((s) => ({ ...s, ...patch }))

			const refresh = React.useCallback(async () => {
				setState((s) => ({ ...s, loading: true, error: '' }))
				try {
					const data = await loadAssistants()
					setState((s) => ({ ...s, loading: false, data, error: '' }))
				} catch (err) {
					setState((s) => ({ ...s, loading: false, error: err.message }))
				}
			}, [])

			React.useEffect(() => {
				refresh()
			}, [refresh])

			const act = async (payload, label, then) => {
				setState((s) => ({ ...s, busy: label, error: '', notice: '' }))
				try {
					const data = await runAction(payload)
					setState((s) => ({ ...s, busy: '', data, error: '', notice: then || '' }))
					return data
				} catch (err) {
					setState((s) => ({ ...s, busy: '', error: err.message }))
					return null
				}
			}

			/**
			 * 打开新建表单。
			 *
			 * @param {string} [platformId] 从哪张平台卡进来的；不传就用第一个平台
			 */
			const startCreate = (platformId) =>
				set({
					draft: {
						id: '',
						platform: platformId || (state.data?.platforms?.[0] || { id: 'dingtalk' }).id,
						name: '',
						robotKey: '',
						conversationId: '',
						systemPrompt: '',
						credentials: {},
					},
					error: '',
					notice: '',
				})

			const startEdit = (a) =>
				set({
					draft: {
						id: a.id,
						platform: a.platform,
						name: a.name,
						robotKey: a.robot_key,
						conversationId: a.conversation_id || '',
						systemPrompt: a.system_prompt || '',
						credentials: {},
					},
					error: '',
					notice: '',
				})

			const save = async () => {
				const d = state.draft
				if (!d) return
				if (!d.name.trim()) return set({ error: '名称不能为空' })
				if (!d.id && !d.robotKey.trim()) return set({ error: '机器人标识不能为空' })
				const payload = d.id
					? {
							action: 'update',
							id: d.id,
							name: d.name.trim(),
							conversationId: d.conversationId.trim(),
							systemPrompt: d.systemPrompt.trim(),
							credentials: d.credentials,
						}
					: {
							action: 'create',
							platform: d.platform,
							name: d.name.trim(),
							robotKey: d.robotKey.trim(),
							conversationId: d.conversationId.trim(),
							systemPrompt: d.systemPrompt.trim(),
							credentials: d.credentials,
						}
				const data = await act(payload, 'save', d.id ? '已保存' : '已创建。填好 Client ID / Client Secret 后会自动连上 Stream，不用配回调地址。')
				if (data) set({ draft: null })
			}

			const openMessages = async (a) => {
				set({ messagesFor: a, messages: [], messagesLoading: true })
				try {
					set({ messages: await loadMessages(a.id), messagesLoading: false })
				} catch (err) {
					set({ messagesLoading: false, error: err.message })
				}
			}

			const reloadMessages = async () => {
				const a = state.messagesFor
				if (!a) return
				set({ messagesLoading: true })
				try {
					set({ messages: await loadMessages(a.id), messagesLoading: false })
				} catch (err) {
					set({ messagesLoading: false, error: err.message })
				}
			}

			const onToggle = (a, enabled) => act({ action: 'toggle', id: a.id, enabled }, `toggle:${a.id}`, enabled ? '已启用' : '已停用')

			const onDelete = (a) => {
				if (!window.confirm(`删除「${a.name}」？会话与流水一起没了，机器人再做回调会 404。`)) return
				act({ action: 'delete', id: a.id }, `delete:${a.id}`, '已删除').then((data) => {
					if (data) set({ messagesFor: null, messages: [] })
				})
			}

			const onTest = (a) => {
				act({ action: 'test', id: a.id }, `test:${a.id}`, '测试消息已处理，去「沟通记录」看结果。')
			}

			const data = state.data
			const platforms = data?.platforms || []
			const list = data?.assistants || []
			const enabledCount = list.filter((a) => a.enabled).length

			const banners = []
			if (state.error) banners.push(h('div', { key: 'err', style: S.banner('bad'), role: 'alert' }, state.error))
			if (state.notice) banners.push(h('div', { key: 'ok', style: S.banner('ok') }, state.notice))
			if (data && !data.manage) {
				banners.push(h('div', { key: 'ro', style: S.banner('ok') }, '你不是这个团队的 owner，只能查看，不能新增或改动。'))
			}
			// 「回调地址是本机地址」这类说明只对飞书有意义，已收进飞书分组的「接入说明」，
			// 不再用整屏横幅占位。

			const header = h(
				'div',
				{ style: { ...S.head, marginTop: 2 } },
				h('h1', { style: S.h1 }, '助理'),
				h('span', { style: S.sub }, data ? `${data.teamName} · ${list.length} 个助理，${enabledCount} 个启用` : '机器人 ↔ 会话'),
				h('div', { style: S.spacer }),
				h('button', { type: 'button', style: S.btn(false, false), disabled: state.loading, onClick: refresh }, state.loading ? '读取中…' : '刷新'),
			)

			// 按平台分组直接铺开：组标题一行（名称 + 数量 + 接入说明 + 接入按钮），
			// 下面是该平台已接入的助理。空平台只留一行虚框提示，不占整块版面。
			const groups = platforms.map((p) =>
				h(PlatformGroup, {
					key: p.id,
					meta: p,
					items: list.filter((a) => a.platform === p.id),
					manage: data?.manage,
					inbound: data?.inbound,
					busy: state.busy,
					onAdd: startCreate,
					onEdit: startEdit,
					onMessages: openMessages,
					onToggle,
					onTest,
					onDelete,
				}),
			)

			return h(
				'div',
				{ style: S.page },
				h(
					'div',
					{ style: S.wrap },
					header,
					banners,
					state.draft
						? h(Editor, {
								draft: state.draft,
								platforms,
								inbound: data?.inbound,
								busy: state.busy,
								onChange: (draft) => set({ draft }),
								onSave: save,
								onCancel: () => set({ draft: null }),
							})
						: state.loading && !data
							? h('div', { style: S.empty }, '读取中…')
							: groups,
					state.messagesFor
						? h(Messages, {
								assistant: state.messagesFor,
								messages: state.messages,
								loading: state.messagesLoading,
								onClose: () => set({ messagesFor: null, messages: [] }),
								onRefresh: reloadMessages,
							})
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
			ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, AssistantsPage))
			ctx.slots.inject('sidebar.panellist', () =>
				ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 4, label: () => '助理' }, AssistantsIcon),
			)
		}

		exports.apply = apply
		exports.inject = inject
		return module.exports
	},
})
