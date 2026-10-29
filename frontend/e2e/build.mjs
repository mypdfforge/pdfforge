import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
const G = '/home/claude/.npm-global/lib/node_modules'
const esbuild = createRequire(G + '/tsx/')('esbuild')
const dir = path.dirname(new URL(import.meta.url).pathname), out = path.join(dir, 'dist')
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true })
// stub every lucide icon the editor imports (icons are not under test; component wiring is)
const names = new Set()
for (const f of fs.readdirSync(path.join(dir, '../src/editor/ui'))) if (f.endsWith('.jsx')) {
  for (const m of fs.readFileSync(path.join(dir, '../src/editor/ui', f), 'utf8').matchAll(/import \{([^}]+)\} from 'lucide-react'/g)) m[1].split(',').forEach((n) => names.add(n.trim()))
}
fs.writeFileSync(path.join(dir, 'lucide-stub.js'), `import React from 'react'\nconst mk = (n) => (p) => React.createElement('i', { 'data-icon': n, style: { display: 'inline-block', width: 1, height: 1 } })\n${[...names].map((n) => `export const ${n} = mk('${n}')`).join('\n')}\n`)
const common = { bundle: true, sourcemap: false, nodePaths: [G], loader: { '.js': 'jsx' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'error' }
await esbuild.build({ ...common, entryPoints: [path.join(dir, 'harness.jsx')], outfile: path.join(out, 'app.js'), format: 'esm', alias: { 'lucide-react': path.join(dir, 'lucide-stub.js') }, jsx: 'automatic' })
await esbuild.build({ ...common, entryPoints: [path.join(dir, '../src/editor/worker/exportWorker.ts')], outfile: path.join(out, 'worker.js'), format: 'esm' })
fs.copyFileSync(G + '/pdf-lib/dist/pdf-lib.min.js', path.join(out, 'pdf-lib.min.js'))
// harness only: pdfjs-dist 5.x (local) needs Map.getOrInsert*, absent in this Chromium. The app itself uses pdf.js 3.11.174 from CDN.
const poly = 'for (const C of [Map, WeakMap]) { C.prototype.getOrInsert ??= function (k, d) { if (!this.has(k)) this.set(k, d); return this.get(k) }; C.prototype.getOrInsertComputed ??= function (k, f) { if (!this.has(k)) this.set(k, f(k)); return this.get(k) } }\n'
for (const [a, b] of [['pdf.min.mjs', 'pdf.mjs'], ['pdf.worker.min.mjs', 'pdf.worker.mjs']]) fs.writeFileSync(path.join(out, b), poly + fs.readFileSync(G + '/pdfjs-dist/build/' + a, 'utf8'))
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><html data-theme="light"><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div>
<script src="/pdf-lib.min.js"></script>
<script type="module">import * as pdfjs from '/pdf.mjs'; pdfjs.GlobalWorkerOptions.workerSrc='/pdf.worker.mjs'; window.pdfjsLib = pdfjs; await import('/app.js')</script></body></html>`)
console.log('built', fs.readdirSync(out).map((f) => f + ':' + Math.round(fs.statSync(path.join(out, f)).size / 1024) + 'KB').join(' '))
