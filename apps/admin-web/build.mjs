#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname)
const out = join(root, 'dist')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const pnpmDir = join(resolve(root, '../..'), 'node_modules/.pnpm')
const esbuildPackage = readdirSync(pnpmDir).find(name => name.startsWith('esbuild@'))
if (esbuildPackage === undefined) throw new Error('esbuild package not found')
const esbuild = join(pnpmDir, esbuildPackage, 'node_modules/esbuild/bin/esbuild')
execFileSync(esbuild, ['src/main.ts', '--bundle', '--format=iife', '--target=es2020', '--minify', `--outfile=${join(out, 'admin.js')}`], { cwd: root, stdio: 'inherit' })
copyFileSync(join(root, 'public/index.html'), join(out, 'index.html'))
copyFileSync(join(root, 'public/style.css'), join(out, 'style.css'))
console.log(JSON.stringify({ built: out }))
