import { describe, it, expect } from 'vitest';
import {
  ptToTwips,
  twipsToPt,
  ptToHalfPoints,
  halfPointsToPt,
  ptToEmu,
  emuToPt,
  inchesToPt,
  ptToInches,
} from '../../src/core/units.js';

describe('Units conversions (§4.1)', () => {
  it('converts pt to twips and back', () => {
    expect(ptToTwips(72)).toBe(1440); // 1 inch = 72 pt = 1440 twips
    expect(twipsToPt(1440)).toBe(72);
  });

  it('converts pt to half-points and back', () => {
    expect(ptToHalfPoints(12)).toBe(24);
    expect(halfPointsToPt(24)).toBe(12);
  });

  it('converts pt to EMU and back', () => {
    expect(ptToEmu(1)).toBe(12700);
    expect(emuToPt(12700)).toBe(1);
  });

  it('converts inches to pt and back', () => {
    expect(inchesToPt(8.5)).toBe(612); // standard letter width
    expect(ptToInches(612)).toBe(8.5);
  });
});
