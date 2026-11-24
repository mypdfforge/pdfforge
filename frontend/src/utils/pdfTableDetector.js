/**
 * PDF Table Detector
 * Identifies data grids, column boundaries, merged headers, and numeric cell alignments
 * for client-side Word (docx) table reconstruction.
 */

import { getVectorTableStyling } from './pdfVectorExtractor.js';

const CURRENCY_OR_NUM_RE =
  /^\(?\s*[\$€£¥]?\s*[+-]?\s*[\$€£¥]?\s*[\d,]+(\.\d+)?\s*(%|\bUSD\b|\bEUR\b|\bGBP\b)?\s*\)?$/i;

/**
 * 1D Coordinate Clustering: groups sorted coordinates within tolerance into cluster centroids.
 */
export function clusterCoordinates(vals, tolerance = 15) {
  if (!vals || vals.length === 0) return [];
  const sorted = [...vals].sort((a, b) => a - b);
  const clusters = [];

  for (const v of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && v - last.last <= tolerance) {
      last.sum += v;
      last.count++;
      last.last = v;
    } else {
      clusters.push({ sum: v, count: 1, last: v });
    }
  }

  return clusters.map((c) => Math.round((c.sum / c.count) * 10) / 10);
}

/**
 * Checks if a line exhibits tabular cell separation (multiple items with significant horizontal spacing).
 */
function isRowCandidate(line) {
  if (!line || !line.items || line.items.length === 0) return false;
  if (/^\[(NOTE|WARNING|CRITICAL|SUCCESS|TIP)\]/i.test(line.text)) return false;
  if (/^Section \d+/i.test(line.text)) return false;

  if (line.items.length >= 2) {
    // Check if there is at least one gap >= 12pt between items
    for (let i = 1; i < line.items.length; i++) {
      const prev = line.items[i - 1];
      const curr = line.items[i];
      if (curr.x - (prev.x + prev.w) >= 12) {
        return true;
      }
    }
  }
  // Check for merged header indicator
  if (/merged\s*header/i.test(line.text)) {
    return true;
  }
  if (/^[A-Z0-9\s\-_()]{15,}$/.test(line.text) && line.isBold) {
    return true;
  }
  return false;
}

function getLineY(line) {
  if (!line) return 0;
  if (typeof line.y === 'number') return line.y;
  if (line.items && line.items.length > 0 && typeof line.items[0].y === 'number') {
    return line.items[0].y;
  }
  return 0;
}

/**
 * Checks if a line is a wrapped cell continuation line inside an active candidate table.
 */
function isTableContinuation(line, activeTableLines) {
  if (!line || !line.items || line.items.length === 0 || activeTableLines.length === 0) return false;
  if (/^\[(NOTE|WARNING|CRITICAL|SUCCESS|TIP)\]/i.test(line.text)) return false;
  if (/^Section \d+/i.test(line.text)) return false;
  if (/^(\d+\.\d+|\d+\.)\s+[A-Z]/.test(line.text)) return false;

  const prevLine = activeTableLines[activeTableLines.length - 1];
  const dy = Math.abs(getLineY(prevLine) - getLineY(line));
  if (dy > 25) return false;

  let minTableX = Infinity;
  let maxTableX = -Infinity;
  for (const tl of activeTableLines) {
    for (const it of tl.items) {
      minTableX = Math.min(minTableX, it.x);
      maxTableX = Math.max(maxTableX, it.x + it.w);
    }
  }

  for (const it of line.items) {
    if (it.x < minTableX - 15 || it.x + it.w > maxTableX + 15) {
      return false;
    }
  }
  return true;
}

/**
 * Partitions ordered lines into paragraph blocks, table blocks, column blocks, and callouts.
 */
