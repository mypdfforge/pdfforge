// core/fontSynth.ts
// Intelligent font-metric synthesis: analyzes Cap-Height, X-Height, and average character widths
// to select the closest standard family and compute tracking (charSpacing) compensation.
import type { Family } from './types.ts'

export type FontSample = { text: string; size: number; advances: number[]; capHeight: number; xHeight: number }
export type SynthMatch = { family: Family; size: number; charSpacing: number; note: string }

const CANDIDATES: Array<{ css: string; family: Family }> = [
  { css: 'Helvetica, Arial, sans-serif', family: 'Helvetica' },
  { css: '"Times New Roman", Times, serif', family: 'Times' },
  { css: '"Courier New", Courier, monospace', family: 'Courier' },
]
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length)

export function synthesizeFontMatch(sample: FontSample): SynthMatch {
  if (typeof document === 'undefined') {
    return { family: 'Helvetica', size: sample.size, charSpacing: 0, note: 'Default fallback' }
  }
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return { family: 'Helvetica', size: sample.size, charSpacing: 0, note: 'Default fallback' }
  }
  const chars = [...sample.text].filter((c) => c !== ' ' && c.charCodeAt(0) > 32)
  const origAdv = mean(sample.advances) / sample.size            // advance ratio per pt of size
  let best: SynthMatch | null = null, bestErr = Infinity

  for (const cand of CANDIDATES) {
    ctx.font = `${sample.size}px ${cand.css}`
    const adv = mean(chars.map((c) => ctx.measureText(c).width)) / sample.size
    const cap = (ctx.measureText('H').actualBoundingBoxAscent || sample.size * 0.7) / sample.size
    const xh = (ctx.measureText('x').actualBoundingBoxAscent || sample.size * 0.5) / sample.size
    // Match cap-height first (visual size), then penalize advance + x-height mismatch.
    const size = Math.min(sample.size * 1.04, Math.max(sample.size * 0.96, sample.size * (sample.capHeight / sample.size) / cap))
    ctx.font = `${size}px ${cand.css}`
    const advAtSize = mean(chars.map((c) => ctx.measureText(c).width))
    const err = Math.abs(adv - origAdv) * 3 + Math.abs(xh - sample.xHeight / sample.size) + Math.abs(cap - sample.capHeight / sample.size) * 2
    if (err < bestErr) {
      bestErr = err
      const tc = Math.max(-0.6, Math.min(0.6, mean(sample.advances) - advAtSize)) // per-char pt compensation
      best = { family: cand.family, size: Math.round(size * 100) / 100, charSpacing: Math.round(tc * 1000) / 1000,
        note: `Matched ${cand.family} (cap-height ${Math.round((cap * size) * 10) / 10} pt, tracking ${tc >= 0 ? '+' : ''}${tc.toFixed(2)} pt).` }
    }
  }
  return best || { family: 'Helvetica', size: sample.size, charSpacing: 0, note: 'Fallback' }
}
