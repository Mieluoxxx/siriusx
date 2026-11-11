# Tool gateway CORS

- 默认不输出 `access-control-allow-origin`，避免浏览器跨源直接调用内部 tool gateway；
- 仅当设置 `SIRIUSX_TOOL_GATEWAY_CORS_ORIGIN` / `corsOrigin` 时输出指定 origin；
- control-plane 服务到服务调用不受影响；
- 测试验证默认 OPTIONS 无 CORS header，显式配置后有指定 origin。
- 证据：`test.txt`、`typecheck.txt`。
