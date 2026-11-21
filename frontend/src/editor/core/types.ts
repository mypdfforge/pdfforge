import type { Rect, PageBox } from './geometry.ts'
import type { RGB, OpEdit } from './contentStream.ts'
import type { Family, Fidelity } from './fonts.ts'
export type { Rect, PageBox, RGB, OpEdit, Family, Fidelity }

export type Align = 'left' | 'center' | 'right' | 'justify'
export type TextStyle = {
  family: Family; bold: boolean; italic: boolean; underline: boolean; strike: boolean
  size: number; color: RGB; highlight: RGB | null
  charSpacing: number; wordSpacing: number; align: Align; lineHeight: number // lineHeight = multiple of size
}
export type PageModel = PageBox & { index: number; editable: boolean; reason: string | null; images: number; paints: number; added?: boolean }

export type TextElement = {
  id: string; page: number
  text: string; originalText: string
  style: TextStyle; originalStyle: TextStyle
  origBox: Rect; x: number; baseline: number; origX: number; origBaseline: number
  maxW: number // allowed width (original text-region boundary), not the page edge
  wrap: boolean // Design Lock: wrap onto extra lines inside maxW instead of one overflowing line
  movable: boolean // original drawing can be translated in place (no dependence on a neighbouring advance)
  ops: number[] // content-stream instructions that draw this text (removed on export when edited)
  locked: string | null // reason this text cannot be safely edited in place
  cover: RGB | null // set only when the user explicitly accepts "cover & replace" for a locked element
  mappedFont: string; fidelity: Fidelity; fontNote: string | null
  deleted: boolean; created: boolean
  list?: ListInfo | null
}

export type ListKind = 'bullet' | 'number'

export type ListInfo = {
  kind: ListKind
  marker: string            // '●' | '•' | '1.' — as shown/edited in the text
  indent: number            // pt from element x to body x (hanging indent)
  start: number             // first ordinal (numbered lists)
  externalId: string | null // companion glyph element kept alive to DRAW the marker
}

export type Role = 'heading' | 'paragraph' | 'bullet'
export type Block = {
  id: string; page: number; lineIds: string[]; role: Role; included: boolean
  text: string; edited: boolean; style: TextStyle
  x: number; width: number; top: number; bottom: number; spaceBefore: number
  pitchK: number // original baseline pitch / font size
  followers: Array<{ id: string; line: number }> // same-row items (e.g. right-aligned dates) that travel with a line
  spacing: number // user multiplier for paragraph spacing
}
export type Squeeze = {
  gapScale: number     // 1 = original inter-row gaps; 0.6 = 40% tighter
  lineHeightK: number  // 1 = original leading; 0.9 = 10% tighter
  sizeDelta: number    // pt added to every font size (negative = shrink). 0 = no redraw of unedited text.
}

export type FlowSettings = { enabled: boolean; squeeze: Squeeze | null; bodySize?: number; pitchRatio?: number }

export type GraphicRule = {
  id: string; page: number
  ops: number[]        // content-stream instruction indices (removed only when the rule moves)
  rect: Rect           // PDF points, bottom-left origin
  color: RGB
  anchorId: string | null  // text element it travels with (nearest heading above)
}

export type FlowObject = {
  id: string
  page: number
  kind: 'image' | 'rule' | 'vector'
  rect: Rect
  ops: number[]
  color: RGB                       // rules only (redraw path)
  flow: 'inline' | 'anchored' | 'pinned'
  anchorId: string | null          // anchored: travels with this text element
  keepTogetherId: string | null    // figure + caption group
  translatable: boolean            // ops form a safe, state-neutral CTM range
  locked: string | null
}

export type TableCell = { r: number; c: number; elIds: string[]; rect: Rect }
export type TableModel = {
  id: string
  page: number
  rect: Rect
  xs: number[]                     // grid lines, PDF pts (xs ascending, ys descending)
  ys: number[]
  cells: TableCell[]
  ruleOps: number[]
  ruleColor: RGB
  headerRows: number
  padX: number
  padY: number
  confidence: 'high' | 'low'       // low = borderless guess, needs user confirmation
}

export type DocState = {
  name: string; pages: PageModel[]; els: Record<string, TextElement>; order: string[]
  mode: 'design' | 'reflow'; blocks: Block[] | null
  contentBottom: number[] // per page: lowest y (PDF) text may reach in reflow
  flow?: FlowSettings      // absent => legacy Design Lock, byte-identical
  rules?: GraphicRule[]    // absent => no graphic followers
  objects?: FlowObject[]
  tables?: TableModel[]
}

export type Draw =
  | { kind: 'text'; x: number; y: number; text: string; family: Family; bold: boolean; italic: boolean; size: number; color: RGB; tc: number; tw: number; underline: boolean; strike: boolean; width: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; color: RGB }
export type PlanPage = { src: number | null; w: number; h: number; edits: OpEdit[]; draws: Draw[] }
export type Plan = { pages: PlanPage[] }
export type BuildReport = { warnings: string[]; pageCount: number }
