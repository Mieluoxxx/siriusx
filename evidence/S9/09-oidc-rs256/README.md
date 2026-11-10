# OIDC RS256 + JWKS

Local discovery/authorize/token/JWKS IdP:

- 配置 `idTokenAlg=RS256`
- discovery 返回 `jwks_uri`
- web-gateway 通过 `createRemoteJWKSet` 验签
- 校验 issuer/audience/nonce 后换取 control-plane session

证据：`run.txt`。仍缺真实企业 IdP 的 issuer/client/role mapping。
