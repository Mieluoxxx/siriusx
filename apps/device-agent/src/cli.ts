#!/usr/bin/env node
import { startDeviceAgent } from './index.ts'

const args = process.argv.slice(2)
const flags = new Map<string, string>()
for (let index = 0; index < args.length; index += 2) {
  const key = args[index]
  const value = args[index + 1]
  if (key === undefined || value === undefined || !key.startsWith('--')) {
    console.error('usage: device-agent --url ws://... --token <device-token>')
    process.exit(2)
  }
  flags.set(key.slice(2), value)
}
const url = flags.get('url')
const token = flags.get('token')
if (url === undefined || token === undefined) {
  console.error('usage: device-agent --url ws://... --token <device-token>')
  process.exit(2)
}
const agent = await startDeviceAgent({ url, token, onError: error => console.error('device-agent:', error) })
await agent.ready
console.log(JSON.stringify({ ready: true, device: new URL(url).host }))
const stop = (): void => { agent.close(); process.exit(0) }
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
await new Promise<void>(() => {})
