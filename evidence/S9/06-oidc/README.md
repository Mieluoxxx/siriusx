# Browser OIDC login

Runs a local discovery/authorize/token IdP, then exercises:

- `/auth/oidc/start` → authorization endpoint (PKCE/state/nonce)
- `/auth/oidc/callback` → token exchange + ID-token verification
- web-gateway → control-plane service-token SSO session exchange
- `/v1/me` with the resulting HttpOnly cookie

Evidence: `run.txt`. The local IdP uses HS256; production must use JWKS-backed
asymmetric tokens from a real enterprise IdP.
