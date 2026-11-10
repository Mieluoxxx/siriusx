# SiriusX Web Gateway

Same-origin browser entry for DSH Web + SiriusX control plane.

## SSO (OIDC authorization code + PKCE)

Required environment:

```text
SIRIUSX_SSO_SERVICE_TOKEN=<control-plane service token>
SIRIUSX_OIDC_ISSUER=https://idp.example
SIRIUSX_OIDC_CLIENT_ID=siriusx-web
SIRIUSX_OIDC_CLIENT_SECRET=<secret>
SIRIUSX_OIDC_REDIRECT_URI=https://siriusx.example/auth/oidc/callback
SIRIUSX_OIDC_TENANT_ID=tenant-acme
SIRIUSX_OIDC_ROLE=member
```

`SIRIUSX_OIDC_ID_TOKEN_ALG=HS256` is supported for local tests; production should use
RS256/ES256 and JWKS discovery. The gateway verifies state, nonce, issuer, audience,
then exchanges the verified email for a control-plane session via the service-token
endpoint. The browser only receives an HttpOnly `siriusx_session` cookie.
