#!/usr/bin/env node
/** Minimal static update feed server for offline/self-hosted SiriusX builds. */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'

const root = resolve(process.env.ROOT ?? '.')
const port = Number(process.env.PORT ?? 8081)
const host = process.env.HOST ?? '127.0.0.1'
const types = { '.yml': 'text/yaml', '.yaml': 'text/yaml', '.json': 'application/json', '.dmg': 'application/octet-stream', '.exe': 'application/octet-stream', '.zip': 'application/zip' }

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
  if (url.pathname === '/health') { response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, service: 'siriusx-update-feed' })); return }
  const relative = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.(\/|\\|$))+/, '')
  const path = join(root, relative)
  if (!path.startsWith(root)) { response.writeHead(403).end(); return }
  try {
    const info = await stat(path)
    if (!info.isFile()) { response.writeHead(404).end(); return }
    response.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream', 'content-length': info.size, 'cache-control': 'no-cache' })
    createReadStream(path).pipe(response)
  } catch { response.writeHead(404).end() }
}).listen(port, host, () => console.log(JSON.stringify({ ready: true, root, url: `http://${host}:${port}` })))
