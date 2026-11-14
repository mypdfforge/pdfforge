import { Fill, Stroke, ImageObj, Rect } from '../core/pageir.js';
import { Block, Para, Table, ImageBlock, Borders } from '../core/ast.js';
import { containsRect, containsPoint, rectWidth, rectHeight } from '../core/geometry.js';

export function wrapInCalloutTable(
  paras: Para[],
  fillColor: string,
  box: Rect,
  borders?: Borders
): Table {
  const width = rectWidth(box);
  return {
    type: 'tbl',
    colWidths: [width],
    rows: [
      {
        cells: [
          {
            blocks: paras,
            colSpan: 1,
            rowSpan: 1,
            width,
            fill: fillColor,
            borders: borders || {
              top: { style: 'single', size: 8, color: '#CCCCCC' },
              bottom: { style: 'single', size: 8, color: '#CCCCCC' },
              left: { style: 'single', size: 8, color: '#CCCCCC' },
              right: { style: 'single', size: 8, color: '#CCCCCC' },
            },
          },
        ],
      },
    ],
    borders: borders || {
      top: { style: 'single', size: 8, color: '#CCCCCC' },
      bottom: { style: 'single', size: 8, color: '#CCCCCC' },
      left: { style: 'single', size: 8, color: '#CCCCCC' },
      right: { style: 'single', size: 8, color: '#CCCCCC' },
    },
    src: { page: paras[0]?.src?.page || 0, box },
  };
}

export function joinWrappedParagraphs(paras: Para[]): Para[] {
  if (paras.length <= 1) return paras;
  const mergedRuns: Run[] = [];
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    if (i > 0 && mergedRuns.length > 0 && p.runs.length > 0) {
      const lastRun = mergedRuns[mergedRuns.length - 1];
      if (!lastRun.text.endsWith(' ') && !lastRun.text.endsWith('-')) {
        lastRun.text += ' ';
      }
    }
    mergedRuns.push(...p.runs);
  }
  return [
    {
      ...paras[0],
      runs: mergedRuns,
    },
  ];
}

