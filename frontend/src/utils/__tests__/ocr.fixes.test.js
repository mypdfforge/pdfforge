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
    const k = ['sk', 'live', '000000000000000000000000'].join('_')
    const g = ['ghp', '000000000000000000000000000000000000'].join('_')
    expect(classifyTokenType(`key: ${k}`)).toBe('apikey')
    expect(classifyTokenType(g)).toBe('apikey')
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
