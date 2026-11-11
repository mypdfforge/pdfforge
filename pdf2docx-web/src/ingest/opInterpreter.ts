import {
  Glyph,
  Stroke,
  Fill,
  ImageObj,
  FontInfo,
  Rect,
  PageIR,
} from '../core/pageir.js';
import { parseFontDescriptor } from './fontMap.js';

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
  return str
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

  // Colors
  private fillColor: string = '#000000';
  private strokeColor: string = '#000000';

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

  setFillColorRgb(r: number, g: number, b: number) {
    this.fillColor = rgbToHex(r * 255, g * 255, b * 255);
  }

  setStrokeColorRgb(r: number, g: number, b: number) {
    this.strokeColor = rgbToHex(r * 255, g * 255, b * 255);
  }

  setFillColorGray(g: number) {
    this.fillColor = rgbToHex(g * 255, g * 255, g * 255);
  }

  setStrokeColorGray(g: number) {
    this.strokeColor = rgbToHex(g * 255, g * 255, g * 255);
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

  setFont(fontName: string, size: number, fontFlags: number = 0) {
    this.fontSize = Math.abs(size);
    const info = parseFontDescriptor(fontName, fontFlags);
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
}
