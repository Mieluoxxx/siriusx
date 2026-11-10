#!/usr/bin/env node
/** Minimal allowlist HTTP CONNECT proxy for sandbox egress tests. */
import http from 'node:http'
import net from 'node:net'

const port = Number(process.env.PORT ?? 3128)
const allowed = (process.env.ALLOWED_HOSTS ?? '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean)
const isAllowed = (hostname) => {
  const host = hostname.toLowerCase()
  return allowed.some(entry => host === entry || host.endsWith(`.${entry}`))
}
const deny = (socket) => { socket.end('HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nContent-Length: 12\r\n\r\nnot allowed\n') }

const server = http.createServer((request, response) => {
  let target
  try { target = new URL(request.url ?? '') } catch { response.writeHead(400).end('bad proxy request'); return }
  if (!isAllowed(target.hostname)) { response.writeHead(403).end('not allowed'); return }
  const upstream = http.request({ hostname: target.hostname, port: target.port || 80, path: `${target.pathname}${target.search}`, method: request.method, headers: request.headers }, proxied => {
    response.writeHead(proxied.statusCode ?? 502, proxied.headers)
    proxied.pipe(response)
  })
  upstream.on('error', error => response.writeHead(502).end(error.message))
  request.pipe(upstream)
})

server.on('connect', (request, clientSocket, head) => {
  const [hostname, rawPort] = (request.url ?? '').split(':')
  if (hostname === undefined || !isAllowed(hostname)) { deny(clientSocket); return }
  const upstream = net.connect(Number(rawPort ?? 443), hostname, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    if (head.length > 0) upstream.write(head)
    upstream.pipe(clientSocket)
    clientSocket.pipe(upstream)
  })
  upstream.on('error', () => deny(clientSocket))
})

server.listen(port, process.env.HOST ?? '0.0.0.0', () => {
  console.log(JSON.stringify({ ready: true, port, allowed }))
})
