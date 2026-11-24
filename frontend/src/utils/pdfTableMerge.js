/** Stitch tables split across page breaks; mark the surviving header for repetition. */
export function stitchCrossPageTables(models, { widthTol = 3, bandRatio = 0.18 } = {}) {
  let merged = 0;
  for (let i = 0; i < models.length - 1; i++) {
    const A = models[i], B = models[i + 1];
    if (!A?.blocks?.length || !B?.blocks?.length) continue;
    const last = A.blocks[A.blocks.length - 1];
    const firstIdx = B.blocks.findIndex(b => b.type !== 'paragraph' || b.line?.text?.trim());
    const first = B.blocks[firstIdx];
    if (last?.type !== 'table' || first?.type !== 'table') continue;
    if (last.numCols !== first.numCols) continue;
    const same = (last.colWidths || []).every((w, k) => Math.abs(w - (first.colWidths?.[k] ?? -99)) <= widthTol);
    if (!same) continue;
    const nearBottom = (last.yMin ?? last.y ?? 0) <= A.h * bandRatio;
    const nearTop = (first.yMax ?? first.y ?? B.h) >= B.h * (1 - bandRatio);
    if (!nearBottom || !nearTop) continue;
    const rows = first.rows.slice();
    if (rows[0]?.isHeader && last.rows.some(r => r.isHeader)) rows.shift();  // drop repeated header
    last.rows.push(...rows);
    last.repeatHeader = true;
    if (last.rows[0]) last.rows[0].isHeader = true;
    B.blocks.splice(firstIdx, 1);
    merged++;
  }
  return merged;
}
