export type Rect = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type Glyph = {
  ch: string;
  box: Rect;
  baseline: number;
  size: number;
  fontKey: string;
  color: string; // "#RRGGBB"
  rot: 0 | 90 | 180 | 270;
  flags: number; // bit0: PUA/unmapped, bit1: synthetic space, bit2: invisible text
};

export type FontInfo = {
  key: string;
  pdfName: string;
  family: string;
  bold: boolean;
  italic: boolean;
  mono: boolean;
  serif: boolean;
  symbolic: boolean;
};

export type Stroke = {
  kind: 'line' | 'rect' | 'path';
  pts: number[];
  width: number;
  color: string;
  dash?: number[];
};

export type Fill = {
  box: Rect;
  color: string;
  alpha: number;
  z: number;
  pathPts?: number[];
};

export type ImageObj = {
  id: string;
  box: Rect;
  pixelW: number;
  pixelH: number;
  mime: 'image/png' | 'image/jpeg';
  dataRef: string; // key into binary store
  z: number;
  mask?: boolean;
};

export type LinkObj = {
  box: Rect;
  url?: string;
  destPage?: number;
};

export type PageIR = {
  pageIndex: number;
  width: number;
  height: number;
  rotation: number;
  glyphs: Glyph[];
  fonts: FontInfo[];
  strokes: Stroke[];
  fills: Fill[];
  images: ImageObj[];
  links: LinkObj[];
  stats: {
    glyphCount: number;
    puaCount: number;
  };
};

export type DocumentIR = {
  pages: PageIR[];
  binaryStore: Map<string, Uint8Array>;
  meta: {
    title?: string;
    author?: string;
    totalPages: number;
  };
};
