export const hex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')
export const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
export const FONT_CSS = {
  Helvetica: "Helvetica, Arial, 'Liberation Sans', sans-serif",
  Times: "'Times New Roman', Times, 'Liberation Serif', serif",
  Courier: "'Courier New', Courier, 'Liberation Mono', monospace",
}
export const FAMILIES = [['Helvetica', 'Sans (Helvetica)'], ['Times', 'Serif (Times)'], ['Courier', 'Mono (Courier)']]
export const ago = (t) => { const s = Math.floor((Date.now() - t) / 1000); if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`; return new Date(t).toLocaleDateString() }
export const mb = (n) => (n / 1048576).toFixed(n > 1048576 * 10 ? 0 : 1) + ' MB'
/** Average colour around a box, sampled from the rendered canvas just outside it; null if the surroundings are not uniform. */
export function sampleBackground(canvas, rect, page, zoom) {
  try {
    const ctx = canvas.getContext('2d'), k = canvas.width / (page.width * zoom)
    const L = (rect.x - page.x0) * zoom * k, T = (page.y0 + page.height - (rect.y + rect.h)) * zoom * k, W = rect.w * zoom * k, H = rect.h * zoom * k
    const pts = [[L - 3, T - 3], [L + W + 3, T - 3], [L - 3, T + H + 3], [L + W + 3, T + H + 3], [L + W / 2, T - 3], [L + W / 2, T + H + 3]]
    const px = pts.map(([x, y]) => ctx.getImageData(Math.max(0, Math.min(canvas.width - 1, x)), Math.max(0, Math.min(canvas.height - 1, y)), 1, 1).data)
    const avg = [0, 1, 2].map((i) => px.reduce((s, p) => s + p[i], 0) / px.length)
    const spread = Math.max(...[0, 1, 2].map((i) => Math.max(...px.map((p) => Math.abs(p[i] - avg[i])))))
    return spread < 10 ? { color: avg.map((v) => v / 255), uniform: true } : { color: [1, 1, 1], uniform: false }
  } catch { return { color: [1, 1, 1], uniform: false } }
}
