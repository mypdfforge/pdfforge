import { describe, it, expect } from 'vitest'
import {
  detectAdmonition,
  detectCheckbox,
  detectCodeBlock,
  segmentIntoColumns,
} from '../../src/utils/pdfLayoutSegmenter.js'

describe('Structural Elements & Admonitions', () => {
  describe('detectAdmonition', () => {
    it('detects [NOTE] with blue border and light blue background', () => {
      const res = detectAdmonition('[NOTE] This is an important system note.')
      expect(res).not.toBeNull()
      expect(res.type).toBe('note')
      expect(res.color).toBe('3B82F6')
      expect(res.bg).toBe('EFF6FF')
    })

    it('detects [WARNING] with amber border and light amber background', () => {
      const res = detectAdmonition('[WARNING] Changes cannot be undone.')
      expect(res).not.toBeNull()
      expect(res.type).toBe('warning')
      expect(res.color).toBe('F59E0B')
      expect(res.bg).toBe('FFFBEB')
    })

    it('detects [CRITICAL] with red border and light red background', () => {
      const res = detectAdmonition('[CRITICAL] Security vulnerability discovered.')
      expect(res).not.toBeNull()
      expect(res.type).toBe('critical')
      expect(res.color).toBe('EF4444')
      expect(res.bg).toBe('FEF2F2')
    })

    it('returns null for standard paragraphs', () => {
      const res = detectAdmonition('Regular paragraph text without callout headers.')
      expect(res).toBeNull()
    })
  })

  describe('detectCheckbox', () => {
    it('detects unchecked checkbox [ ]', () => {
      const res = detectCheckbox('[ ] Review document contents before sending')
      expect(res).not.toBeNull()
      expect(res.checked).toBe(false)
      expect(res.symbol).toBe('☐')
      expect(res.label).toBe('Review document contents before sending')
    })

    it('detects checked checkbox [x]', () => {
      const res = detectCheckbox('[x] All acceptance criteria validated')
      expect(res).not.toBeNull()
      expect(res.checked).toBe(true)
      expect(res.symbol).toBe('☑')
      expect(res.label).toBe('All acceptance criteria validated')
    })

    it('detects unicode checkmarks ☑ and ☐', () => {
      const checked = detectCheckbox('☑ Verified in browser memory')
      expect(checked.checked).toBe(true)
      const unchecked = detectCheckbox('☐ Pending server approval')
      expect(unchecked.checked).toBe(false)
    })
  })

  describe('detectCodeBlock', () => {
    it('detects code by monospaced font name', () => {
      const line = {
        text: 'const x = 42;',
        items: [{ fontName: 'CourierNewPSMT', str: 'const x = 42;' }],
      }
      expect(detectCodeBlock(line)).toBe(true)
    })

    it('detects code by programming syntax keywords', () => {
      const line = {
        text: 'import { Document } from "docx";',
        items: [{ fontName: 'Arial', str: 'import { Document } from "docx";' }],
      }
      expect(detectCodeBlock(line)).toBe(true)
    })

    it('returns false for ordinary text', () => {
      const line = {
        text: 'This is standard plain English text explaining a project.',
        items: [{ fontName: 'Arial', str: 'This is standard plain English text explaining a project.' }],
      }
      expect(detectCodeBlock(line)).toBe(false)
    })
  })
})
