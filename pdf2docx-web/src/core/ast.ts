import { Rect } from './pageir.js';

export type Run = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  size?: number; // font size in pt
  color?: string; // "#RRGGBB"
  font?: string;
  sup?: boolean;
  sub?: boolean;
  link?: { url?: string; anchor?: string };
  highlight?: string;
};

export type BorderStyle = 'single' | 'dashed' | 'dotted' | 'double' | 'nil';
export type BorderDef = {
  style: BorderStyle;
  size: number; // in eighths of a point
  color: string;
};

export type Borders = {
  top?: BorderDef;
  right?: BorderDef;
  bottom?: BorderDef;
  left?: BorderDef;
};

export type Para = {
  type: 'p';
  runs: Run[];
  align: 'left' | 'center' | 'right' | 'justify';
  indent?: { left: number; first: number; right: number }; // in pt
  spaceBefore?: number; // in pt
  spaceAfter?: number; // in pt
  lineSpacing?: number; // line spacing multiple
  heading?: 1 | 2 | 3 | 4;
  list?: {
    id: string;
    level: number;
    kind: 'bullet' | 'number';
    fmt?: string;
  };
  shading?: string;
  borders?: Borders;
  keepNext?: boolean;
  src?: { page: number; box: Rect };
};

export type Cell = {
  blocks: Block[];
  colSpan: number;
  rowSpan: number;
  vMergeContinue?: boolean;
  fill?: string;
  borders?: Borders;
  vAlign?: 'top' | 'center' | 'bottom';
  width: number; // in pt
};

export type TableRow = {
  cells: Cell[];
  height?: number; // in pt
  header?: boolean;
};

export type Table = {
  type: 'tbl';
  colWidths: number[]; // in pt
  rows: TableRow[];
  borders?: Borders;
  src?: { page: number; box: Rect };
};

export type AnchorSpec = {
  relativeHorizontal: 'margin' | 'page' | 'column';
  relativeVertical: 'margin' | 'page' | 'paragraph';
  x: number;
  y: number;
  wrap: 'square' | 'tight' | 'topAndBottom' | 'none';
};

export type ImageBlock = {
  type: 'img';
  ref: string; // key into binary store
  w: number; // in pt
  h: number; // in pt
  inline: boolean;
  anchor?: AnchorSpec;
  src?: { page: number; box: Rect };
};

export type PageBreakBlock = {
  type: 'pagebreak';
};

export type SectionProps = {
  page: {
    w: number;
    h: number;
    orient: 'portrait' | 'landscape';
  };
  margins: {
    t: number;
    r: number;
    b: number;
    l: number;
  };
  cols?: {
    count: number;
    gap: number;
  };
};

export type SectionBreakBlock = {
  type: 'sectionBreak';
  sect: SectionProps;
};

export type Block = Para | Table | ImageBlock | PageBreakBlock | SectionBreakBlock;

export type Section = SectionProps & {
  header?: Block[];
  footer?: Block[];
  blocks: Block[];
};

export type NumberingDef = {
  id: string;
  kind: 'bullet' | 'number';
  levels: {
    level: number;
    format: 'decimal' | 'lowerLetter' | 'upperLetter' | 'lowerRoman' | 'upperRoman' | 'bullet';
    text: string;
  }[];
};

export type StyleDef = {
  id: string;
  name: string;
  basedOn?: string;
  run?: Partial<Run>;
  para?: Partial<Para>;
};

export type Warning = {
  stage: string;
  page?: number;
  message: string;
  fatal?: boolean;
};

export type DocAST = {
  sections: Section[];
  numbering: NumberingDef[];
  styles: StyleDef[];
  meta: {
    title?: string;
    creator?: string;
    pages: number;
    warnings: Warning[];
  };
};
