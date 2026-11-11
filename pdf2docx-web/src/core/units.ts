/**
 * Units conversion module (§4.1)
 * PDF space: pt (points)
 * Word space: twips (1/20 pt), half-points (1/2 pt), EMU (English Metric Units: 1 pt = 12700 EMU)
 */

export function ptToTwips(pt: number): number {
  if (!Number.isFinite(pt)) return 0;
  return Math.round(pt * 20);
}

export function twipsToPt(twips: number): number {
  if (!Number.isFinite(twips)) return 0;
  return twips / 20;
}

export function ptToHalfPoints(pt: number): number {
  if (!Number.isFinite(pt) || pt <= 0) return 22; // default 11pt = 22 half-pts
  return Math.round(pt * 2);
}

export function halfPointsToPt(hp: number): number {
  if (!Number.isFinite(hp)) return 11;
  return hp / 2;
}

export function ptToEmu(pt: number): number {
  if (!Number.isFinite(pt)) return 0;
  return Math.round(pt * 12700);
}

export function emuToPt(emu: number): number {
  if (!Number.isFinite(emu)) return 0;
  return emu / 12700;
}

export function inchesToPt(inches: number): number {
  if (!Number.isFinite(inches)) return 0;
  return inches * 72;
}

export function ptToInches(pt: number): number {
  if (!Number.isFinite(pt)) return 0;
  return pt / 72;
}

export function mmToPt(mm: number): number {
  if (!Number.isFinite(mm)) return 0;
  return (mm * 72) / 25.4;
}

export function ptToMm(pt: number): number {
  if (!Number.isFinite(pt)) return 0;
  return (pt * 25.4) / 72;
}
