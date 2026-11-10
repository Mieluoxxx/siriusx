import { createServer } from 'node:http'
createServer((request, response) => {
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' }
  if (request.method === 'OPTIONS') { response.writeHead(204, headers).end(); return }
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
  const body = path === '/api/bots' ? { bots: [] } : path === '/api/tickets' ? { tickets: [] } : path === '/api/approvals' ? { approvals: [] } : path === '/api/devices' ? { devices: [] } : {}
  response.writeHead(200, { ...headers, 'content-type': 'application/json' }).end(JSON.stringify(body))
}).listen(4319, '127.0.0.1')
