# Container image CI workflow

新增 `.github/workflows/images.yml`：

- 触发：`workflow_dispatch` 或 `v*` tag
- GHCR 登录
- 构建并推送：
  - `ghcr.io/<repo>/control-plane:<sha>`
  - `ghcr.io/<repo>/dsh-web:<sha>`
- 上传 image tag metadata

`scripts/check-ci.py` 同时校验 `.github/workflows/ci.yml` 与
`.github/workflows/images.yml` 的 job/step 结构。

说明：本环境没有 Jenkins/GitHub Runner/registry 凭据，因此只做静态校验；
真实 push 需要仓库 Actions 权限和 GHCR 访问。

证据：`validate.txt`。
