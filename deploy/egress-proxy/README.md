# SiriusX egress allowlist proxy

`server.mjs` is a tiny HTTP/HTTPS CONNECT proxy used by cloud sandboxes.

```sh
PORT=3128 ALLOWED_HOSTS=api.github.com,github.com node server.mjs
```

Deployment model:

- Let `ALLOWED_HOSTS` contain only the domains the sandbox may reach.
- Put the sandbox and proxy on an `--internal` Docker network.
- Connect the proxy to a separate egress network.
- Configure `DockerSandboxProvider({ allowlistNetwork: '<internal>', proxyUrl: 'http://<proxy>:3128' })`.

The proxy denies non-allowlisted CONNECT/HTTP targets. The sandbox still uses
`--network` only for the internal segment, so direct external egress fails.
