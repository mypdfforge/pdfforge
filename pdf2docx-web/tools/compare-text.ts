/**
 * Text Comparison Metrics (§11.2)
 * CER = Levenshtein(pred, gold) / max(1, len(gold))
 */

export function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prevRow = new Array(n + 1);
  let currRow = new Array(n + 1);

  for (let j = 0; j <= n; j++) {
    prevRow[j] = j;
  }

  for (let i = 1; i <= m; i++) {
    currRow[0] = i;
    const c1 = s1.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const c2 = s2.charCodeAt(j - 1);
      const cost = c1 === c2 ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1, // deletion
        currRow[j - 1] + 1, // insertion
        prevRow[j - 1] + cost // substitution
      );
    }
    const temp = prevRow;
    prevRow = currRow;
    currRow = temp;
  }

  return prevRow[n];
}

export function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n+/g, '\n')
    .trim();
}

export function computeCER(pred: string, gold: string): number {
  const normPred = normalizeText(pred);
  const normGold = normalizeText(gold);
  if (normGold.length === 0) {
    return normPred.length === 0 ? 0 : 1.0;
  }
  const dist = levenshteinDistance(normPred, normGold);
  return dist / normGold.length;
}

export function computeGlyphF1(pred: string, gold: string): { precision: number; recall: number; f1: number } {
  const setPred = new Map<string, number>();
  const setGold = new Map<string, number>();

  for (const ch of pred) {
    setPred.set(ch, (setPred.get(ch) || 0) + 1);
  }
  for (const ch of gold) {
    setGold.set(ch, (setGold.get(ch) || 0) + 1);
  }

  let matches = 0;
  for (const [ch, count] of setPred.entries()) {
    if (setGold.has(ch)) {
      matches += Math.min(count, setGold.get(ch)!);
    }
  }

  const precision = pred.length > 0 ? matches / pred.length : 1;
  const recall = gold.length > 0 ? matches / gold.length : 1;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return { precision, recall, f1 };
}
