/**
 * client-ui-assistants —— host 侧壳。
 *
 * 这个包只在浏览器里干活：`apply` 必须是空的，作用是给 Loader 留一行宿主侧记录，
 * 浏览器那一半从 `exports["./client"]` 走 dsh-client-modules 的 /plugins 通道下发。
 * 与 client-ui-market 同一套做法。
 */
export function apply() {}
