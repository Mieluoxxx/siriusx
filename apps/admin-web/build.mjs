#!/usr/bin/env node
import esbuild from 'esbuild'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname)
const out = join(root, 'dist')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
await esbuild.build({
  entryPoints: [join(root, 'src/main.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  jsx: 'automatic',
  outfile: join(out, 'admin.js'),
})
copyFileSync(join(root, 'public/index.html'), join(out, 'index.html'))
copyFileSync(join(root, 'public/style.css'), join(out, 'style.css'))
console.log(JSON.stringify({ built: out }))
