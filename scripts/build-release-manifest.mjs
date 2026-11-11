#!/usr/bin/env node
/** Write reproducible build metadata for release artifacts. */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dsh = process.env.DSH_DIR ?? join(root, 'deepseek-harness')
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const manifest = {
  schema: 'siriusx.release-manifest/v1',
  generatedAt: new Date().toISOString(),
  siriusx: { commit: git(root, ['rev-parse', 'HEAD']), describe: git(root, ['describe', '--tags', '--always']) },
  dshFork: { commit: git(dsh, ['rev-parse', 'HEAD']), branch: git(dsh, ['branch', '--show-current']) },
  contract: { tag: process.env.SIRIUSX_CONTRACT_TAG ?? 'executor-v0.1.0' },
  images: {
    controlPlane: process.env.SIRIUSX_IMAGE ?? 'siriusx/control-plane:offline',
    dshWeb: process.env.SIRIUSX_DSH_WEB_IMAGE ?? 'siriusx/dsh-web:offline',
    sandbox: process.env.SIRIUSX_SANDBOX_IMAGE ?? 'teams-bridge:0.2.0',
  },
  versions: { node: process.env.SIRIUSX_NODE_VERSION ?? process.versions.node, pnpm: process.env.SIRIUSX_PNPM_VERSION ?? '11.28.5' },
}
mkdirSync(join(root, 'artifacts/release'), { recursive: true })
const path = join(root, 'artifacts/release/manifest.json')
writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(JSON.stringify({ manifest: path, siriusx: manifest.siriusx.commit, dsh: manifest.dshFork.commit }, null, 2))
