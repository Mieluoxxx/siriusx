# @siriusx/dsh-account-sso

Enterprise OIDC account provider. It occupies the `deepseekAccount` service
used by the existing DSH welcome/account controller and publishes
`siriusxTenant` for Host extensions.

Required production environment:

```text
SIRIUSX_ENTERPRISE=1
SIRIUSX_SSO_ISSUER=https://idp.example.com
SIRIUSX_SSO_CLIENT_ID=siriusx-desktop
SIRIUSX_SSO_REDIRECT_PATH=/__siriusx/sso/callback
SIRIUSX_SSO_TENANT_CLAIM=tenant_id
SIRIUSX_SSO_JWKS_URI=https://idp.example.com/.well-known/jwks.json
```

Optional endpoint overrides: `SIRIUSX_SSO_AUTHORIZE_PATH`, `SIRIUSX_SSO_TOKEN_PATH`.
For local tests only, `SIRIUSX_SSO_HS256_SECRET` can verify HS256 tokens. Without
either JWKS or HS256 verification the provider fails closed.

The provider stores the grant through `ctx.credentials`; no token enters the
renderer, logs or the Electron cookie jar.
