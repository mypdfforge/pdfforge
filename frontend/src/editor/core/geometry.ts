// Canonical geometry: PDF points, origin bottom-left (PDF user space). Zoom/CSS conversion is explicit here only.
export type Rect = { x: number; y: number; w: number; h: number }
export type Mat = [number, number, number, number, number, number]
export const IDENT: Mat = [1, 0, 0, 1, 0, 0]

/** PDF concatenation order: result = a x b (apply a first, then b). */
export const mul = (a: Mat, b: Mat): Mat => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
]
export const apply = (m: Mat, x: number, y: number): [number, number] =>
  [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

export type PageBox = { x0: number; y0: number; width: number; height: number }

/** PDF point -> CSS px inside the page element (unrotated pages). */
export const pdfToCss = (p: PageBox, zoom: number, x: number, y: number): [number, number] =>
  [(x - p.x0) * zoom, (p.y0 + p.height - y) * zoom]
export const cssToPdf = (p: PageBox, zoom: number, cx: number, cy: number): [number, number] =>
  [cx / zoom + p.x0, p.y0 + p.height - cy / zoom]
export const rectToCss = (p: PageBox, zoom: number, r: Rect) => {
  const [left, top] = pdfToCss(p, zoom, r.x, r.y + r.h)
  return { left, top, width: r.w * zoom, height: r.h * zoom }
}

export const rectRight = (r: Rect) => r.x + r.w
export const rectTop = (r: Rect) => r.y + r.h
export const intersects = (a: Rect, b: Rect, pad = 0) =>
  a.x < b.x + b.w - pad && a.x + a.w > b.x + pad && a.y < b.y + b.h - pad && a.y + a.h > b.y + pad
export const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}
export const verticalOverlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
