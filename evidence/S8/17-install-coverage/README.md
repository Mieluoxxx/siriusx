# Install coverage check

`scripts/check-install-coverage.sh` 校验：

- compose 包含 control-plane/tool-gateway/dsh-web/web-gateway；
- full bundle 包含三个镜像 tar；
- offline app 包含 web-gateway；
- offline packages 包含 cloud-executor/kernel-acp；
- native installer 包含 reaper timer。

证据：`check.txt`。
