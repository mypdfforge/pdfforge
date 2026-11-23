/**
 * ocrLayoutAnalysis.js
 * Advanced Document Layout Analysis (DLA) & Spatial Reconstruction for in-browser OCR.
 *
 * Implements:
 * 1. Header/Footer Zone Masking (isolates running headers & footers from body text).
 * 2. Multi-Column XY-Cut Segmentation (sequences reading flow down columns before crossing gutters).
 * 3. Indentation & Monospace Pitch Preservation (retains code block & outline indentation).
 */

/**
 * Calculates geometric metrics for raw PaddleOCR lines.
 */
export function enrichLineGeometry(rawLines, canvasWidth, canvasHeight) {
  return rawLines.map((line, index) => {
    const box = line.box || []
    const xs = box.map(pt => pt[0])
    const ys = box.map(pt => pt[1])

    const xMin = xs.length ? Math.min(...xs) : 0
    const xMax = xs.length ? Math.max(...xs) : 0
    const yMin = ys.length ? Math.min(...ys) : 0
    const yMax = ys.length ? Math.max(...ys) : 0

    const width = xMax - xMin
    const height = yMax - yMin
    const xCenter = (xMin + xMax) / 2
    const yCenter = (yMin + yMax) / 2

    return {
      ...line,
      originalIndex: index,
      xMin,
      xMax,
      yMin,
      yMax,
      width,
      height,
      xCenter,
      yCenter,
    }
  })
}

/**
 * Segments lines into Header, Body, and Footer zones based on vertical margins.
 */
export function partitionPageZones(lines, canvasHeight) {
  const headerThreshold = canvasHeight * 0.085
  const footerThreshold = canvasHeight * 0.915

  const header = []
  const body = []
  const footer = []

  for (const line of lines) {
    if (line.yCenter < headerThreshold) {
      header.push({ ...line, zone: 'header' })
    } else if (line.yCenter > footerThreshold) {
      footer.push({ ...line, zone: 'footer' })
    } else {
      body.push({ ...line, zone: 'body' })
    }
  }

  // Header and footer sorted top-to-bottom
  header.sort((a, b) => a.yMin - b.yMin)
  footer.sort((a, b) => a.yMin - b.yMin)

  return { header, body, footer }
}

/**
 * Detects if a group of lines contains a vertical column gutter and splits them into distinct columns.
 */
function splitColumnarBand(bandLines, canvasWidth, charWidth) {
  if (bandLines.length < 2) return [bandLines]

  // Find candidate split X by scanning for a whitespace gutter
  const minX = Math.min(...bandLines.map(l => l.xMin))
  const maxX = Math.max(...bandLines.map(l => l.xMax))
  const bandWidth = maxX - minX

  // If the total width is too narrow, treat as single column
  if (bandWidth < canvasWidth * 0.35) return [bandLines]

  // Histogram of horizontal coverage across bandLines
  const step = 5
  const buckets = Math.ceil(canvasWidth / step)
  const occupancy = new Uint8Array(buckets)

  for (const l of bandLines) {
    const start = Math.max(0, Math.floor(l.xMin / step))
    const end = Math.min(buckets - 1, Math.ceil(l.xMax / step))
    for (let i = start; i <= end; i++) {
      occupancy[i]++
    }
  }

  // Look for a gap of zero occupancy in the middle region (between 25% and 75% of page width)
  const searchStart = Math.floor((canvasWidth * 0.25) / step)
  const searchEnd = Math.floor((canvasWidth * 0.75) / step)

  let bestGutterStart = -1
  let bestGutterLen = 0
  let currentStart = -1
  let currentLen = 0

  for (let i = searchStart; i <= searchEnd; i++) {
    if (occupancy[i] === 0) {
      if (currentStart === -1) currentStart = i
      currentLen++
      if (currentLen > bestGutterLen) {
        bestGutterLen = currentLen
        bestGutterStart = currentStart
      }
    } else {
      currentStart = -1
      currentLen = 0
    }
  }

  // Minimum gutter width in pixels (~15px)
  const minGutterPx = Math.max(15, charWidth * 2)
  if (bestGutterLen * step >= minGutterPx && bestGutterStart !== -1) {
    const splitX = (bestGutterStart + bestGutterLen / 2) * step
    const col1 = []
    const col2 = []

    for (const l of bandLines) {
      if (l.xCenter < splitX) {
        col1.push(l)
      } else {
        col2.push(l)
      }
    }

    if (col1.length > 0 && col2.length > 0) {
      col1.sort((a, b) => a.yMin - b.yMin)
      col2.sort((a, b) => a.yMin - b.yMin)
      return [col1, col2]
    }
  }

  // Fallback: single column sorted top-to-bottom
  bandLines.sort((a, b) => a.yMin - b.yMin)
  return [bandLines]
}

