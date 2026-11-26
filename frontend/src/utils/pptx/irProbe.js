/**
 * irProbe.js — Validates pdf.js operator-list IR assumptions at startup.
 * Detects breaking shifts in OPS codes or constructPath / setGState shapes across
 * pdfjs-dist versions so callers can safely degrade to T2/T3 instead of corrupting output.
 */

const REQUIRED_OPS = [
  'save',
  'restore',
  'transform',
  'setGState',
  'setFillRGBColor',
  'setStrokeRGBColor',
  'constructPath',
  'fill',
  'stroke',
  'clip',
  'beginText',
  'setFont',
  'setTextMatrix',
  'showText',
  'paintImageXObject',
];

/**
 * Probes an OPS table (defaults to globalThis.pdfjsLib?.OPS) and optionally
 * a sample operatorList ({ fnArray, argsArray }) to verify expected IR shapes.
 * @returns {{ ok: boolean, reason?: string, missingOps: string[] }}
 */
export function probeOperatorIr(opsOverride, sampleOpList = null) {
  const OPS = opsOverride || globalThis.pdfjsLib?.OPS;
  if (!OPS || typeof OPS !== 'object') {
    return { ok: false, reason: 'OPS table unavailable', missingOps: REQUIRED_OPS };
  }

  const missingOps = REQUIRED_OPS.filter((k) => typeof OPS[k] !== 'number');
  if (missingOps.length > 0) {
    return {
      ok: false,
      reason: `Missing OPS codes: ${missingOps.join(', ')}`,
      missingOps,
    };
  }

  if (sampleOpList && Array.isArray(sampleOpList.fnArray) && Array.isArray(sampleOpList.argsArray)) {
    const { fnArray, argsArray } = sampleOpList;
    for (let i = 0; i < fnArray.length; i++) {
      if (fnArray[i] === OPS.constructPath) {
        const a = argsArray[i];
        // pdf.js >= 3.x constructPath IR: [ops[], coords[], minX, minY, maxX, maxY]
        const valid =
          Array.isArray(a) &&
          Array.isArray(a[0]) &&
          Array.isArray(a[1]) &&
          a.length >= 6 &&
          typeof a[2] === 'number';
        if (!valid) {
          return {
            ok: false,
            reason: 'Unexpected constructPath IR tuple shape',
            missingOps: [],
          };
        }
      }
      if (fnArray[i] === OPS.setGState) {
        const a = argsArray[i];
        if (!Array.isArray(a) || !Array.isArray(a[0])) {
          return {
            ok: false,
            reason: 'Unexpected setGState IR shape',
            missingOps: [],
          };
        }
      }
    }
  }

  return { ok: true, missingOps: [] };
}