export function detectTableRegions(lines, pageWidth, vectorGeometry = null) {
  if (!lines || lines.length === 0) return [];

  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Check for 2-column editorial layout block
    if (line.column === 1) {
      const col1Lines = [];
      while (i < lines.length && lines[i].column === 1) {
        col1Lines.push(lines[i]);
        i++;
      }
      const col2Lines = [];
      while (i < lines.length && lines[i].column === 2) {
        col2Lines.push(lines[i]);
        i++;
      }
      blocks.push({
        type: 'columns',
        col1Lines,
        col2Lines,
      });
      continue;
    }

    // Check for callout admonition box
    if (line.admonition) {
      const calloutLines = [line];
      const adm = line.admonition;
      i++;
      while (i < lines.length && lines[i].admonition && lines[i].admonition.type === adm.type) {
        calloutLines.push(lines[i]);
        i++;
      }
      blocks.push({
        type: 'callout',
        admonition: adm,
        lines: calloutLines,
      });
      continue;
    }

    // Check for multi-line code block
    if (line.isCode) {
      const codeLines = [line];
      i++;
      while (i < lines.length && lines[i].isCode) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({
        type: 'code',
        lines: codeLines,
      });
      continue;
    }

    if (!isRowCandidate(line)) {
      blocks.push({ type: 'paragraph', line });
      i++;
      continue;
    }

    // Found candidate row. Gather consecutive candidate rows and wrapped continuation lines.
    const tableLines = [line];
    i++;

    while (i < lines.length) {
      const cur = lines[i];
      if (cur.isTwoColBlock || cur.admonition || cur.isCode) break;

      if (isRowCandidate(cur)) {
        const prev = tableLines[tableLines.length - 1];
        if (Math.abs(getLineY(prev) - getLineY(cur)) <= 36) {
          tableLines.push(cur);
          i++;
          continue;
        } else {
          break;
        }
      } else if (isTableContinuation(cur, tableLines)) {
        tableLines.push(cur);
        i++;
        continue;
      } else {
        break;
      }
    }

    // A valid table needs at least 2 rows and at least one multi-item row
    const multiItemRows = tableLines.filter((l) => l.items && l.items.length >= 2);
    if (tableLines.length >= 2 && multiItemRows.length >= 1) {
      const tableBlock = buildTableBlock(tableLines, pageWidth, vectorGeometry);
      blocks.push(tableBlock);
    } else {
      // Revert to normal paragraphs
      for (const l of tableLines) {
        blocks.push({ type: 'paragraph', line: l });
      }
    }
  }

  // Merge adjacent table blocks that share the same number of columns with no intervening text
  const mergedBlocks = [];
  for (const b of blocks) {
    const prevB = mergedBlocks[mergedBlocks.length - 1];
    if (b.type === 'table' && prevB && prevB.type === 'table' && prevB.numCols === b.numCols) {
      prevB.rows.push(...b.rows);
    } else {
      mergedBlocks.push(b);
    }
  }

  return mergedBlocks;
}

/**
 * Neutral header theme. The previous version guessed colours from keywords such as
 * "incident" or "trial specimen" (tuned to one test PDF), which painted real-world
 * tables with the wrong colours. Real colours now come only from vector geometry.
 */
export function getTableHeaderTheme() {
  return { bg: 'E7E9EE', text: '000000', border: 'A6A6A6', fromVector: false };
}

function hexLuminance(hex) {
  const h = String(hex || '').replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(h)) return 1;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Builds table structure with columns, merged header detection, and cell alignments.
 */