/**
 * Performs XY-Cut segmentation on body lines.
 * Slices into vertical bands (horizontal cuts), then detects vertical gutters (vertical cuts).
 */
export function segmentBodyLayout(bodyLines, canvasWidth) {
  if (!bodyLines || bodyLines.length === 0) return []

  // Estimate median line height & character width
  const heights = bodyLines.map(l => l.height).filter(h => h > 4).sort((a, b) => a - b)
  const medianHeight = heights.length ? heights[Math.floor(heights.length / 2)] : 14
  const charWidth = Math.max(5, medianHeight * 0.55)

  // Sort initially by top coordinate
  const sorted = [...bodyLines].sort((a, b) => a.yMin - b.yMin)

  // Group into horizontal bands
  const bands = []
  let currentBand = []

  for (const line of sorted) {
    if (currentBand.length === 0) {
      currentBand.push(line)
      continue
    }

    const prevLine = currentBand[currentBand.length - 1]
    const verticalGap = line.yMin - prevLine.yMax

    // Full-width title/banner lines form their own band
    const isFullWidth = line.width > canvasWidth * 0.60
    const prevIsFullWidth = prevLine.width > canvasWidth * 0.60

    if (isFullWidth || prevIsFullWidth || verticalGap > medianHeight * 2.0) {
      bands.push(currentBand)
      currentBand = [line]
    } else {
      currentBand.push(line)
    }
  }

  if (currentBand.length > 0) {
    bands.push(currentBand)
  }

  // In each band, split into columns if vertical gutter exists
  const orderedLines = []

  for (const band of bands) {
    const columns = splitColumnarBand(band, canvasWidth, charWidth)
    for (const col of columns) {
      orderedLines.push(...preserveIndentation(col, charWidth))
    }
  }
  return orderedLines
}

/**
 * Detects relative indentation offsets and prepends spaces for code blocks and outlines.
 */
function preserveIndentation(lines, charWidth) {
  if (lines.length === 0) return lines

  // Group lines with small vertical spacing into logical paragraph / code clusters
  const clusters = []
  let currentCluster = []

  for (const line of lines) {
    if (currentCluster.length === 0) {
      currentCluster.push(line)
      continue
    }
    const prev = currentCluster[currentCluster.length - 1]
    const gap = line.yMin - prev.yMax
    if (gap > prev.height * 1.8) {
      clusters.push(currentCluster)
      currentCluster = [line]
    } else {
      currentCluster.push(line)
    }
  }
  if (currentCluster.length) clusters.push(currentCluster)

  const result = []

  for (const cluster of clusters) {
    const minLeft = Math.min(...cluster.map(l => l.xMin))

    for (const line of cluster) {
      const indentOffset = line.xMin - minLeft
      // If indented by at least 1.5 characters
      if (indentOffset >= charWidth * 1.5) {
        const indentSpaces = Math.max(1, Math.round(indentOffset / (charWidth * 1.1)))
        const indentStr = ' '.repeat(indentSpaces)
        result.push({
          ...line,
          formattedText: indentStr + line.text,
          indentSpaces,
        })
      } else {
        result.push({
          ...line,
          formattedText: line.text,
          indentSpaces: 0,
        })
      }
    }
  }

  return result
}

/**
 * Full layout reconstruction pipeline for an OCR page.
 */
export function reconstructPageLayout(rawLines, canvasWidth, canvasHeight) {
  if (!rawLines || rawLines.length === 0) {
    return {
      allLines: [],
      bodyLines: [],
      headerLines: [],
      footerLines: [],
      fullText: '',
    }
  }

  const enriched = enrichLineGeometry(rawLines, canvasWidth, canvasHeight)
  const { header, body, footer } = partitionPageZones(enriched, canvasHeight)
  const structuredBody = segmentBodyLayout(body, canvasWidth)

  // Combined reading order: Header -> Structured Body -> Footer
  const allLines = [...header, ...structuredBody, ...footer]

  // Build clean text view
  const textParts = []
  if (header.length > 0) {
    textParts.push(header.map(l => l.text).join(' '))
  }

  if (structuredBody.length > 0) {
    textParts.push(structuredBody.map(l => l.formattedText || l.text).join('\n'))
  }

  if (footer.length > 0) {
    textParts.push(footer.map(l => l.text).join(' '))
  }

  const fullText = textParts.join('\n\n')

  return {
    allLines,
    bodyLines: structuredBody,
    headerLines: header,
    footerLines: footer,
    fullText,
  }
}
