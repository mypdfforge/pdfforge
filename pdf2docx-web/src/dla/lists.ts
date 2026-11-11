import { Run, Para } from '../core/ast.js';
import { TextLine } from './lines.js';
import { params } from '../core/params.js';

export type ListMarkerInfo = {
  kind: 'bullet' | 'number';
  markerText: string;
  format?: string;
  level: number;
};

const BULLET_REGEX = /^([•●○◦▪■□–—·*‣⁃\uF0B7\uF0A7\uF076])\s*/;
const NUMBER_DECIMAL_REGEX = /^(\(?\d{1,3}[.)])\s*/;
const NUMBER_LETTER_REGEX = /^(\(?[a-zA-Z][.)])\s*/;
const NUMBER_ROMAN_REGEX = /^(\(?[ivxlcdmIVXLCDM]{1,6}[.)])\s*/;
const NUMBER_LEGAL_REGEX = /^(\d+(\.\d+)+)\s*/;

export function detectListMarker(text: string, markerX: number = 0, baseX: number = 0): ListMarkerInfo | null {
  const trimmed = text.trimStart();
  const indent = Math.max(0, markerX - baseX);
  const level = Math.min(8, Math.max(0, Math.round(indent / params.list.levelPt)));

  // 1. Bullets
  const bulletMatch = trimmed.match(BULLET_REGEX);
  if (bulletMatch) {
    return {
      kind: 'bullet',
      markerText: bulletMatch[1],
      format: 'bullet',
      level,
    };
  }

  // 2. Legal numbering: 1.1.1
  const legalMatch = trimmed.match(NUMBER_LEGAL_REGEX);
  if (legalMatch) {
    return {
      kind: 'number',
      markerText: legalMatch[1],
      format: 'decimal',
      level,
    };
  }

  // 3. Decimal numbering: 1., 1), (1)
  const decimalMatch = trimmed.match(NUMBER_DECIMAL_REGEX);
  if (decimalMatch) {
    return {
      kind: 'number',
      markerText: decimalMatch[1],
      format: 'decimal',
      level,
    };
  }

  // 4. Roman numbering: i., iv), (iv)
  const romanMatch = trimmed.match(NUMBER_ROMAN_REGEX);
  if (romanMatch) {
    return {
      kind: 'number',
      markerText: romanMatch[1],
      format: 'lowerRoman',
      level,
    };
  }

  // 5. Letter numbering: a., B), (c)
  const letterMatch = trimmed.match(NUMBER_LETTER_REGEX);
  if (letterMatch) {
    const isUpper = letterMatch[1].toUpperCase() === letterMatch[1];
    return {
      kind: 'number',
      markerText: letterMatch[1],
      format: isUpper ? 'upperLetter' : 'lowerLetter',
      level,
    };
  }

  return null;
}

export function stripListMarkerFromRuns(runs: Run[], markerText: string): Run[] {
  if (runs.length === 0) return runs;

  let remainingMarker = markerText;
  const newRuns: Run[] = [];

  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (remainingMarker.length === 0) {
      newRuns.push(r);
      continue;
    }

    const trimmedText = r.text.trimStart();
    if (trimmedText.startsWith(remainingMarker)) {
      const stripped = trimmedText.slice(remainingMarker.length).trimStart();
      remainingMarker = '';
      if (stripped.length > 0) {
        newRuns.push({ ...r, text: stripped });
      }
    } else if (remainingMarker.startsWith(trimmedText)) {
      remainingMarker = remainingMarker.slice(trimmedText.length);
      // Consume whole run
    } else {
      newRuns.push(r);
    }
  }

  return newRuns.length > 0 ? newRuns : [{ text: '' }];
}