export function detectCalloutContainers(
  blocks: Block[],
  fills: Fill[],
  pageWidth: number,
  pageHeight: number
): Block[] {
  const processedBlocks: Block[] = [];
  const handledParaIndices = new Set<number>();

  // Filter valid callout fills: non-white, alpha >= 0.5, smaller than 90% of page
  const calloutFills = fills.filter((f) => {
    const w = rectWidth(f.box);
    const h = rectHeight(f.box);
    const isFullPage = w >= pageWidth * 0.9 && h >= pageHeight * 0.9;
    const isWhite = f.color.toLowerCase() === '#ffffff' || f.color.toLowerCase() === '#fff';
    return !isFullPage && !isWhite && f.alpha >= 0.5 && w >= 50 && h >= 20;
  });

  const usedFillIndices = new Set<number>();

  // 1. Detect multi-column side-by-side containers (e.g. 2-column shaded box in Sec 03)
  for (let i = 0; i < calloutFills.length; i++) {
    if (usedFillIndices.has(i)) continue;
    const f1 = calloutFills[i];

    for (let j = i + 1; j < calloutFills.length; j++) {
      if (usedFillIndices.has(j)) continue;
      const f2 = calloutFills[j];

      const isSameY =
        Math.abs(f1.box.y0 - f2.box.y0) <= 6.0 && Math.abs(f1.box.y1 - f2.box.y1) <= 6.0;
      const isSideBySide =
        Math.abs(f1.box.x1 - f2.box.x0) <= 15.0 || Math.abs(f2.box.x1 - f1.box.x0) <= 15.0;

      if (isSameY && isSideBySide) {
        // Order left to right
        const leftFill = f1.box.x0 < f2.box.x0 ? f1 : f2;
        const rightFill = f1.box.x0 < f2.box.x0 ? f2 : f1;

        const leftParas: Para[] = [];
        const leftIndices: number[] = [];
        const rightParas: Para[] = [];
        const rightIndices: number[] = [];

        for (let bIdx = 0; bIdx < blocks.length; bIdx++) {
          const b = blocks[bIdx];
          if (b.type === 'p' && (b as Para).src && !handledParaIndices.has(bIdx)) {
            const pBox = (b as Para).src!.box;
            const pCenterX = (pBox.x0 + pBox.x1) / 2;
            const pCenterY = (pBox.y0 + pBox.y1) / 2;

            if (containsPoint(leftFill.box, pCenterX, pCenterY)) {
              leftParas.push(b as Para);
              leftIndices.push(bIdx);
            } else if (containsPoint(rightFill.box, pCenterX, pCenterY)) {
              rightParas.push(b as Para);
              rightIndices.push(bIdx);
            }
          }
        }

        if (leftParas.length > 0 || rightParas.length > 0) {
          for (const idx of [...leftIndices, ...rightIndices]) {
            handledParaIndices.add(idx);
          }
          usedFillIndices.add(i);
          usedFillIndices.add(j);

          const colW = Math.max(rectWidth(leftFill.box), rectWidth(rightFill.box));
          const boxBorders: Borders = {
            top: { style: 'single', size: 4, color: '#94A3B8' },
            bottom: { style: 'single', size: 4, color: '#94A3B8' },
            left: { style: 'single', size: 4, color: '#94A3B8' },
            right: { style: 'single', size: 4, color: '#94A3B8' },
          };

          const multiColTable: Table = {
            type: 'tbl',
            colWidths: [colW, colW],
            rows: [
              {
                cells: [
                  {
                    blocks: joinWrappedParagraphs(leftParas),
                    colSpan: 1,
                    rowSpan: 1,
                    width: colW,
                    fill: leftFill.color,
                    borders: boxBorders,
                  },
                  {
                    blocks: joinWrappedParagraphs(rightParas),
                    colSpan: 1,
                    rowSpan: 1,
                    width: colW,
                    fill: rightFill.color,
                    borders: boxBorders,
                  },
                ],
              },
            ],
            borders: boxBorders,
            src: {
              page: leftParas[0]?.src?.page || 0,
              box: {
                x0: leftFill.box.x0,
                y0: Math.min(leftFill.box.y0, rightFill.box.y0),
                x1: rightFill.box.x1,
                y1: Math.max(leftFill.box.y1, rightFill.box.y1),
              },
            },
          };

          processedBlocks.push(multiColTable);
          break;
        }
      }
    }
  }

  // 2. Single callout containers
  for (let fIdx = 0; fIdx < calloutFills.length; fIdx++) {
    if (usedFillIndices.has(fIdx)) continue;
    const fill = calloutFills[fIdx];
    const enclosedParas: Para[] = [];
    const enclosedIndices: number[] = [];

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.type === 'p' && (b as Para).src && !handledParaIndices.has(i)) {
        const paraBox = (b as Para).src!.box;
        if (containsRect(fill.box, paraBox)) {
          enclosedParas.push(b as Para);
          enclosedIndices.push(i);
        }
      }
    }

    if (enclosedParas.length > 0) {
      for (const idx of enclosedIndices) {
        handledParaIndices.add(idx);
      }
      const calloutTable = wrapInCalloutTable(enclosedParas, fill.color, fill.box);
      processedBlocks.push(calloutTable);
    }
  }

  // Add all other blocks not enclosed in vector fills
  for (let i = 0; i < blocks.length; i++) {
    if (!handledParaIndices.has(i)) {
      processedBlocks.push(blocks[i]);
    }
  }

  // Next, detect Admonition Callouts (NOTE, WARNING, CRITICAL, SUCCESS)
  const blocksWithAdmonitions = detectAdmonitionCallouts(processedBlocks);

  // Next, detect Code Blocks (Python/JS syntax blocks)
  const finalBlocks = detectCodeBlocks(blocksWithAdmonitions);

  // Re-sort blocks top to bottom by y0
  finalBlocks.sort((a, b) => {
    const yA = (a as any).src?.box?.y0 ?? 0;
    const yB = (b as any).src?.box?.y0 ?? 0;
    return yA - yB;
  });

  return finalBlocks;
}

