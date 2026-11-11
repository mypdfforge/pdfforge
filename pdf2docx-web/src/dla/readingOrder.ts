import { CutNode } from './xycut.js';
import { TextLine } from './lines.js';

export function traverseReadingOrder(node: CutNode): TextLine[][] {
  const leaves: TextLine[][] = [];

  function walk(n: CutNode) {
    if (n.type === 'leaf') {
      if (n.lines.length > 0) {
        leaves.push(n.lines);
      }
      return;
    }

    if (n.children) {
      for (const child of n.children) {
        walk(child);
      }
    }
  }

  walk(node);
  return leaves;
}

export function verifyFlowOrder(leaves: TextLine[][]): { mismatches: number; confirmed: number } {
  let mismatches = 0;
  let confirmed = 0;

  for (let i = 0; i < leaves.length - 1; i++) {
    const leafA = leaves[i];
    const leafB = leaves[i + 1];
    if (leafA.length === 0 || leafB.length === 0) continue;

    const lastLineA = leafA[leafA.length - 1].segments[0]?.text.trim() || '';
    const firstLineB = leafB[0].segments[0]?.text.trim() || '';

    const endsWithTerminal = /[.!?]$/.test(lastLineA);
    const startsWithLower = /^[a-z]/.test(firstLineB);

    if (!endsWithTerminal && startsWithLower) {
      confirmed++;
    } else if (endsWithTerminal && startsWithLower) {
      mismatches++;
    }
  }

  return { mismatches, confirmed };
}

/**
 * Normalized Kendall's Tau distance for Reading Order (§11.2)
 * Returns a score between 0.0 (inverted) and 1.0 (exact match).
 */
export function computeKendallTau(orderPred: string[], orderGold: string[]): number {
  if (orderGold.length <= 1) return 1.0;

  const goldIndices = new Map<string, number>();
  orderGold.forEach((id, idx) => goldIndices.set(id, idx));

  let concordant = 0;
  let discordant = 0;

  const validItems = orderPred.filter((id) => goldIndices.has(id));
  const n = validItems.length;
  if (n <= 1) return 1.0;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const gI = goldIndices.get(validItems[i])!;
      const gJ = goldIndices.get(validItems[j])!;

      if ((gI < gJ && i < j) || (gI > gJ && i > j)) {
        concordant++;
      } else {
        discordant++;
      }
    }
  }

  const totalPairs = (n * (n - 1)) / 2;
  if (totalPairs === 0) return 1.0;

  return concordant / totalPairs;
}
