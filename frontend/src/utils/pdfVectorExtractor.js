/**
 * pdfVectorExtractor.js — Low-level vector geometry and graphics state extraction engine.
 * Intercepts PDF OperatorList to capture exact vector lines, path bounding boxes,
 * borders, and authentic fill colors directly from the PDF graphics stream.
 */

function rgbToHex(r, g, b) {
  if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number') return null;
  return ((1 << 24) + (Math.round(r) << 16) + (Math.round(g) << 8) + Math.round(b))
    .toString(16)
    .slice(1)
    .toUpperCase();
}

/**
 * Traverses PDF.js OperatorList to extract vector rectangles, line strokes, and color fills.
 * @param {object} page - The PDF.js page object
 * @returns {Promise<{ rects: Array, lines: Array, fills: Set }>}
 */
export async function extractVectorGeometry(page) {
  if (!page || typeof page.getOperatorList !== 'function') {
    return { rects: [], lines: [], fills: new Set() };
  }

  const opList = await page.getOperatorList();
  // PDF.js internal Operator codes
  const OPS = (typeof window !== 'undefined' && window.pdfjsLib?.OPS) || {
    constructPath: 91,
    fill: 30,
    eoFill: 31,
    stroke: 32,
    fillStroke: 33,
    setLineWidth: 18,
    setFillRGBColor: 38,
    setStrokeRGBColor: 39,
  };

  const rects = [];
  const lines = [];
  const fills = new Set();

  let curFill = null;
  let curStroke = null;
  let curLineWidth = 1;

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];

    if ((fn === OPS.setFillRGBColor || fn === 38) && args && args.length >= 3) {
      curFill = rgbToHex(args[0], args[1], args[2]);
      if (curFill) fills.add(curFill);
      continue;
    }
    if ((fn === OPS.setStrokeRGBColor || fn === 39) && args && args.length >= 3) {
      curStroke = rgbToHex(args[0], args[1], args[2]);
      continue;
    }
    if ((fn === OPS.setLineWidth || fn === 18) && args && args.length >= 1) {
      curLineWidth = args[0] || 1;
      continue;
    }

    if ((fn === OPS.constructPath || fn === 91) && args) {
      const pathOps = args[0];
      const coords = args[1];

      // Check if path is a rectangle: op code 19
      if (pathOps && pathOps.length === 1 && pathOps[0] === 19 && coords && coords.length >= 4) {
        const x = coords[0];
        const y = coords[1];
        const w = coords[2];
        const h = coords[3];

        const nextFn = opList.fnArray[i + 1];
        const isFill = nextFn === OPS.fill || nextFn === OPS.eoFill || nextFn === OPS.fillStroke || nextFn === 30 || nextFn === 31 || nextFn === 33;
        const isStroke = nextFn === OPS.stroke || nextFn === OPS.fillStroke || nextFn === 32 || nextFn === 33;

        rects.push({
          x,
          y,
          w,
          h,
          fill: isFill ? curFill : null,
          stroke: isStroke ? curStroke : null,
          lineWidth: curLineWidth,
        });
      }

      // Check for line segments: moveTo (13) + lineTo (14)
      if (pathOps && coords) {
        let coordIdx = 0;
        let lastX = 0;
        let lastY = 0;
        for (const op of pathOps) {
          if (op === 13) {
            lastX = coords[coordIdx++];
            lastY = coords[coordIdx++];
          } else if (op === 14) {
            const x2 = coords[coordIdx++];
            const y2 = coords[coordIdx++];
            const isH = Math.abs(lastY - y2) < 0.75;
            const isV = Math.abs(lastX - x2) < 0.75;
            if (isH || isV) {
              lines.push({
                x1: Math.min(lastX, x2),
                y1: Math.min(lastY, y2),
                x2: Math.max(lastX, x2),
                y2: Math.max(lastY, y2),
                isHorizontal: isH,
                isVertical: isV,
                stroke: curStroke,
                lineWidth: curLineWidth,
              });
            }
            lastX = x2;
            lastY = y2;
          }
        }
      }
    }
  }

  return { rects, lines, fills };
}

/**
 * Finds the dominant header fill color and cell borders within a table bounding box.
 */
export function getVectorTableStyling(rects, lines, tableBBox) {
  if (!rects || rects.length === 0 || !tableBBox) {
    return { headerBg: null, zebraBg: null, borderColor: null };
  }

  const { minX, maxX, minY, maxY } = tableBBox;

  // Filter rects within table bounds
  const insideRects = rects.filter(
    (r) =>
      r.x >= minX - 10 &&
      r.x + r.w <= maxX + 10 &&
      r.y >= minY - 10 &&
      r.y + r.h <= maxY + 10 &&
      r.fill &&
      r.fill !== 'FFFFFF'
  );

  // Topmost rects are usually the header
  insideRects.sort((a, b) => b.y - a.y);

  const headerRect = insideRects.find((r) => r.y >= maxY - 40 && r.w >= 0.5 * (maxX - minX));
  const zebraRect = insideRects.find((r) => r !== headerRect && r.fill !== headerRect?.fill);

  const tableLines = lines.filter(
    (l) => l.x1 >= minX - 10 && l.x2 <= maxX + 10 && l.y1 >= minY - 10 && l.y2 <= maxY + 10 && l.stroke
  );

  return {
    headerBg: headerRect ? headerRect.fill : null,
    zebraBg: zebraRect ? zebraRect.fill : null,
    borderColor: tableLines.length > 0 ? tableLines[0].stroke : null,
  };
}
