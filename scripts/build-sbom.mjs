#!/usr/bin/env node
/** Convert pnpm dependency metadata into a CycloneDX 1.5 SBOM. */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const raw = execFileSync('pnpm', ['list', '-r', '--depth', 'Infinity', '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const projects = JSON.parse(raw)
const components = new Map()
const purlName = name => name.startsWith('@') ? `%40${name.slice(1).replace('/', '%2F')}` : name
const licenseFor = path => {
  if (typeof path !== 'string' || !existsSync(`${path}/package.json`)) return undefined
  try {
    const license = JSON.parse(readFileSync(`${path}/package.json`, 'utf8')).license
    if (typeof license === 'string' && license !== '' && license !== 'UNLICENSED') return [{ license: { id: license } }]
    if (typeof license === 'object' && license !== null && typeof license.type === 'string') return [{ license: { id: license.type } }]
  } catch { /* metadata is best effort */ }
  return undefined
}
const add = (name, info) => {
  if (typeof name !== 'string' || info === undefined || info === null || typeof info.version !== 'string') return
  const key = `${name}@${info.version}`
  if (!components.has(key)) components.set(key, {
    type: 'library', name, version: info.version,
    purl: `pkg:npm/${purlName(name)}@${info.version}`,
    ...(licenseFor(info.path) === undefined ? {} : { licenses: licenseFor(info.path) }),
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
console.log(JSON.stringify({ sbom: path, components: sbom.components.length, licensed: sbom.components.filter(component => component.licenses !== undefined).length }, null, 2))
