# @siriusx/dsh-client-ui-team

DSH 客户端插件，挂载一个全局侧栏入口与主面板：

- Bot 列表
- 工单列表与七阶段
- 工单详情、报告、事件
- 补充输入 / 打断
- 审批卡片占位（S5/S6 接真实审批 API）

面板连接 `http://127.0.0.1:4319` 的本地 Bot API，地址可以用浏览器
`localStorage['siriusx.botApi']` 覆盖。
