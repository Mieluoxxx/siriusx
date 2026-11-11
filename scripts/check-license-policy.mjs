#!/usr/bin/env node
/** Fail the release gate on strong copyleft or source-available licenses. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const sbom = JSON.parse(readFileSync(resolve(root, 'artifacts/release/sbom.cdx.json'), 'utf8'))
const forbidden = /(^|[^L])(A?GPL|SSPL|BUSL)/iu
const warnings = []
const blocked = []
for (const component of sbom.components) {
  const licenses = (component.licenses ?? []).map(entry => entry.license?.id ?? entry.license?.name ?? '').filter(Boolean)
  if (licenses.length === 0) warnings.push(`${component.name}@${component.version}: unknown license`)
  if (licenses.some(license => forbidden.test(license))) blocked.push(`${component.name}@${component.version}: ${licenses.join(', ')}`)
  if (licenses.some(license => /LGPL/iu.test(license))) warnings.push(`${component.name}@${component.version}: ${licenses.join(', ')}`)
}
console.log(JSON.stringify({ components: sbom.components.length, blocked, warnings: warnings.length }, null, 2))
if (blocked.length > 0) {
  console.error(`forbidden licenses:\n${blocked.join('\n')}`)
  process.exit(1)
}
