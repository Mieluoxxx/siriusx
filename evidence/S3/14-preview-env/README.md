# Preview environment isolation

- preview 不再继承完整 `process.env`；
- 只透传 PATH/HOME/TMP/LANG/SHELL/USER 等运行必需变量；
- 测试设置 `SIRIUSX_PREVIEW_SECRET`，preview 子进程写出的 env 中不存在该变量；
- PATH 等基础变量仍可用。
- 证据：`test.txt`、`typecheck.txt`。
