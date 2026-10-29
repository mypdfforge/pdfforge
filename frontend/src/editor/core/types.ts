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
export type DocState = {
  name: string; pages: PageModel[]; els: Record<string, TextElement>; order: string[]
  mode: 'design' | 'reflow'; blocks: Block[] | null
  contentBottom: number[] // per page: lowest y (PDF) text may reach in reflow
}

export type Draw =
  | { kind: 'text'; x: number; y: number; text: string; family: Family; bold: boolean; italic: boolean; size: number; color: RGB; tc: number; tw: number; underline: boolean; strike: boolean; width: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; color: RGB }
export type PlanPage = { src: number | null; w: number; h: number; edits: OpEdit[]; draws: Draw[] }
export type Plan = { pages: PlanPage[] }
export type BuildReport = { warnings: string[]; pageCount: number }
