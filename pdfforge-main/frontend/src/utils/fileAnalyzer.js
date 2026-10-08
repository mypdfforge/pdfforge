/**
 * fileAnalyzer.js — Client-side smart file analysis
 * Analyzes a PDF and returns suggestions. Zero server calls.
 * Uses pdf.js (already loaded in index.html) + pdf-lib.
 */

/**
 * Analyze a PDF file and return suggestions.
 * @param {File} file
 * @returns {Promise<{ suggestions, metadata }>}
 */
export async function analyzeFile(file) {
  const meta = {
    name:      file.name,
    size:      file.size,
    sizeLabel: fmtSize(file.size),
    pageCount: null,
    hasText:   null,
    isScanned: null,
    isResume:  null,
    isInvoice: null,
    isMultiFile: false,
  }

  const suggestions = []

  // ── 1. Basic size checks ─────────────────────────────────────────
  if (file.size > 5 * 1024 * 1024) {
    suggestions.push({
      id:      'compress',
      icon:    '⬡',
      title:   'Compress this PDF',
      reason:  `File is ${fmtSize(file.size)} — compress to reduce size`,
      color:   '#f5a623',
      priority: 80,
    })
  }

  // ── 2. Read text content with pdf.js ────────────────────────────
  try {
    const pdfjs = window.pdfjsLib
    if (pdfjs) {
      if (!pdfjs.GlobalWorkerOptions.workerSrc) {
        pdfjs.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
      }
      const buf    = await file.arrayBuffer()
      const pdfDoc = await pdfjs.getDocument({ data: buf }).promise
      meta.pageCount = pdfDoc.numPages

      // Extract text from first 3 pages
      let allText = ''
      const pagesToScan = Math.min(3, pdfDoc.numPages)
      let totalChars = 0

      for (let p = 1; p <= pagesToScan; p++) {
        const page    = await pdfDoc.getPage(p)
        const content = await page.getTextContent()
        const text    = content.items.map(i => i.str).join(' ')
        allText      += text + ' '
        totalChars   += text.length
      }

      await pdfDoc.destroy()

      const avgCharsPerPage = totalChars / pagesToScan
      meta.hasText  = avgCharsPerPage > 50
      meta.isScanned = avgCharsPerPage < 30

      const lowerText = allText.toLowerCase()

      // Detect resume
      const resumeKeywords = ['experience', 'education', 'skills', 'resume', 'cv',
        'work history', 'objective', 'summary', 'employment', 'bachelor', 'master',
        'university', 'linkedin', 'references']
      const resumeHits = resumeKeywords.filter(k => lowerText.includes(k)).length
      meta.isResume = resumeHits >= 3

      // Detect invoice / bank statement
      const invoiceKeywords = ['invoice', 'total', 'subtotal', 'amount due', 'tax',
        'payment', 'bill to', 'quantity', 'price', 'statement', 'balance', 'transaction']
      const invoiceHits = invoiceKeywords.filter(k => lowerText.includes(k)).length
      meta.isInvoice = invoiceHits >= 3

      // ── Build suggestions based on analysis ──────────────────────

      if (meta.isScanned) {
        suggestions.push({
          id:      'ocr',
          icon:    '⌕',
          title:   'Make this PDF searchable',
          reason:  'Scanned document detected — run OCR to extract text',
          color:   '#f5a623',
          priority: 95,
        })
      }

      if (meta.isResume) {
        suggestions.push({
          id:      'editor',
          icon:    '✦',
          title:   'Open in Resume Editor',
          reason:  'Resume detected — edit text, fix formatting, improve with AI',
          color:   '#6c63ff',
          priority: 90,
        })
        suggestions.push({
          id:      'workflow-resume',
          icon:    '🎯',
          title:   'Make Resume ATS Ready',
          reason:  'Optimize keywords & formatting for applicant tracking systems',
          color:   '#e879f9',
          priority: 85,
          isWorkflow: true,
        })
      }

      if (meta.isInvoice) {
        suggestions.push({
          id:      'ai-chat',
          icon:    '🤖',
          title:   'Ask AI about this document',
          reason:  'Invoice/statement detected — extract totals, summarize',
          color:   '#9d97ff',
          priority: 88,
        })
      }

      if (meta.pageCount > 10) {
        suggestions.push({
          id:      'organize',
          icon:    '⊞',
          title:   'Organize pages',
          reason:  `${meta.pageCount}-page document — reorder or split pages`,
          color:   '#3ecf8e',
          priority: 70,
        })
      }

      if (!meta.isScanned && meta.hasText) {
        suggestions.push({
          id:      'ai-chat',
          icon:    '🤖',
          title:   'Chat with this document',
          reason:  'Ask questions, get summaries, extract key info',
          color:   '#9d97ff',
          priority: 75,
        })
      }
    }
  } catch (e) {
    console.warn('analyzeFile error:', e)
  }

  // ── 3. Multi-file hint ────────────────────────────────────────────
  // (caller passes multiple files — handled externally)

  // Sort by priority desc
  suggestions.sort((a, b) => b.priority - a.priority)

  return { suggestions: suggestions.slice(0, 4), metadata: meta }
}

export function analyzeMultipleFiles(files) {
  if (files.length < 2) return null
  return {
    id:      'merge',
    icon:    '⊕',
    title:   `Merge ${files.length} PDFs`,
    reason:  `${files.length} files selected — combine into one document`,
    color:   '#3ecf8e',
    isMultiFile: true,
  }
}

function fmtSize(b) {
  if (b < 1024)       return `${b} B`
  if (b < 1024*1024)  return `${(b/1024).toFixed(0)} KB`
  return `${(b/1024/1024).toFixed(1)} MB`
}
