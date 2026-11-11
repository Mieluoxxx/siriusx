# Device pairing UI

- Devices tab 新增 Pair device 表单；
- 输入设备名 → `POST /v1/devices/pair/start`；
- 显示 pairing code；
- 输入 code → `POST /v1/devices/pair/confirm`；
- 成功后设备出现在列表，状态 `active`。
- 浏览器实测：Pixel 配对成功，console errors 为空。
- 证据：`run.txt`、`pairing.png`、`build.txt`、`typecheck.txt`。
