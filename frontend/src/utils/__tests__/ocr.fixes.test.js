import { describe, it, expect } from 'vitest'
import {
  scriptsInText, detectScript, visualToLogicalRtl, classifyTokenType, repairCodeSyntax,
  fixFieldConfusables, looksLikeCodeLine, decodeWithCtcMultiChar,
} from '../ocrPostProcess.js'
import { reconstructPageLayout, validateCodeBrackets } from '../ocrLayoutAnalysis.js'
import { parseBodyBlocks, segmentTextByFont, silhouetteIoU, scriptFit, PACK_SCRIPTS, packForLanguage } from '../paddleOcr.js'

const L = (text, x, y, w, h = 14, extra = {}) => ({
  text, source: 'ocr', mean: 0.97, ...extra,
  box: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]],
})

describe('1 unicode scripts', () => {
  it('fine-grained script inventory covers Indic, Thai, Kana, Hangul', () => {
    expect([...scriptsInText('ಕನ್ನಡ தமிழ் తెలుగు മലയാളം')].sort()).toEqual(['kannada', 'malayalam', 'tamil', 'telugu'])
    expect(scriptsInText('こんにちは 漢字 한국어').has('kana')).toBe(true)
    expect(scriptsInText('こんにちは 漢字 한국어').has('hangul')).toBe(true)
    expect(detectScript('தமிழ்')).toBe('tamil')
    expect(detectScript('ไทย')).toBe('thai')
    expect(detectScript('こんにちは')).toBe('cjk')
  })
  it('RTL visual order -> logical, numbers and latin keep order, brackets mirror', () => {
    // logical "שלום עולם" printed left-to-right as drawn is "םלוע םולש"
    expect(visualToLogicalRtl('םלוע םולש')).toBe('שלום עולם')
    expect(visualToLogicalRtl('2024 םלוע')).toBe('עולם 2024')
    expect(visualToLogicalRtl('(בא)')).toBe('(אב)')
  })
  it('scriptFit rejects Latin gibberish for a Cyrillic pack and accepts Cyrillic', () => {
    expect(scriptFit('Pnumep Mnp', PACK_SCRIPTS.cyrillic)).toBeLessThan(0.1)
    expect(scriptFit('Привет мир', PACK_SCRIPTS.cyrillic)).toBe(1)
    expect(packForLanguage('tam')).toBe('tamil')
  })
  it('font segmentation reports unmapped chars instead of silently losing them', () => {
    const fonts = [{ key: 'a', set: new Set([97]) }]
    const r = segmentTextByFont(fonts, 'aก')
    expect(r.skipped).toBe(1)
    expect(r.unmapped).toEqual(['ก'])
  })
})

describe('2 code', () => {
  it('no identifier spell-correction inside code, syntax repair still works', () => {
    const src = 'def retum_value(maqic):\n    return maqic'
    expect(repairCodeSyntax(src)).toBe(src)
    expect(repairCodeSyntax('x = f"{name)"')).toContain('{name}')
  })
  it('code-shaped lines never get prose confusable fixes', () => {
    expect(looksLikeCodeLine('a = 0.05;')).toBe(true)
    expect(fixFieldConfusables('x = a == 0.05;')).toBe('x = a == 0.05;')
    expect(fixFieldConfusables('Significance (a = 0.05)')).toBe('Significance (α = 0.05)')
  })
  it('code is detected before tables: mono 2-col code is not tabled, indentation preserved', () => {
    const lines = [
      L('def f(x):', 50, 200, 63, 14, { isMono: true }),
      L('x = 1', 78, 218, 35, 14, { isMono: true }),
      L('# note', 200, 218, 42, 14, { isMono: true }),
      L('return x', 78, 236, 56, 14, { isMono: true }),
    ]
    const r = reconstructPageLayout(lines, 600, 800)
    expect(r.tables).toHaveLength(0)
    expect(r.codeBlocks).toHaveLength(1)
    expect(r.fullText).toContain('```')
  })
  it('validateCodeBrackets exposes unclosed openers for closer recovery', () => {
    const v = validateCodeBrackets('foo({\n  a: [1, 2]\n')
    expect(v.balanced).toBe(false)
    expect(v.unclosed).toEqual(['(', '{'])
  })
})

describe('3 protected tokens', () => {
  it('classifies API keys and keeps them verbatim through the CTC decoder', () => {
    expect(classifyTokenType(('key: ' + ['sk', 'live', '000000000000000000000000'].join('_')))).toBe('apikey')
    expect(classifyTokenType(['ghp', '000000000000000000000000000000000000'].join('_'))).toBe('apikey')
    const k = ['sk', 'live', '000000000000000000000000'].join('_')
    const m = Array.from(k).map(ch => [{ t: ch, mean: 0.99 }])
    expect(decodeWithCtcMultiChar(m, 'apikey')).toBe(k)
    expect(fixFieldConfusables(`token ${k}`)).toBe(`token ${k}`)
  })
})

