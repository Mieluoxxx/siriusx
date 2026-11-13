/** Dictionaries for the SiriusX entries in the Plugins page. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** Dictionary namespace owned by this plugin. */
export const NS = 'siriusx.enterprise'

/** Locale keys the entries render. */
export type EnterpriseLocaleKey =
  | 'accountTitle' | 'accountSummary' | 'gatewayTitle' | 'gatewaySummary'
  | 'statusSection' | 'refresh' | 'loading' | 'unavailable' | 'unavailableReason'
  | 'loginState' | 'signedIn' | 'signedOut' | 'tenant' | 'roles'
  | 'controlSession' | 'controlSessionReady' | 'controlSessionMissing' | 'controlPlane' | 'controlSessionFailed'
  | 'model' | 'modelNone' | 'gatewayAuth' | 'gatewayAuthReady' | 'gatewayAuthMissing' | 'gatewayAuthHint'
  | 'packageName' | 'empty'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Copy of the SiriusX enterprise entries in the Plugins page. */
    'siriusx.enterprise': EnterpriseLocaleKey
  }
}

/** English copy. */
export const en: Record<EnterpriseLocaleKey, string> = {
  accountTitle: 'SiriusX enterprise sign-in',
  accountSummary: 'Sign in with your enterprise account and exchange it for a tenant session.',
  gatewayTitle: 'SiriusX model gateway',
  gatewaySummary: 'Model requests go through the tenant model gateway, authorized by the control-plane session.',
  statusSection: 'Status',
  refresh: 'Refresh status',
  loading: 'Reading status…',
  unavailable: "Couldn't read the status. The enterprise sign-in plugin may not be loaded.",
  unavailableReason: 'Reason: {reason}',
  loginState: 'Sign-in',
  signedIn: 'Signed in',
  signedOut: 'Not signed in',
  tenant: 'Tenant',
  roles: 'Roles',
  controlSession: 'Control-plane session',
  controlSessionReady: 'Established',
  controlSessionMissing: 'Not established',
  controlPlane: 'Control plane',
  controlSessionFailed: 'The last session exchange failed: {message}',
  model: 'Model',
  modelNone: 'Not assigned',
  gatewayAuth: 'Gateway authorization',
  gatewayAuthReady: 'Ready',
  gatewayAuthMissing: 'Unavailable',
  gatewayAuthHint: 'Sign in again so the enterprise sign-in can exchange a control-plane session.',
  packageName: 'Package',
  empty: '—',
}

/** Simplified Chinese copy. */
export const zh: Record<EnterpriseLocaleKey, string> = {
  accountTitle: 'SiriusX 企业登录',
  accountSummary: '使用企业账号登录，并向控制面换取租户会话。',
  gatewayTitle: 'SiriusX 模型网关',
  gatewaySummary: '模型请求经租户模型网关转发，由控制面会话鉴权。',
  statusSection: '运行状态',
  refresh: '刷新状态',
  loading: '正在读取状态…',
  unavailable: '读取不到状态，企业登录插件可能没有加载。',
  unavailableReason: '原因：{reason}',
  loginState: '登录状态',
  signedIn: '已登录',
  signedOut: '未登录',
  tenant: '租户',
  roles: '角色',
  controlSession: '控制面会话',
  controlSessionReady: '已建立',
  controlSessionMissing: '未建立',
  controlPlane: '控制面地址',
  controlSessionFailed: '最近一次换取会话失败：{message}',
  model: '模型',
  modelNone: '尚未分配',
  gatewayAuth: '网关鉴权',
  gatewayAuthReady: '可用',
  gatewayAuthMissing: '不可用',
  gatewayAuthHint: '请重新登录，让企业登录换取控制面会话。',
  packageName: '插件包',
  empty: '—',
}
