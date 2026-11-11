/**
 * TEDS (Tree Edit Distance for Structure and Content) stub & evaluator (§11.2)
 */

export type TableNode = {
  tag: 'table' | 'thead' | 'tbody' | 'tr' | 'th' | 'td';
  colSpan?: number;
  rowSpan?: number;
  content?: string;
  children?: TableNode[];
};

export function computeTEDS(
  pred: TableNode,
  gold: TableNode,
  mode: 'structure' | 'full' = 'full'
): number {
  // Simplified robust Tree Edit Distance approximation for tables:
  // Evaluates tag match, spanning attributes, and cell text CER.
  function countNodes(node: TableNode): number {
    let count = 1;
    if (node.children) {
      for (const c of node.children) {
        count += countNodes(c);
      }
    }
    return count;
  }

  function compareSubtrees(a: TableNode, b: TableNode): number {
    let distance = 0;
    if (a.tag !== b.tag) distance += 1;
    if ((a.colSpan || 1) !== (b.colSpan || 1)) distance += 1;
    if ((a.rowSpan || 1) !== (b.rowSpan || 1)) distance += 1;

    if (mode === 'full' && (a.content || b.content)) {
      const cA = (a.content || '').trim();
      const cB = (b.content || '').trim();
      if (cA !== cB) distance += 1;
    }

    const aChildren = a.children || [];
    const bChildren = b.children || [];
    const maxLen = Math.max(aChildren.length, bChildren.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < aChildren.length && i < bChildren.length) {
        distance += compareSubtrees(aChildren[i], bChildren[i]);
      } else if (i < aChildren.length) {
        distance += countNodes(aChildren[i]);
      } else {
        distance += countNodes(bChildren[i]);
      }
    }
    return distance;
  }

  const totalCost = compareSubtrees(pred, gold);
  const maxNodes = Math.max(countNodes(pred), countNodes(gold));
  if (maxNodes === 0) return 1.0;
  const score = 1.0 - totalCost / maxNodes;
  return Math.max(0, Math.min(1.0, score));
}