describe('5 semantics: tables / rowspan / docx blocks', () => {
  it('detects rowspan for grouped first column', () => {
    const ls = [
      L('Group', 50, 100, 50), L('Item', 200, 100, 40), L('Qty', 350, 100, 30),
      L('Fruit', 50, 130, 40), L('Apple', 200, 130, 40), L('3', 350, 130, 10),
      L('Banana', 200, 160, 50), L('5', 350, 160, 10),
      L('Veg', 50, 190, 30), L('Leek', 200, 190, 35), L('2', 350, 190, 10),
    ]
    const r = reconstructPageLayout(ls, 600, 800)
    expect(r.tables).toHaveLength(1)
    const fruit = r.tables[0].rows.flat().find(c => c.text === 'Fruit')
    expect(fruit.rowspan).toBe(2)
    expect(r.tables[0].html).toContain('rowspan="2"')
  })
  it('docx block parser: prose after code and after a table is NOT swallowed', () => {
    const body = ['Intro', '```', 'a = 1', '    b = 2', '```', 'after code', '', '| a | b |', '| --- | --- |', '| 1 | 2 |', '', 'after table'].join('\n')
    const b = parseBodyBlocks(body)
    const code = b.find(x => x.type === 'code')
    expect(code.lines).toEqual(['a = 1', '    b = 2'])
    expect(b.filter(x => x.type === 'table')).toHaveLength(1)
    const paras = b.filter(x => x.type === 'para').map(x => x.line)
    expect(paras).toContain('after code')
    expect(paras).toContain('after table')
  })
})

describe('4 symbols', () => {
  it('silhouette IoU is 1 for identical masks and 0 for disjoint', () => {
    const a = new Uint8Array([1, 1, 0, 0]); const b = new Uint8Array([0, 0, 1, 1])
    expect(silhouetteIoU(a, a)).toBe(1)
    expect(silhouetteIoU(a, b)).toBe(0)
  })
})

import {
  solveBase64UrlJson, repairProtectedString, repairBase64Run, isLikelyGibberish, quarantineGibberish,
  toChemSubscripts, normalizePunctuation, UNREADABLE_TEXT,
} from '../ocrPostProcess.js'
import { evaluateQualityGates } from '../paddleOcr.js'

const JWT_BAD = 'eyJhbGciOiJIUz11NilslnR5cCI6IkpXVCJ9.eyJzdWliOilxMjMONTY3ODkwliwibmFtZSI6IkpvaG4gRG9IliwiaWF0ljoxNTE2MjM5MDlyfQ'
const JWT_OK = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ'

describe('long strings (QA pdf page 12)', () => {
  it('JWT header+payload solved from JSON structure, length and other chars untouched', () => {
    expect(repairProtectedString(JWT_BAD)).toBe(JWT_OK)
    expect(solveBase64UrlJson('eyJhbGciOiJIUz11NilslnR5cCI6IkpXVCJ9', { kind: 'header' }).changes).toBe(3)
  })
  it('URL with _Iz4 and wrapped token repaired as one string', () => {
    const u = 'https://x.internal.corp/download?export_mode=streaming_compressed_Iz4&token=' + JWT_BAD
    expect(repairProtectedString(u)).toBe(u.replace('_Iz4', '_lz4').replace(JWT_BAD, JWT_OK))
  })
  it('known ASN.1 header misreads fixed, nothing else changes', () => {
    const r = repairBase64Run('MIIBljANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3f721N9yX0vH2rS8G3mN6L8wP1qR4tY7ul9oK0jM2nB4vC6xZ')
    expect(r.startsWith('MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3f721N9yX0vH2rS8')).toBe(true)
  })
  it('layout: wrapped token lines repaired and written back to the line objects', () => {
    const half = Math.floor(JWT_BAD.length / 2)
    const ls = [L(JWT_BAD.slice(0, half), 50, 300, 400, 12), L(JWT_BAD.slice(half), 50, 316, 400, 12)]
    const r = reconstructPageLayout(ls, 600, 800)
    expect(r.allLines.map(l => l.text).join('')).toBe(JWT_OK)
  })
})

