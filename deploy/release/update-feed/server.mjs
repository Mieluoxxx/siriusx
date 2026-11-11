#!/usr/bin/env node
/** Minimal static update feed server for offline/self-hosted SiriusX builds. */
import { createReadStream, realpathSync } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, normalize, resolve, sep } from 'node:path'

const root = resolve(process.env.ROOT ?? '.')
const realRoot = realpathSync(root)
const port = Number(process.env.PORT ?? 8081)
const host = process.env.HOST ?? '127.0.0.1'
const types = { '.yml': 'text/yaml', '.yaml': 'text/yaml', '.json': 'application/json', '.dmg': 'application/octet-stream', '.exe': 'application/octet-stream', '.zip': 'application/zip' }

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
  if (url.pathname === '/health') { response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, service: 'siriusx-update-feed' })); return }
  let path
  let realPath
  try {
    const relative = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.(\/|\\|$))+/, '')
    path = resolve(realRoot, `.${relative}`)
    if (path !== realRoot && !path.startsWith(realRoot + sep)) { response.writeHead(403).end(); return }
    realPath = await realpath(path)
    if (realPath !== realRoot && !realPath.startsWith(realRoot + sep)) { response.writeHead(403).end(); return }
  } catch { response.writeHead(404).end(); return }
  try {
    const info = await stat(realPath)
    if (!info.isFile()) { response.writeHead(404).end(); return }
    response.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream', 'content-length': info.size, 'cache-control': 'no-cache' })
    createReadStream(realPath).pipe(response)
  } catch { response.writeHead(404).end() }
}).listen(port, host, () => console.log(JSON.stringify({ ready: true, root, url: `http://${host}:${port}` })))
