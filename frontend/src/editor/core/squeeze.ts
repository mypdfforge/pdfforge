// core/squeeze.ts
// One-click smart squeezer: micro-adjusts margins, leading, and font size
// to fit spilling content onto target page count without manual fiddling.
import type { DocState, Squeeze } from './types.ts'
import type { Measurer } from './fonts.ts'
import { cascadeVerticalShift } from './flow.ts'

export type SqueezeResult = { squeeze: Squeeze | null; pages: number; evaluations: number; tier: 1 | 2 | null }

export function fitToPage(doc: DocState, m: Measurer, target = 1): SqueezeResult {
  let evaluations = 0
  const pagesAt = (sq: Squeeze | null): number => {
    evaluations++
    return cascadeVerticalShift({ ...doc, flow: { enabled: true, squeeze: sq } }, m).pageCount
  }
  const base = pagesAt(null)
  if (base <= target) return { squeeze: null, pages: base, evaluations, tier: null }

  const knob = (t: number, withSize: boolean): Squeeze => ({
    gapScale: 1 - 0.40 * t,
    lineHeightK: 1 - 0.10 * t,
    sizeDelta: withSize ? -0.4 * t : 0,
  })
  for (const [tier, withSize] of [[1, false], [2, true]] as const) {
    let firstFit: number | null = null
    for (let i = 1; i <= 20; i++) {                          // coarse scan: 5% steps
      const t = i / 20
      if (pagesAt(knob(t, withSize)) <= target) { firstFit = t; break }
    }
    if (firstFit === null) continue
    let lo = firstFit - 0.05, hi = firstFit                  // refine: smallest tightening that fits
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2
      if (pagesAt(knob(mid, withSize)) <= target) hi = mid; else lo = mid
    }
    const sq = knob(hi, withSize)
    return { squeeze: sq, pages: pagesAt(sq), evaluations, tier }
  }
  return { squeeze: null, pages: pagesAt(knob(1, true)), evaluations, tier: null } // cannot fit even at max
}
