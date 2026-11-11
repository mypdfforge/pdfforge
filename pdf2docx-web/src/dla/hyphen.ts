/**
 * Hyphen Repair Module (§5 S6 step 5)
 * Repairs words split across line breaks by hyphens.
 * E.g. "commer-" + "cial" -> "commercial"
 * Preserves compound words (e.g. "well-known") and numeric/proper nouns.
 */

const HYPHEN_REGEX = /[-—\u00AD\u2010\u2011]$/;

export type HyphenRepairStats = {
  repairs: number;
  preservedCompounds: number;
};

export function canRepairHyphen(lastToken: string, nextToken: string): boolean {
  if (!HYPHEN_REGEX.test(lastToken)) return false;
  const leftPart = lastToken.replace(HYPHEN_REGEX, '');
  if (leftPart.length < 2) return false;

  // If nextToken starts with uppercase or digit, it's likely a proper noun or formula -> keep hyphen
  const firstChar = nextToken.charAt(0);
  if (firstChar >= 'A' && firstChar <= 'Z') return false;
  if (firstChar >= '0' && firstChar <= '9') return false;

  // If nextToken has punctuation or is too short (< 2), don't join
  const rightPart = nextToken.replace(/^[^\w]+|[^\w]+$/g, '');
  if (rightPart.length < 2) return false;

  return true;
}

export function repairHyphenatedPair(
  lastToken: string,
  nextToken: string,
  stats?: HyphenRepairStats
): { joined: string; repaired: boolean } {
  if (canRepairHyphen(lastToken, nextToken)) {
    const cleanLeft = lastToken.replace(HYPHEN_REGEX, '');
    if (stats) stats.repairs++;
    return {
      joined: cleanLeft + nextToken,
      repaired: true,
    };
  }

  if (stats && HYPHEN_REGEX.test(lastToken)) {
    stats.preservedCompounds++;
  }
  return {
    joined: lastToken + ' ' + nextToken,
    repaired: false,
  };
}
