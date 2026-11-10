# @siriusx/dsh-executor-local

Host plugin that exposes the local Executor inside a DSH Web Host. It is a
DSH bundle: adding the package to a profile inserts the `siriusx-executor-local`
row automatically.

The S3 test route is loopback-only:

```text
POST /__siriusx/executor/run
{"path":"/absolute/local/repo","prompt":"..."}
```

It creates one `local_dir` Assignment, drives a real in-process DSH Agent through
`@siriusx/kernel-dsh`, and returns the contract Assignment plus event stream.
This test route is not a production transport; S5 puts the authenticated
Executor behind the gateway.
