/**
 * wordInspection.js - Fast OOXML document inspection & mode routing
 *
 * Scans only word/document.xml (zero layout calculations) to detect complex
 * features that cannot be rendered with high fidelity by the lightweight OOXML engine.
 */

export const QUICK_MODE_CHECKS = {
  'merged cells':     /<w:(gridSpan|vMerge)\b/,
  'image/drawing':    /<w:drawing|<w:pict/,
  'text box/shape':   /<wps:|<v:textbox|<w:txbxContent/,
  'columns':          /<w:cols [^>]*w:num="[2-9]/,
  'footnote/endnote': /<w:(footnote|endnote)Reference/,
  'fields/TOC':       /<w:fldChar|<w:fldSimple|<w:instrText/,
  'tracked changes':  /<w:(ins|del) /,
  'right-to-left':    /<w:bidi|<w:rtl/,
  'nested table':     /<w:tc>(?:(?!<\/w:tc>).)*<w:tbl>/s,
}

export function quickModeBlockers(xml, sizeBytes) {
  const out = Object.keys(QUICK_MODE_CHECKS).filter(k => QUICK_MODE_CHECKS[k].test(xml))
  if (sizeBytes > 5 * 1024 * 1024) {
    out.push('large file (>5MB)')
  }
  return out
}

/**
 * CJK Unicode ranges:
 * U+3040–30FF: Hiragana & Katakana
 * U+3400–4DBF: CJK Unified Ideographs Extension A
 * U+4E00–9FFF: CJK Unified Ideographs (Common & Simplified/Traditional)
 * U+AC00–D7AF: Hangul Syllables
 * U+FF00–FFEF: Halfwidth and Fullwidth Forms
 */
export const CJK_REGEX = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF]/

export function hasCjkCharacters(xml) {
  return typeof xml === 'string' && CJK_REGEX.test(xml)
}

/**
 * Fast inspection of DOCX file by reading only word/document.xml
 * @param {File|Blob} file
 * @param {any} JSZipInstance
 * @returns {Promise<{ blockers: string[], hasBlockers: boolean, hasCjk: boolean, xmlLength: number }>}
 */
export async function inspectWordDocument(file, JSZipInstance) {
  try {
    const arrayBuffer = await file.arrayBuffer()
    const zip = await JSZipInstance.loadAsync(arrayBuffer)
    const docXmlFile = zip.file('word/document.xml')
    if (!docXmlFile) {
      return { blockers: [], hasBlockers: false, hasCjk: false, xmlLength: 0 }
    }
    const xml = await docXmlFile.async('string')
    const blockers = quickModeBlockers(xml, file.size)
    const hasCjk = hasCjkCharacters(xml)
    return {
      blockers,
      hasBlockers: blockers.length > 0,
      hasCjk,
      xmlLength: xml.length,
    }
  } catch (err) {
    console.warn('[wordInspection] Could not parse document.xml, defaulting to empty blockers:', err)
    return { blockers: [], hasBlockers: false, hasCjk: false, xmlLength: 0 }
  }
}

/**
 * Evaluates default mode routing based on document features & device capabilities.
 * @param {object} params
 * @param {string[]} params.blockers
 * @param {boolean} params.isEngineCached
 * @param {boolean} params.crossOriginIsolated
 * @returns {{ recommendedMode: 'quick' | 'accurate', reason: string, isMobileOrLowRam: boolean }}
 */
export function evaluatePreselection({ blockers = [], isEngineCached = false, crossOriginIsolated = true }) {
  // If browser security environment doesn't support SharedArrayBuffer, Accurate is unavailable
  if (!crossOriginIsolated) {
    return {
      recommendedMode: 'quick',
      reason: 'Accurate engine is unavailable (browser environment not isolated). Quick mode selected.',
      isMobileOrLowRam: false,
    }
  }

  // Device check: Mobile or low memory (< 4GB RAM)
  const isMobile = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || '')
  const lowRam = typeof navigator !== 'undefined' && navigator.deviceMemory && navigator.deviceMemory < 4
  const isMobileOrLowRam = isMobile || !!lowRam

  if (isMobileOrLowRam) {
    return {
      recommendedMode: 'quick',
      reason: 'Quick mode preselected (mobile or device memory < 4GB). You can still switch to Accurate.',
      isMobileOrLowRam: true,
    }
  }

  if (blockers.length > 0) {
    return {
      recommendedMode: 'accurate',
      reason: `This file has: ${blockers.join(', ')}. Accurate recommended.`,
      isMobileOrLowRam: false,
    }
  }

  if (isEngineCached) {
    return {
      recommendedMode: 'accurate',
      reason: 'Accurate engine is already cached on your device. Selected for best fidelity.',
      isMobileOrLowRam: false,
    }
  }

  return {
    recommendedMode: 'quick',
    reason: 'Simple document detected. Quick mode selected for instant conversion.',
    isMobileOrLowRam: false,
  }
}