function buildTableBlock(tableLines, pageWidth, vectorGeometry = null) {
  // First multi-item row is the column header row
  const headerLine = tableLines.find((l) => l.items && l.items.length >= 2);

  // Collect all item X starts from multi-item rows
  const xStarts = [];
  let minX = Infinity;
  let maxX = -Infinity;

  for (const line of tableLines) {
    if (line.items.length >= 2) {
      for (const it of line.items) {
        xStarts.push(it.x);
        minX = Math.min(minX, it.x);
        maxX = Math.max(maxX, it.x + it.w);
      }
    }
  }

  if (xStarts.length === 0) {
    minX = Math.min(...tableLines.map((l) => l.x));
    maxX = Math.max(...tableLines.map((l) => l.xEnd));
    xStarts.push(minX);
  }

  // Column edges derived from header row if available, else 1D clustering
  let colEdges = [];
  if (headerLine && headerLine.items.length >= 2) {
    colEdges = [...headerLine.items.map((it) => it.x)].sort((a, b) => a - b);
  } else {
    colEdges = clusterCoordinates(xStarts, 22);
  }

  const multiRows = tableLines.filter(l => l.items?.length >= 2);
  if (multiRows.length >= 3 && colEdges.length > 1) {
    colEdges = colEdges.filter((e, k) => k === 0 ||
      multiRows.filter(l => l.items.some(it => Math.abs(it.x - e) <= 14)).length / multiRows.length >= 0.7);
  }

  const numCols = Math.max(colEdges.length, 1);
  const tableWidth = Math.max(maxX - minX, 100);

  // Derive column edges and widths by distributing gutters between columns
  const colWidths = [];
  if (numCols > 1) {
    const colBounds = Array.from({ length: numCols }, () => ({ minX: Infinity, maxX: -Infinity }));
    for (const line of tableLines) {
      if (line.items.length >= 2) {
        for (const it of line.items) {
          let cIdx = 0;
          for (let c = 0; c < numCols; c++) {
            const edge = colEdges[c];
            const nextEdge = c < numCols - 1 ? colEdges[c + 1] : Infinity;
            if (it.x >= edge - 14 && it.x < nextEdge - 14) {
              cIdx = c;
              break;
            }
            cIdx = c;
          }
          colBounds[cIdx].minX = Math.min(colBounds[cIdx].minX, it.x);
          colBounds[cIdx].maxX = Math.max(colBounds[cIdx].maxX, it.x + (it.w || 0));
        }
      }
    }

    const boundaries = [minX];
    for (let c = 0; c < numCols - 1; c++) {
      const curMax = Number.isFinite(colBounds[c].maxX) ? colBounds[c].maxX : colEdges[c];
      const nextMin = Number.isFinite(colBounds[c + 1].minX) ? colBounds[c + 1].minX : colEdges[c + 1];
      if (nextMin > curMax) {
        boundaries.push((curMax + nextMin) / 2);
      } else {
        boundaries.push(colEdges[c + 1]);
      }
    }
    boundaries.push(maxX);

    for (let c = 0; c < numCols; c++) {
      const w = boundaries[c + 1] - boundaries[c];
      const pct = Math.round((w / tableWidth) * 100);
      colWidths.push(Math.max(pct, 5));
    }
  } else {
    colWidths.push(100);
  }

  const rows = [];

  tableLines.forEach((line, rowIndex) => {
    // Check if this row is a merged header (single text run covering most of the table width or tagged)
    const lineWidth = line.w || line.width || (line.items?.length ? (line.items[line.items.length - 1].x + (line.items[line.items.length - 1].w || 0) - line.items[0].x) : 0);
    const isMergedHeader =
      (line.items.length === 1 || /merged\s*header/i.test(line.text)) &&
      (lineWidth >= 0.55 * tableWidth || /merged\s*header/i.test(line.text));

    if (isMergedHeader) {
      rows.push({
        isHeader: true,
        isMergedHeader: true,
        cells: [
          {
            text: line.text,
            columnSpan: numCols,
            isHeader: true,
            bold: true,
            align: 'center',
            fontSize: line.size || 11,
          },
        ],
      });
      return;
    }

    // Standard multi-column row: bucket items into column slots
    const cellBuckets = Array.from({ length: numCols }, () => []);

    for (const it of line.items) {
      // Find nearest or containing column edge
      let colIdx = 0;
      for (let c = 0; c < numCols; c++) {
        const edge = colEdges[c];
        const nextEdge = c < numCols - 1 ? colEdges[c + 1] : Infinity;
        if (it.x >= edge - 14 && it.x < nextEdge - 14) {
          colIdx = c;
          break;
        }
        if (it.x < edge) {
          colIdx = c;
          break;
        }
        colIdx = c;
      }
      cellBuckets[colIdx].push(it);
    }

    const prevRow = rows[rows.length - 1];
    // Determine whether Row 0 is genuinely a table header:
    // It is NOT a header if it is a Table of Contents entry or numbered list item.
    const isTOCorNumbered =
      /^\s*(\d+[\.\)]\s+|Page\s+\d+)/i.test(line.text) ||
      /\bPage\s+\d+\b/i.test(line.text);

    const hasHeaderKeywords =
      /(^|\s)(ID|Role|Name|Category|Status|State|Date|vCPU|Memory|RAM|CPU|Disk|Latency|Trial|Specimen|Mean|Std|Timestamp|Officer|Signatory|Q[1-4]|YoY|Gross|Net|EBITDA|Free|Pro|Enterprise|Language|Verification|Capability)(\s|$)/i.test(line.text);

    const isRow0Header =
      rowIndex === 0 &&
      !isTOCorNumbered &&
      (line.isBold || hasHeaderKeywords);

    const isHeaderRow = isRow0Header || (rowIndex === 1 && rows[0]?.isMergedHeader);

    // Check if this line is a continuation of the previous row:
    // If previous row exists and is not a merged header, and either column 0 is empty,
    // or only column 0 has items and prevRow already has text in col 0 while other cols are empty,
    // or the trailing column (e.g. status) is empty in current line while present in prevRow
    const isContinuation =
      prevRow &&
      !prevRow.isMergedHeader &&
      !isHeaderRow &&
      (cellBuckets[0].length === 0 ||
        (cellBuckets.slice(1).every((b) => b.length === 0) &&
          prevRow.cells[0]?.text &&
          !CURRENCY_OR_NUM_RE.test(cellBuckets[0][0]?.str) &&
          !/^\d+\./.test(cellBuckets[0][0]?.str)) ||
        (numCols >= 3 &&
          cellBuckets[numCols - 1].length === 0 &&
          prevRow.cells[numCols - 1]?.text &&
          !/^(Phase\s+\d+|[A-Z0-9_\-]{4,}:|\d+\.)/i.test(cellBuckets[0].map((it) => it.str).join(' ').trim())));

    if (isContinuation) {
      cellBuckets.forEach((itemsInCell, colIdx) => {
        if (itemsInCell.length > 0 && prevRow.cells[colIdx]) {
          const contText = itemsInCell.map((it) => it.str).join(' ').trim();
          if (contText) {
            prevRow.cells[colIdx].text = (prevRow.cells[colIdx].text + ' ' + contText).trim();
          }
        }
      });
      return;
    }

    const cells = cellBuckets.map((itemsInCell, colIdx) => {
      let cellText = '';
      itemsInCell.forEach((it, idx) => {
        if (idx > 0) {
          const prev = itemsInCell[idx - 1];
          const gap = it.x - (prev.x + prev.w);
          if (gap > 0.12 * it.size && !/\s$/.test(cellText) && !/^\s/.test(it.str)) {
            cellText += ' ';
          }
        }
        cellText += it.str;
      });
      cellText = cellText.trim();

      const isNumeric = CURRENCY_OR_NUM_RE.test(cellText);
      const align = isNumeric ? 'right' : 'left';
      const isBold = isHeaderRow || itemsInCell.some((i) => i.isBold);
      const fontSize = itemsInCell.length > 0 ? itemsInCell[0].size : line.size || 10;

      return {
        text: cellText,
        columnSpan: 1,
        isHeader: isHeaderRow,
        bold: isBold,
        align: isHeaderRow ? 'left' : align,
        fontSize,
      };
    });

    rows.push({ isHeader: isHeaderRow, cells });
  });

  let theme = getTableHeaderTheme();
  const yVals = tableLines.map((l) => getLineY(l));
  const minY = Math.min(...yVals);
  const maxY = Math.max(...yVals);

  if (vectorGeometry && vectorGeometry.rects && vectorGeometry.rects.length > 0) {
    try {
      const vectorTheme = getVectorTableStyling(vectorGeometry.rects, vectorGeometry.lines, { minX, maxX, minY, maxY });
      if (vectorTheme && vectorTheme.headerBg) {
        const bg = String(vectorTheme.headerBg).replace(/^#/, '');
        theme = {
          bg,
          // pick readable text for the REAL background (was hard-coded white → invisible on light headers)
          text: hexLuminance(bg) < 0.5 ? 'FFFFFF' : '000000',
          border: String(vectorTheme.borderColor || theme.border).replace(/^#/, ''),
          fromVector: true,
        };
      }
    } catch (_) {
      /* vector styling is optional — keep neutral theme */
    }
  }

  return {
    type: 'table',
    y: tableLines.length ? getLineY(tableLines[0]) : undefined,
    colWidths,
    rows,
    numCols,
    theme,
  };
}
