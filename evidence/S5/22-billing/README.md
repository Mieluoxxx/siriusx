# Tenant billing estimate

- `tenant_billing`：currency、cloudTicketCents、deviceTicketCents、monthlyBudgetCents
- `GET/PUT /v1/admin/tenants/:id/billing`
- `billingEstimate(tenantId, days)` 基于 usageDaily 计算估算成本
- Platform admin 页面提供 Billing 表单与 Estimate

测试验证默认 USD、更新 EUR、预算与估算。
证据：`test.txt`、`typecheck.txt`、`ui-typecheck.txt`、`../15-platform-admin-ui/admin.png`。
