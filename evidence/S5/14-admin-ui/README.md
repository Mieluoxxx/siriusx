# Management plane UI

Team panel 新增 `admin` tab（仅 admin role 显示内容）：

- Tenant settings：
  - nativeConversationEnabled
  - byokEnabled
  - localExecutionEnabled
- Users：
  - 列出 email / role
  - 新增用户
  - 修改 role

浏览器实测：

- 看到 member@admin.example
- Tenant settings 可见
- 新增 new@admin.example
- console errors 为空

证据：`run.txt`、`admin.png`、`typecheck.txt`、`build.txt`。
