import {
  Glyph,
  Stroke,
  Fill,
  ImageObj,
  FontInfo,
  Rect,
  PageIR,
} from '../core/pageir.js';
import { resolveFontDescriptor, parseFontDescriptor } from './fontMap.js';

// Matrix math helpers [a, b, c, d, e, f]
export type Matrix = [number, number, number, number, number, number];

export function identityMatrix(): Matrix {
  return [1, 0, 0, 1, 0, 0];
}

export function multiplyMatrices(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}

export function applyMatrixToPoint(m: Matrix, x: number, y: number): { x: number; y: number } {
  return {
    x: m[0] * x + m[2] * y + m[4],
    y: m[1] * x + m[3] * y + m[5],
  };
}

export function expandLigatures(str: string): string {
  // First normalize Unicode NFKC to resolve Arabic presentation forms
  const normalized = str.normalize('NFKC');
  return normalized
    .replace(/\uFB00/g, 'ff')
    .replace(/\uFB01/g, 'fi')
    .replace(/\uFB02/g, 'fl')
    .replace(/\uFB03/g, 'ffi')
    .replace(/\uFB04/g, 'ffl')
    .replace(/\uFB05/g, 'ft')
    .replace(/\uFB06/g, 'st');
}

export function isPua(char: string): boolean {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return (code >= 0xe000 && code <= 0xf8ff) || code === 0xfffd;
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (v: number) => clamp(v).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function cmykToRgb(c: number, m: number, y: number, k: number): string {
  const r = 255 * (1 - c) * (1 - k);
  const g = 255 * (1 - m) * (1 - k);
  const b = 255 * (1 - y) * (1 - k);
  return rgbToHex(r, g, b);
}

export class OperatorInterpreter {
  private ctmStack: Matrix[] = [identityMatrix()];
  private currentCtm: Matrix = identityMatrix();

  // Text State
  private tm: Matrix = identityMatrix();
  private tlm: Matrix = identityMatrix();
  private fontKey: string = 'Calibri';
  private fontSize: number = 11;
  private charSpacing: number = 0;
  private wordSpacing: number = 0;
  private leading: number = 0;
  private rise: number = 0;
  private hScale: number = 1.0;
  private renderMode: number = 0;

  // Colors & Line State
  private fillColor: string = '#000000';
  private strokeColor: string = '#000000';
  private lineWidth: number = 1.0;

  // Pending Path Elements
  private pendingRects: { x: number; y: number; w: number; h: number }[] = [];
  private pendingLines: { x0: number; y0: number; x1: number; y1: number }[] = [];

  // Output collectors
  public glyphs: Glyph[] = [];
  public fonts: Map<string, FontInfo> = new Map();
  public strokes: Stroke[] = [];
  public fills: Fill[] = [];
  public images: ImageObj[] = [];
  public puaCount: number = 0;

  private pageHeight: number;
  private zIndex: number = 0;

  constructor(pageHeight: number) {
    this.pageHeight = pageHeight;
  }

  get ctm(): Matrix {
    return this.currentCtm;
  }

  save() {
    this.ctmStack.push([...this.currentCtm]);
  }

  restore() {
    if (this.ctmStack.length > 1) {
      this.currentCtm = this.ctmStack.pop()!;
    }
  }

  transform(a: number, b: number, c: number, d: number, e: number, f: number) {
    const m: Matrix = [a, b, c, d, e, f];
    this.currentCtm = multiplyMatrices(this.currentCtm, m);
  }

  setLineWidth(width: number) {
    this.lineWidth = Math.max(0.5, width);
  }

  setFillColorRgb(r: number, g: number, b: number) {
    const red = r > 1 ? r : r * 255;
    const green = g > 1 ? g : g * 255;
    const blue = b > 1 ? b : b * 255;
    this.fillColor = rgbToHex(red, green, blue);
  }

  setStrokeColorRgb(r: number, g: number, b: number) {
    const red = r > 1 ? r : r * 255;
    const green = g > 1 ? g : g * 255;
    const blue = b > 1 ? b : b * 255;
    this.strokeColor = rgbToHex(red, green, blue);
  }

  setFillColorGray(g: number) {
    const gray = g > 1 ? g : g * 255;
    this.fillColor = rgbToHex(gray, gray, gray);
  }

  setStrokeColorGray(g: number) {
    const gray = g > 1 ? g : g * 255;
    this.strokeColor = rgbToHex(gray, gray, gray);
  }

  setFillColorCmyk(c: number, m: number, y: number, k: number) {
    this.fillColor = cmykToRgb(c, m, y, k);
  }

  setStrokeColorCmyk(c: number, m: number, y: number, k: number) {
    this.strokeColor = cmykToRgb(c, m, y, k);
  }

  beginText() {
    this.tm = identityMatrix();
    this.tlm = identityMatrix();
  }

  setFont(fontName: string, size: number, commonObjs?: any, fontFlags: number = 0) {
    this.fontSize = Math.abs(size);
    const info = commonObjs
      ? resolveFontDescriptor(fontName, commonObjs, undefined, fontFlags)
      : parseFontDescriptor(fontName, fontFlags);
    this.fontKey = info.key;
    if (!this.fonts.has(this.fontKey)) {
      this.fonts.set(this.fontKey, info);
    }
  }

  setTextMatrix(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.tm = [a, b, c, d, e, f];
    this.tlm = [a, b, c, d, e, f];
  }

  moveText(tx: number, ty: number) {
    const moveM: Matrix = [1, 0, 0, 1, tx, ty];
    this.tlm = multiplyMatrices(this.tlm, moveM);
    this.tm = [...this.tlm];
  }

  nextLine() {
    this.moveText(0, -this.leading);
  }

  setLeading(leading: number) {
    this.leading = leading;
  }

  setCharSpacing(spacing: number) {
    this.charSpacing = spacing;
  }

  setWordSpacing(spacing: number) {
    this.wordSpacing = spacing;
  }

  setHorizontalScaling(scale: number) {
    this.hScale = scale / 100;
  }

  setTextRise(rise: number) {
    this.rise = rise;
  }

  setRenderMode(mode: number) {
    this.renderMode = mode;
  }

  addGlyph(
    rawCh: string,
    x: number,
    pdfY: number,
    width: number,
    height: number,
    fontSize: number,
    fontKey: string,
    color: string
  ) {
    const ch = expandLigatures(rawCh);
    const pua = isPua(ch);
    if (pua) this.puaCount++;

    // Normalize PDF space (origin bottom-left) to PageIR space (top-left, y down)
    const y0 = this.pageHeight - pdfY - height;
    const y1 = this.pageHeight - pdfY;
    const baseline = this.pageHeight - pdfY;

    this.glyphs.push({
      ch,
      box: {
        x0: x,
        y0,
        x1: x + width,
        y1,
      },
      baseline,
      size: fontSize,
      fontKey,
      color,
      rot: 0,
      flags: (pua ? 1 : 0) | (this.renderMode === 3 ? 4 : 0),
    });
  }

  addStroke(kind: 'line' | 'rect' | 'path', pts: number[], width: number, color: string) {
    this.strokes.push({
      kind,
      pts,
      width,
      color,
    });
  }

  addFill(box: Rect, color: string, alpha: number = 1.0, pathPts?: number[]) {
    // If it's a thin rect (< 1.5pt), classify as line stroke (§5 S1 step 5)
    const w = box.x1 - box.x0;
    const h = box.y1 - box.y0;
    if (Math.min(w, h) < 1.5 && Math.max(w, h) >= 3.0) {
      this.strokes.push({
        kind: 'line',
        pts: [box.x0, box.y0, box.x1, box.y1],
        width: Math.min(w, h),
        color,
      });
      return;
    }

    this.fills.push({
      box,
      color,
      alpha,
      z: this.zIndex++,
      pathPts,
    });
  }

  /**
   * Interprets vector operators from page.getOperatorList()
   */
  interpretOperators(
    fnArray: number[],
    argsArray: any[],
    OPS: Record<string, number>,
    commonObjs?: any
  ) {
    let currentPathRects: { x: number; y: number; w: number; h: number }[] = [];
    let currentPathLines: { x0: number; y0: number; x1: number; y1: number }[] = [];
    let currentPoint = { x: 0, y: 0 };

    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i];
      const args = argsArray[i];

      if (fn === OPS.save) {
        this.save();
      } else if (fn === OPS.restore) {
        this.restore();
      } else if (fn === OPS.transform) {
        this.transform(args[0], args[1], args[2], args[3], args[4], args[5]);
      } else if (fn === OPS.beginText) {
        this.beginText();
      } else if (fn === OPS.setTextMatrix) {
        this.setTextMatrix(args[0], args[1], args[2], args[3], args[4], args[5]);
      } else if (fn === OPS.moveText) {
        this.moveText(args[0], args[1]);
      } else if (fn === OPS.nextLine) {
        this.nextLine();
      } else if (fn === OPS.setFont) {
        this.setFont(args[0], args[1], commonObjs);
      } else if (fn === OPS.setLeading) {
        this.setLeading(args[0]);
      } else if (fn === OPS.setCharSpacing) {
        this.setCharSpacing(args[0]);
      } else if (fn === OPS.setWordSpacing) {
        this.setWordSpacing(args[0]);
      } else if (fn === OPS.setHorizontalScaling) {
        this.setHorizontalScaling(args[0]);
      } else if (fn === OPS.setTextRise) {
        this.setTextRise(args[0]);
      } else if (fn === OPS.setRenderMode) {
        this.setRenderMode(args[0]);
      } else if (fn === OPS.showText || fn === OPS.showSpacedText) {
        const glyphArr = args[0] || [];
        for (const item of glyphArr) {
          if (typeof item === 'number') {
            const kernPt = (item / 1000) * this.fontSize * this.hScale;
            this.tm[4] -= kernPt;
          } else if (item && typeof item === 'object') {
            const char = item.unicode || (item.fontChar && !isPua(item.fontChar) ? item.fontChar : '');
            if (!char) {
              const w = (item.width || 0) * 0.001 * this.fontSize * this.hScale;
              this.tm[4] += w;
              continue;
            }
            const charWidth = (item.width || 500) * 0.001 * this.fontSize * this.hScale;
            const pt = applyMatrixToPoint(this.currentCtm, this.tm[4], this.tm[5]);
            this.addGlyph(
              char,
              pt.x,
              pt.y,
              charWidth,
              this.fontSize,
              this.fontSize,
              this.fontKey,
              this.fillColor
            );
            this.tm[4] += charWidth + this.charSpacing + (item.isSpace ? this.wordSpacing : 0);
          }
        }
      } else if (fn === OPS.setLineWidth) {
        this.setLineWidth(args[0]);
      } else if (fn === OPS.setStrokeRGBColor) {
        this.setStrokeColorRgb(args[0], args[1], args[2]);
      } else if (fn === OPS.setFillRGBColor) {
        this.setFillColorRgb(args[0], args[1], args[2]);
      } else if (fn === OPS.setStrokeGray) {
        this.setStrokeColorGray(args[0]);
      } else if (fn === OPS.setFillGray) {
        this.setFillColorGray(args[0]);
      } else if (fn === OPS.setStrokeCMYKColor) {
        this.setStrokeColorCmyk(args[0], args[1], args[2], args[3]);
      } else if (fn === OPS.setFillCMYKColor) {
        this.setFillColorCmyk(args[0], args[1], args[2], args[3]);
      } else if (fn === OPS.constructPath) {
        currentPathRects = [];
        currentPathLines = [];
        const ops = args[0];
        const pathArgs = args[1];
        let argIdx = 0;

        for (const subOp of ops) {
          if (subOp === 19) {
            // rectangle: [x, y, w, h]
            const x = pathArgs[argIdx++];
            const y = pathArgs[argIdx++];
            const w = pathArgs[argIdx++];
            const h = pathArgs[argIdx++];
            currentPathRects.push({ x, y, w, h });
          } else if (subOp === 13) {
            // moveTo
            currentPoint = { x: pathArgs[argIdx++], y: pathArgs[argIdx++] };
          } else if (subOp === 14) {
            // lineTo
            const nextX = pathArgs[argIdx++];
            const nextY = pathArgs[argIdx++];
            currentPathLines.push({
              x0: currentPoint.x,
              y0: currentPoint.y,
              x1: nextX,
              y1: nextY,
            });
            currentPoint = { x: nextX, y: nextY };
          } else if (subOp === 15) {
            // curveTo
            argIdx += 6;
          } else if (subOp === 16 || subOp === 17) {
            argIdx += 4;
          }
        }
      } else if (fn === OPS.stroke || fn === OPS.closeStroke) {
        // Emit strokes for current path
        for (const r of currentPathRects) {
          const pt1 = applyMatrixToPoint(this.currentCtm, r.x, r.y);
          const pt2 = applyMatrixToPoint(this.currentCtm, r.x + r.w, r.y + r.h);
          const x0 = Math.min(pt1.x, pt2.x);
          const x1 = Math.max(pt1.x, pt2.x);
          const y0 = this.pageHeight - Math.max(pt1.y, pt2.y);
          const y1 = this.pageHeight - Math.min(pt1.y, pt2.y);
          this.addStroke('rect', [x0, y0, x1 - x0, y1 - y0], this.lineWidth, this.strokeColor);
        }
        for (const l of currentPathLines) {
          const p1 = applyMatrixToPoint(this.currentCtm, l.x0, l.y0);
          const p2 = applyMatrixToPoint(this.currentCtm, l.x1, l.y1);
          this.addStroke(
            'line',
            [p1.x, this.pageHeight - p1.y, p2.x, this.pageHeight - p2.y],
            this.lineWidth,
            this.strokeColor
          );
        }
        currentPathRects = [];
        currentPathLines = [];
      } else if (fn === OPS.fill || fn === OPS.eoFill) {
        // Emit fills for current path
        for (const r of currentPathRects) {
          const pt1 = applyMatrixToPoint(this.currentCtm, r.x, r.y);
          const pt2 = applyMatrixToPoint(this.currentCtm, r.x + r.w, r.y + r.h);
          const x0 = Math.min(pt1.x, pt2.x);
          const x1 = Math.max(pt1.x, pt2.x);
          const y0 = this.pageHeight - Math.max(pt1.y, pt2.y);
          const y1 = this.pageHeight - Math.min(pt1.y, pt2.y);
          this.addFill({ x0, y0, x1, y1 }, this.fillColor);
        }
        currentPathRects = [];
        currentPathLines = [];
      } else if (
        fn === OPS.fillStroke ||
        fn === OPS.eoFillStroke ||
        fn === OPS.closeFillStroke ||
        fn === OPS.closeEOFillStroke
      ) {
        for (const r of currentPathRects) {
          const pt1 = applyMatrixToPoint(this.currentCtm, r.x, r.y);
          const pt2 = applyMatrixToPoint(this.currentCtm, r.x + r.w, r.y + r.h);
          const x0 = Math.min(pt1.x, pt2.x);
          const x1 = Math.max(pt1.x, pt2.x);
          const y0 = this.pageHeight - Math.max(pt1.y, pt2.y);
          const y1 = this.pageHeight - Math.min(pt1.y, pt2.y);
          this.addFill({ x0, y0, x1, y1 }, this.fillColor);
          this.addStroke('rect', [x0, y0, x1 - x0, y1 - y0], this.lineWidth, this.strokeColor);
        }
        for (const l of currentPathLines) {
          const p1 = applyMatrixToPoint(this.currentCtm, l.x0, l.y0);
          const p2 = applyMatrixToPoint(this.currentCtm, l.x1, l.y1);
          this.addStroke(
            'line',
            [p1.x, this.pageHeight - p1.y, p2.x, this.pageHeight - p2.y],
            this.lineWidth,
            this.strokeColor
          );
        }
        currentPathRects = [];
        currentPathLines = [];
      }
    }
  }
}
