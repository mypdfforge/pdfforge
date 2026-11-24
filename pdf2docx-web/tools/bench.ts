/**
 * bench.ts — corpus benchmark. Node/tsx. Reuses the Batch-1 OpenXML gate.
 * Usage: npm run bench [-- --update-baseline] [-- --tier tierA]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { unzipSync } from 'fflate';
import { loadPdfDocument } from '../src/ingest/pdfLoader.js';
import { convertDocumentIRToDocx } from '../src/dla/pipeline.js';
// @ts-ignore — plain JS module shared with the browser build
import { verifyDocxEntries } from '../../frontend/src/utils/docxVerify.js';

const ROOT = process.cwd();
const OUT = join(ROOT, 'metrics', 'reports');
const dec = new TextDecoder();
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function docxParts(buf: Uint8Array) {
  const z = unzipSync(buf);
  const entries: Record<string, string> = {};
  for (const k of Object.keys(z)) if (k.endsWith('.xml') || k.endsWith('.rels')) entries[k] = dec.decode(z[k]);
  const doc = entries['word/document.xml'] || '';
  const text = unesc([...doc.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(m => m[1]).join(' '));
  const tables = [...doc.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map(t => {
    const rows = [...t[0].matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)];
    return {
      rows: rows.length,
      cols: Math.max(0, ...rows.map(r => [...r[0].matchAll(/<w:gridSpan w:val="(\d+)"/g)].reduce((a, m) => a + +m[1], 0)
        + (r[0].match(/<w:tc>/g) || []).length - (r[0].match(/<w:gridSpan/g) || []).length)),
      cells: [...t[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map(c =>
        unesc([...c[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(m => m[1]).join('')).trim()).filter(Boolean),
    };
  });
  return { entries, text, tables, textboxes: (doc.match(/<w:txbxContent/g) || []).length };
}
const toks = (s: string) => s.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
function bagF1(a: string[], b: string[]) {
  const bag = new Map<string, number>();
  for (const t of b) bag.set(t, (bag.get(t) || 0) + 1);
  let hit = 0;
  for (const t of a) { const n = bag.get(t) || 0; if (n > 0) { hit++; bag.set(t, n - 1); } }
  const p = a.length ? hit / a.length : 0, r = b.length ? hit / b.length : 0;
  return { f1: p + r ? (2 * p * r) / (p + r) : 0, precision: p, recall: r };
}
/** Kendall-style order score on matched tokens (capped for O(n²) safety). */
function orderScore(out: string[], gold: string[]) {
  const pos = new Map<string, number[]>();
  gold.forEach((t, i) => { (pos.get(t) || pos.set(t, []).get(t)!).push(i); });
  const seq: number[] = [];
  for (const t of out) { const q = pos.get(t); if (q?.length) seq.push(q.shift()!); }
  const s = seq.slice(0, 2000);
  let inv = 0;
  for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) if (s[i] > s[j]) inv++;
  const n = s.length;
  return n < 2 ? 1 : 1 - inv / ((n * (n - 1)) / 2);
}

async function main() {
  const update = process.argv.includes('--update-baseline');
  const tierFilter = process.argv.find(a => a.startsWith('--tier='))?.split('=')[1];
  const manifestPath = join(ROOT, 'corpus', 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.log('No manifest found.');
    return;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const rawCases = manifest.cases || manifest.documents || [];
  const cases = rawCases
    .map((c: any) => ({
      id: c.id,
      tier: c.tier,
      pdf: c.pdf || c.path,
      gold: c.gold || c.path?.replace(/\.pdf$/i, '.docx'),
    }))
    .filter((c: any) => !tierFilter || c.tier === tierFilter)
    .filter((c: any) => existsSync(join(ROOT, c.pdf)) && existsSync(join(ROOT, c.gold)));

  if (!cases.length) {
    console.log('No runnable gold test cases found in corpus/manifest.json.');
    return;
  }

  mkdirSync(OUT, { recursive: true });
  const results: any[] = [];
  for (const c of cases) {
    const t0 = Date.now();
    const pdf = new Uint8Array(readFileSync(join(ROOT, c.pdf)));
    const ir = await loadPdfDocument(pdf);
    const { docx } = await convertDocumentIRToDocx(ir, { title: basename(c.pdf, '.pdf') });
    ir.binaryStore.clear();
    const got = docxParts(docx);
    const gold = docxParts(new Uint8Array(readFileSync(join(ROOT, c.gold))));
    const gate = verifyDocxEntries(got.entries);
    const text = bagF1(toks(got.text), toks(gold.text));
    const cells = bagF1(got.tables.flatMap(t => t.cells), gold.tables.flatMap(t => t.cells));
    const md = (got.text.match(/\|\s*:?-{3,}/g) || []).length + (got.text.match(/<\/?(td|tr|table)\b/gi) || []).length;
    results.push({
      id: c.id, tier: c.tier,
      textF1: +text.f1.toFixed(4), cellF1: +cells.f1.toFixed(4),
      order: +orderScore(toks(got.text), toks(gold.text)).toFixed(4),
      tables: got.tables.length, goldTables: gold.tables.length,
      textboxes: got.textboxes, markdownTokens: md,
      gateOk: gate.ok, gateViolations: gate.violations.map((v: any) => v.code),
      ms: Date.now() - t0, peakRssMB: +(process.memoryUsage().rss / 1048576).toFixed(1),
    });
    writeFileSync(join(OUT, `${c.id}.docx`), docx);
    console.log(`${c.id.padEnd(28)} text=${text.f1.toFixed(3)} cells=${cells.f1.toFixed(3)} order=${results.at(-1).order} tbl=${got.tables.length}/${gold.tables.length} gate=${gate.ok ? 'OK' : gate.violations.map((v: any) => v.code).join(',')}`);
  }
  const agg = (k: string) => results.length ? +(results.reduce((a, r) => a + r[k], 0) / results.length).toFixed(4) : 0;
  const summary = { textF1: agg('textF1'), cellF1: agg('cellF1'), order: agg('order'),
    gateFailures: results.filter(r => !r.gateOk).length,
    textboxTotal: results.reduce((a, r) => a + r.textboxes, 0),
    markdownTotal: results.reduce((a, r) => a + r.markdownTokens, 0), cases: results.length };
  writeFileSync(join(OUT, 'latest.json'), JSON.stringify({ summary, results }, null, 2));

  const basePath = join(ROOT, 'metrics', 'baseline.json');
  if (update || !existsSync(basePath)) {
    writeFileSync(basePath, JSON.stringify({ summary, results }, null, 2));
    console.log('\nBaseline written.'); return;
  }
  const base = JSON.parse(readFileSync(basePath, 'utf8'));
  const TOL = 0.005;
  const regressions: string[] = [];
  for (const k of ['textF1', 'cellF1', 'order']) if (summary[k] < base.summary[k] - TOL) regressions.push(`${k}: ${base.summary[k]} → ${summary[k]}`);
  if (summary.gateFailures > base.summary.gateFailures) regressions.push(`gateFailures: ${base.summary.gateFailures} → ${summary.gateFailures}`);
  if (summary.textboxTotal > 0) regressions.push(`floating textboxes: ${summary.textboxTotal}`);
  if (summary.markdownTotal > 0) regressions.push(`markdown tokens: ${summary.markdownTotal}`);
  console.log('\n' + JSON.stringify(summary, null, 2));
  if (regressions.length) { console.error('\nREGRESSION:\n' + regressions.join('\n')); process.exit(1); }
  console.log('\nNo regressions.');
}
main().catch(e => { console.error(e); process.exit(1); });
