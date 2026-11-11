import { Fill, Stroke, ImageObj, Rect } from '../core/pageir.js';
import { Block, Para, Table, ImageBlock, Borders } from '../core/ast.js';
import { containsRect, rectWidth, rectHeight } from '../core/geometry.js';

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

  for (const fill of calloutFills) {
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

  // Add all other blocks not enclosed in callouts
  for (let i = 0; i < blocks.length; i++) {
    if (!handledParaIndices.has(i)) {
      processedBlocks.push(blocks[i]);
    }
  }

  // Re-sort blocks top to bottom by y0
  processedBlocks.sort((a, b) => {
    const yA = (a as any).src?.box?.y0 ?? 0;
    const yB = (b as any).src?.box?.y0 ?? 0;
    return yA - yB;
  });

  return processedBlocks;
}

export function convertImagesToBlocks(
  images: ImageObj[],
  blocks: Block[],
  pageIndex: number
): ImageBlock[] {
  return images.map((img) => {
    const imgWidth = rectWidth(img.box);
    const imgHeight = rectHeight(img.box);

    // Check if any text block overlaps horizontally with this image
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
