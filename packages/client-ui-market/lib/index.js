/**
 * client-ui-market —— host 侧壳。
 *
 * 这个包只在浏览器里干活：`apply` 必须是空的，作用是给 Loader 留一行宿主侧记录，
 * 浏览器那一半从 `exports["./client"]` 走 dsh-client-modules 的 /plugins 通道下发。
 * 照抄 dsh 自己的 client-ui-brand-official 的做法。
 */
export function apply() {}