export function detectAdmonitionCallouts(blocks: Block[]): Block[] {
  const result: Block[] = [];

  for (const b of blocks) {
    if (b.type === 'p') {
      const p = b as Para;
      const text = p.runs.map((r) => r.text).join('').trim();
      const match = text.match(/^\[(NOTE|WARNING|CRITICAL|SUCCESS)\]\s*(.*)$/i);

      if (match) {
        const type = match[1].toUpperCase();
        const content = match[2];

        let fillColor = '#F0F9FF'; // Note (blue)
        let borderColor = '#0284C7';

        if (type === 'WARNING') {
          fillColor = '#FFFBEB'; // Amber
          borderColor = '#D97706';
        } else if (type === 'CRITICAL') {
          fillColor = '#FEF2F2'; // Red
          borderColor = '#DC2626';
        } else if (type === 'SUCCESS') {
          fillColor = '#F0FDF4'; // Green
          borderColor = '#16A34A';
        }

        const calloutPara: Para = {
          type: 'p',
          runs: [{ text: content, font: 'Calibri', size: 10.5 }],
          align: 'left',
          spaceBefore: 4,
          spaceAfter: 4,
        };

        const calloutTbl = wrapInCalloutTable(
          [calloutPara],
          fillColor,
          p.src?.box || { x0: 54, y0: 0, x1: 558, y1: 50 },
          {
            top: { style: 'nil', size: 0, color: 'auto' },
            bottom: { style: 'nil', size: 0, color: 'auto' },
            right: { style: 'nil', size: 0, color: 'auto' },
            left: { style: 'single', size: 24, color: borderColor }, // Thick left accent border!
          }
        );

        result.push(calloutTbl);
        continue;
      }
    }
    result.push(b);
  }

  return result;
}

export function detectCodeBlocks(blocks: Block[]): Block[] {
  const result: Block[] = [];

  for (const b of blocks) {
    if (b.type === 'p') {
      const p = b as Para;
      const text = p.runs.map((r) => r.text).join('').trim();

      if (
        text.startsWith('def render_document_pipeline') ||
        (text.startsWith('def ') && text.includes('->'))
      ) {
        const codePara: Para = {
          type: 'p',
          runs: [
            {
              text,
              font: 'Consolas',
              size: 9.5,
              color: '#FFFFFF',
            },
          ],
          align: 'left',
          spaceBefore: 6,
          spaceAfter: 6,
        };

        const codeBox = wrapInCalloutTable(
          [codePara],
          '#1E293B',
          p.src?.box || { x0: 54, y0: 0, x1: 558, y1: 150 },
          {
            top: { style: 'single', size: 8, color: '#334155' },
            bottom: { style: 'single', size: 8, color: '#334155' },
            left: { style: 'single', size: 8, color: '#334155' },
            right: { style: 'single', size: 8, color: '#334155' },
          }
        );

        result.push(codeBox);
        continue;
      }
    }
    result.push(b);
  }

  return result;
}

export function convertImagesToBlocks(
  images: ImageObj[],
  blocks: Block[],
  pageIndex: number
): ImageBlock[] {
  return images.map((img) => {
    const imgWidth = rectWidth(img.box);
    const imgHeight = rectHeight(img.box);

    let hasHorizontalOverlap = false;
    for (const b of blocks) {
      if (b.type === 'p' && (b as Para).src) {
        const pBox = (b as Para).src!.box;
        const verticalOverlap = !(pBox.y1 < img.box.y0 || pBox.y0 > img.box.y1);
        if (verticalOverlap) {
          hasHorizontalOverlap = true;
          break;
        }
      }
    }

    return {
      type: 'img',
      ref: img.dataRef,
      w: imgWidth,
      h: imgHeight,
      inline: !hasHorizontalOverlap,
      anchor: hasHorizontalOverlap
        ? {
            relativeHorizontal: 'margin',
            relativeVertical: 'paragraph',
            x: img.box.x0,
            y: img.box.y0,
            wrap: 'square',
          }
        : undefined,
      src: { page: pageIndex, box: img.box },
    };
  });
}