describe('gibberish gate (QA pdf page 9)', () => {
  const junk = [
    'KOMNneKCHoe TeCTupOBaHMe KOHBepTepa AOkyMeHTOB',
    "D2271n D'⊃non 7U ony n7'T2 'nIT,n2721 D17U",
    '文書变换工>沙>①高精度夕>夕又卜又于又卜',
    'Hcd可uicR可dp 3Raaa Rpg可',
    '△oKIμń uunλńs akpíβeIas μETaTpoTTńs',
    'l≤ □Q o□ Y qCheck: √d00% Passed)',
  ]
  const legit = [
    'Distributed Tracing (OpenTelemetry OTLP/gRPC)', 'Relational Primary-Replica Engine (PostgreSQL 16)',
    'common NotoSansCJK.ttc', 'DDoS scrubbing nodes equipped with eBPF/XDP packet filters',
    'Vaswani, A., et al. NeurIPS.', 'Mean Delta (μs) Std Dev (σ) p-value (α=0.01)',
    'Δοκιμή υψηλής ακρίβειας μετατροπής εγγράφων', 'Комплексное тестирование конвертера документов',
    '高性能文档转换与版面分析自动化基准测试套件', 'Graceful Termination & SIGTERM Drain (30s)',
  ]
  it('flags Latin-looking junk, never real text', () => {
    for (const j of junk) expect(isLikelyGibberish(j)).toBe(true)
    expect(legit.filter(isLikelyGibberish)).toEqual([])
  })
  it('quarantine replaces text, keeps raw, drops from PDF layer, lands in review queue', () => {
    const ls = [{ ...L(junk[0], 50, 100, 300), box: [[50, 100], [350, 100], [350, 114], [50, 114]] }]
    quarantineGibberish(ls)
    expect(ls[0].text).toBe(UNREADABLE_TEXT)
    expect(ls[0].suppressLayer).toBe(true)
    const q = evaluateQualityGates([{ lines: [{ ...ls[0], flagged: true }], codeBlocks: [] }]).reviewQueue
    expect(q[0].reason).toBe('unreadable_or_unsupported_script_not_in_text_layer')
    expect(q[0].rawText).toBe(junk[0])
  })
})

describe('PDF layer == exported text (table + code write-back)', () => {
  it('table cell fixes reach the line objects', () => {
    const ls = [
      L('Trial', 50, 100, 40), L('Mean', 200, 100, 40), L('p-value', 350, 100, 40),
      L('Control Group AO', 50, 130, 110), L('412.82±1.2', 200, 130, 70), L('p<0.0001', 350, 130, 60),
      L('Group B1', 50, 160, 60), L('215.19±0.8', 200, 160, 70), L('p= 0.0032', 350, 160, 60),
      L('Capability', 50, 190, 60), L('XNO', 200, 190, 30), L('√ Included', 350, 190, 70),
    ]
    const r = reconstructPageLayout(ls, 600, 800)
    const txt = r.allLines.map(l => l.text)
    expect(txt).toContain('412.82 ± 1.2')
    expect(txt).toContain('p < 0.0001')
    expect(txt).toContain('p = 0.0032')
    expect(txt).toContain('✗ No')
    expect(txt).toContain('✓ Included')
  })
  it('code repairs reach the line objects; no identifier rewriting', () => {
    const ls = [
      L('raise Err(f"bad: {detected_format)")', 50, 200, 250, 14, { isMono: true }),
      L('return Result(', 50, 218, 100, 14, { isMono: true }),
      L('size=len(pdf_bytes).', 78, 236, 140, 14, { isMono: true }),
      L('pages=n', 78, 254, 60, 14, { isMono: true }),
    ]
    const r = reconstructPageLayout(ls, 600, 800)
    const txt = r.allLines.map(l => l.text)
    expect(txt).toContain('raise Err(f"bad: {detected_format}")')
    expect(txt).toContain('size=len(pdf_bytes),')
  })
  it('term | definition table is a table (glossary), not prose columns', () => {
    const ls = []
    const terms = ['Glyph Kerning', 'Deflate Stream', 'Bi-Directional Algorithm', 'Color Matrix Shading', 'Font Subset Embedding']
    terms.forEach((t, i) => {
      ls.push(L(t, 50, 100 + i * 50, 150, 16))
      ls.push(L('The process of adjusting spacing between pairs of letters to', 300, 102 + i * 50, 300))
      ls.push(L('achieve a visually balanced typographic result here', 300, 120 + i * 50, 280))
    })
    const r = reconstructPageLayout(ls, 700, 800)
    expect(r.tables).toHaveLength(1)
  })
})

describe('semantics small rules', () => {
  it('chemistry subscripts, exponent minus, spacing, timestamps, form controls', () => {
    expect(fixFieldConfusables('Formula: H2SO4 (Sulfuric Acid) and CO2')).toBe('Formula: H₂SO₄ (Sulfuric Acid) and CO₂')
    expect(toChemSubscripts('SRV-101 HTTP2 S3 SHA256 EVT-90001')).toBe('SRV-101 HTTP2 S3 SHA256 EVT-90001')
    expect(fixFieldConfusables('E = mc² + 2ⁿ-1')).toBe('E = mc² + 2ⁿ⁻¹')
    expect(fixFieldConfusables('Check: √d00% Passed')).toBe('Check: ✓ 100% Passed')
    expect(normalizePunctuation('2026-10-3114:15:00')).toBe('2026-10-31 14:15:00')
    expect(normalizePunctuation('() 1 - Poor')).toBe('( ) 1 - Poor')
    expect(normalizePunctuation('[] Did it?')).toBe('[ ] Did it?')
    expect(fixFieldConfusables('√2 + √(x)')).toBe('√2 + √(x)')
  })
})
