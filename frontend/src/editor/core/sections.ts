// core/sections.ts
// Section detection and drag-and-drop reordering for Reflow blocks.
import type { Block } from './types.ts'

export type Section = { id: string; title: string; blockIds: string[]; page: number }

export function findSections(blocks: Block[]): Section[] {
  const out: Section[] = []
  for (const b of blocks.filter((x) => x.included)) {
    if (b.role === 'heading' || !out.length) {
      out.push({ id: `s_${b.id}`, title: b.role === 'heading' ? b.text : 'Introduction', blockIds: [b.id], page: b.page })
    } else {
      out[out.length - 1].blockIds.push(b.id)
    }
  }
  return out
}
