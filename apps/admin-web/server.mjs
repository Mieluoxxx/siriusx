#!/usr/bin/env node
/** Static SiriusX admin SPA plus a narrow, same-origin platform-admin API proxy. */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname)
const dist = join(root, 'dist')
const controlPlaneUrl = (process.env.CONTROL_PLANE_URL ?? 'http://127.0.0.1:4320').replace(/\/$/u, '')
const port = Number(process.env.PORT ?? 8090)
const host = process.env.HOST ?? '0.0.0.0'
const MAX_BODY = 1024 * 1024

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' }
const files = { '/': join(dist, 'index.html'), '/admin.js': join(dist, 'admin.js'), '/style.css': join(dist, 'style.css'), '/stylex.css': join(dist, 'stylex.css') }

function headers(path) {
  return {
    'content-type': path === '/' ? types['.html'] : types[extname(path)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    ...(path === '/' ? { 'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" } : {}),
  }
}

async function bodyOf(request) {
  const chunks = []
  let total = 0
  for await (const chunk of request) {
    total += chunk.byteLength
    if (total > MAX_BODY) throw new Error('request body exceeds 1 MiB')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
    if (url.pathname === '/health') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ ok: true, service: 'siriusx-admin-web' }))
      return
    }
    if (url.pathname.startsWith('/v1/admin/')) {
      const token = request.headers['x-siriusx-platform-token']
      const headers = { ...(typeof request.headers['content-type'] === 'string' ? { 'content-type': request.headers['content-type'] } : {}), ...(typeof token === 'string' ? { 'x-siriusx-platform-token': token } : {}) }
      const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await bodyOf(request)
      const upstream = await fetch(`${controlPlaneUrl}${url.pathname}${url.search}`, {
        method: request.method,
        headers,
        ...(body === undefined || body.byteLength === 0 ? {} : { body }),
        signal: AbortSignal.timeout(30_000),
      })
      const bytes = Buffer.from(await upstream.arrayBuffer())
      response.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
        ...(upstream.headers.get('content-disposition') === null ? {} : { 'content-disposition': upstream.headers.get('content-disposition') }),
        'content-length': bytes.byteLength,
        'cache-control': 'no-store',
      })
      response.end(bytes)
      return
    }
    const file = files[url.pathname]
    if (file === undefined) {
      const spaPath = url.pathname === '/tenants' || url.pathname === '/models' || url.pathname === '/sources' || url.pathname === '/support' || url.pathname === '/audit' || /^\/tenants\/[^/]+$/u.test(url.pathname)
      if (request.method !== 'GET' || !spaPath) {
        response.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
        return
      }
      const bytes = await readFile(files['/'])
      response.writeHead(200, { ...headers('/'), 'content-length': bytes.byteLength })
      response.end(bytes)
      return
    }
    const bytes = await readFile(file)
    response.writeHead(200, { ...headers(url.pathname), 'content-length': bytes.byteLength })
    response.end(bytes)
  } catch (error) {
    response.writeHead(500, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
  }
}).listen(port, host, () => console.log(JSON.stringify({ ready: true, port, controlPlaneUrl })))
