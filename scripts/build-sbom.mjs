#!/usr/bin/env node
/** Convert pnpm dependency metadata into a CycloneDX 1.5 SBOM. */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const raw = execFileSync('pnpm', ['list', '-r', '--depth', 'Infinity', '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const projects = JSON.parse(raw)
const components = new Map()
const purlName = name => name.startsWith('@') ? `%40${name.slice(1).replace('/', '%2F')}` : name
const add = (name, info) => {
  if (typeof name !== 'string' || info === undefined || info === null || typeof info.version !== 'string') return
  const key = `${name}@${info.version}`
  if (!components.has(key)) components.set(key, {
    type: 'library', name, version: info.version,
    purl: `pkg:npm/${purlName(name)}@${info.version}`,
  })
  for (const dependency of Object.values(info.dependencies ?? {})) add(dependency.from ?? '', dependency)
}
for (const project of projects) {
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, info] of Object.entries(project[field] ?? {})) add(name, info)
  }
}
const sbom = {
  bomFormat: 'CycloneDX', specVersion: '1.5', version: 1,
  metadata: { timestamp: new Date().toISOString(), tools: { components: [{ type: 'application', name: 'siriusx-build-sbom', version: '1' }] } },
  components: [...components.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`)),
}
mkdirSync(join(root, 'artifacts/release'), { recursive: true })
const path = join(root, 'artifacts/release/sbom.cdx.json')
writeFileSync(path, `${JSON.stringify(sbom, null, 2)}\n`)
console.log(JSON.stringify({ sbom: path, components: sbom.components.length }, null, 2))
