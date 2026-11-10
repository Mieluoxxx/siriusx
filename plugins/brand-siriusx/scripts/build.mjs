import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'

const CLIENT_ID = '@siriusx/dsh-client-brand'
await mkdir('lib', { recursive: true })
await build({ entryPoints: ['src/index.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'lib/index.js', external: ['@deepseek-ai/*'], legalComments: 'none' })
const client = await build({
  entryPoints: ['src/client/index.tsx'], bundle: true, platform: 'browser', format: 'cjs', jsx: 'automatic', write: false,
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/*'], legalComments: 'none',
})
await writeFile('lib/client.js', `window.__ModuleLoader__.load({\n  id: ${JSON.stringify(CLIENT_ID)},\n  factory: (require) => {\n    var module = { exports: {} };\n    var exports = module.exports;\n${client.outputFiles[0].text}\n    return module.exports;\n  }\n});\n`)
