import { describe, it, expect } from 'vitest'
import {
  detectLanguageAndDir,
  segmentIntoColumns,
} from '../../src/utils/pdfLayoutSegmenter.js'

describe('Bi-Directional Unicode & Script Detection', () => {
  describe('detectLanguageAndDir', () => {
    it('detects Arabic text and returns isRTL: true', () => {
      const arabicSample = 'مرحبا بكم في اختبار معالجة المستندات'
      const result = detectLanguageAndDir(arabicSample)
      expect(result.isRTL).toBe(true)
      expect(result.script).toBe('arabic')
    })

    it('detects Hebrew text and returns isRTL: true', () => {
      const hebrewSample = 'שלום עולם בדיקת המרה'
      const result = detectLanguageAndDir(hebrewSample)
      expect(result.isRTL).toBe(true)
      expect(result.script).toBe('hebrew')
    })

    it('detects Devanagari text and returns devanagari script', () => {
      const devanagariSample = 'नमस्ते दुनिया यह एक परीक्षण है'
      const result = detectLanguageAndDir(devanagariSample)
      expect(result.isRTL).toBe(false)
      expect(result.script).toBe('devanagari')
    })

    it('detects CJK characters and returns cjk script', () => {
      const cjkSample = 'PDF轉換測試與中文排版'
      const result = detectLanguageAndDir(cjkSample)
      expect(result.isRTL).toBe(false)
      expect(result.script).toBe('cjk')
    })

    it('defaults to latin for standard English text', () => {
      const latinSample = 'High-fidelity document reconstruction in browser memory'
      const result = detectLanguageAndDir(latinSample)
      expect(result.isRTL).toBe(false)
      expect(result.script).toBe('latin')
    })
  })

  describe('segmentIntoColumns with RTL items', () => {
    it('propagates isRTL and script to output line and spans', () => {
      const items = [
        { str: 'مرحبا', x: 200, y: 700, w: 50, size: 12, isBold: false, isItalic: false },
        { str: 'بالعالم', x: 140, y: 700, w: 50, size: 12, isBold: false, isItalic: false },
      ]
      const lines = segmentIntoColumns(items, 600)
      expect(lines.length).toBe(1)
      expect(lines[0].isRTL).toBe(true)
      expect(lines[0].script).toBe('arabic')
      expect(lines[0].spans[0].isRTL).toBe(true)
    })
  })
})
