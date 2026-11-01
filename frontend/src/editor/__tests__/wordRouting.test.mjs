import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { quickModeBlockers, evaluatePreselection, hasCjkCharacters, inspectWordDocument } from '../../utils/wordInspection.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const fixturesDir = path.resolve(__dirname, '../../../fixtures/docx_samples')

test('quickModeBlockers identifies unit XML tags', () => {
  const xmlMerged = '<w:p><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr></w:tc></w:p>'
  assert.deepEqual(quickModeBlockers(xmlMerged, 1000), ['merged cells'])

  const xmlDrawing = '<w:p><w:drawing><wp:inline></wp:inline></w:drawing></w:p>'
  assert.deepEqual(quickModeBlockers(xmlDrawing, 1000), ['image/drawing'])

  const xmlCols = '<w:sectPr><w:cols w:num="3"/></w:sectPr>'
  assert.deepEqual(quickModeBlockers(xmlCols, 1000), ['columns'])

  const xmlBidi = '<w:p><w:pPr><w:bidi/></w:pPr></w:p>'
  assert.deepEqual(quickModeBlockers(xmlBidi, 1000), ['right-to-left'])

  assert.deepEqual(quickModeBlockers('<w:document/>', 6 * 1024 * 1024), ['large file (>5MB)'])
})

test('evaluatePreselection decision matrix', () => {
  // Simple doc -> Quick mode
  const r1 = evaluatePreselection({ blockers: [], isEngineCached: false, crossOriginIsolated: true })
  assert.equal(r1.recommendedMode, 'quick')

  // Blockers present on desktop -> Accurate mode
  const r2 = evaluatePreselection({ blockers: ['merged cells'], isEngineCached: false, crossOriginIsolated: true })
  assert.equal(r2.recommendedMode, 'accurate')
  assert.match(r2.reason, /merged cells/)

  // CrossOriginIsolated false -> Quick mode
  const r3 = evaluatePreselection({ blockers: ['merged cells'], isEngineCached: true, crossOriginIsolated: false })
  assert.equal(r3.recommendedMode, 'quick')
  assert.match(r3.reason, /unavailable/i)
})

test('Fixture test: simple_resume.docx routes to Quick mode', async () => {
  const fileBuf = fs.readFileSync(path.join(fixturesDir, 'simple_resume.docx'))
  const zip = await JSZip.loadAsync(fileBuf)
  const xml = await zip.file('word/document.xml').async('string')
  const blockers = quickModeBlockers(xml, fileBuf.length)
  assert.deepEqual(blockers, [], 'Simple resume should have zero blockers')

  const decision = evaluatePreselection({ blockers, isEngineCached: false, crossOriginIsolated: true })
  assert.equal(decision.recommendedMode, 'quick')
})

test('Fixture test: sample_merged_cells.docx routes to Accurate mode', async () => {
  const fileBuf = fs.readFileSync(path.join(fixturesDir, 'sample_merged_cells.docx'))
  const zip = await JSZip.loadAsync(fileBuf)
  const xml = await zip.file('word/document.xml').async('string')
  const blockers = quickModeBlockers(xml, fileBuf.length)
  assert.ok(blockers.includes('merged cells'))

  const decision = evaluatePreselection({ blockers, isEngineCached: false, crossOriginIsolated: true })
  assert.equal(decision.recommendedMode, 'accurate')
})

test('Fixture test: sample_columns.docx routes to Accurate mode', async () => {
  const fileBuf = fs.readFileSync(path.join(fixturesDir, 'sample_columns.docx'))
  const zip = await JSZip.loadAsync(fileBuf)
  const xml = await zip.file('word/document.xml').async('string')
  const blockers = quickModeBlockers(xml, fileBuf.length)
  assert.ok(blockers.includes('columns'))

  const decision = evaluatePreselection({ blockers, isEngineCached: false, crossOriginIsolated: true })
  assert.equal(decision.recommendedMode, 'accurate')
})

test('Fixture test: sample_rtl.docx routes to Accurate mode', async () => {
  const fileBuf = fs.readFileSync(path.join(fixturesDir, 'sample_rtl.docx'))
  const zip = await JSZip.loadAsync(fileBuf)
  const xml = await zip.file('word/document.xml').async('string')
  const blockers = quickModeBlockers(xml, fileBuf.length)
  assert.ok(blockers.includes('right-to-left'))

  const decision = evaluatePreselection({ blockers, isEngineCached: false, crossOriginIsolated: true })
  assert.equal(decision.recommendedMode, 'accurate')
})

test('Fixture test: sample_nested_table.docx routes to Accurate mode', async () => {
  const fileBuf = fs.readFileSync(path.join(fixturesDir, 'sample_nested_table.docx'))
  const zip = await JSZip.loadAsync(fileBuf)
  const xml = await zip.file('word/document.xml').async('string')
  const blockers = quickModeBlockers(xml, fileBuf.length)
  assert.ok(blockers.includes('nested table'))

  const decision = evaluatePreselection({ blockers, isEngineCached: false, crossOriginIsolated: true })
  assert.equal(decision.recommendedMode, 'accurate')
})

test('hasCjkCharacters accurately detects CJK codepoints and ignores other alphabets', () => {
  // Latin / Greek / Cyrillic / Arabic / Hebrew should be false
  assert.equal(hasCjkCharacters('Hello world!'), false)
  assert.equal(hasCjkCharacters('Γειά σου Κόσμε'), false) // Greek
  assert.equal(hasCjkCharacters('Привет мир'), false)     // Russian
  assert.equal(hasCjkCharacters('مرحبا بالعالم'), false)  // Arabic
  assert.equal(hasCjkCharacters('שלום עולם'), false)      // Hebrew

  // Chinese, Japanese (Hiragana/Katakana/Kanji), Korean should be true
  assert.equal(hasCjkCharacters('你好，世界'), true)          // Simplified Chinese
  assert.equal(hasCjkCharacters('こんにちは'), true)          // Japanese Hiragana
  assert.equal(hasCjkCharacters('カタカナ'), true)            // Japanese Katakana
  assert.equal(hasCjkCharacters('日本語'), true)              // Japanese Kanji
  assert.equal(hasCjkCharacters('안녕하세요'), true)          // Korean Hangul
})

test('Fixture test: complex_fonts.docx detects CJK characters', async () => {
  const fileBuf = fs.readFileSync(path.join(fixturesDir, 'complex_fonts.docx'))
  const mockFile = {
    arrayBuffer: async () => fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset + fileBuf.byteLength),
    size: fileBuf.length,
  }
  const result = await inspectWordDocument(mockFile, JSZip)
  assert.equal(result.hasCjk, true, 'complex_fonts.docx must trigger CJK detection')
})

test('Fixture test: simple_resume.docx does NOT trigger CJK detection', async () => {
  const fileBuf = fs.readFileSync(path.join(fixturesDir, 'simple_resume.docx'))
  const mockFile = {
    arrayBuffer: async () => fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset + fileBuf.byteLength),
    size: fileBuf.length,
  }
  const result = await inspectWordDocument(mockFile, JSZip)
  assert.equal(result.hasCjk, false, 'simple_resume.docx must not trigger CJK detection')
})
