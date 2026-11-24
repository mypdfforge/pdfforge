/** pdfNumbering.js — native list definitions for the robust pipeline. */
import { LevelFormat, AlignmentType } from 'docx';

const BULLETS = new Set([...'•●○◦▪■□–—·*‣⁃\uF0B7\uF0A7\uF076']);
const fmtOf = (p) => /^\d+$/.test(p) ? 'decimal'
  : /^[ivxlcdm]+$/.test(p) ? 'lowerRoman' : /^[IVXLCDM]+$/.test(p) ? 'upperRoman'
  : p === p.toUpperCase() ? 'upperLetter' : 'lowerLetter';
const LF = { decimal: LevelFormat.DECIMAL, lowerRoman: LevelFormat.LOWER_ROMAN,
             upperRoman: LevelFormat.UPPER_ROMAN, lowerLetter: LevelFormat.LOWER_LETTER,
             upperLetter: LevelFormat.UPPER_LETTER, bullet: LevelFormat.BULLET };

/** @returns {{kind,marker,level,parts,fmt}|null} */
export function parseListMarker(text, indentPt = 0, levelPt = 18) {
  const t = String(text || '').replace(/^[\s\u00A0]+/, '');
  const indentLevel = Math.min(8, Math.max(0, Math.round(indentPt / levelPt)));
  if (t && BULLETS.has(t[0])) return { kind: 'bullet', marker: t[0], level: indentLevel, parts: null, fmt: 'bullet' };
  const legal = t.match(/^(\d+(?:\.\d+)*(?:\.[a-zA-Z])?)[.)]?\s+/);
  if (legal) {
    const parts = legal[1].split('.');
    return { kind: 'number', marker: legal[1], level: Math.min(8, parts.length - 1), parts, fmt: fmtOf(parts[parts.length - 1]) };
  }
  const letter = t.match(/^\(?([a-zA-Z])[.)]\s+/);
  if (letter) return { kind: 'number', marker: letter[1], level: indentLevel, parts: [letter[1]], fmt: fmtOf(letter[1]) };
  const roman = t.match(/^\(?([ivxlcdmIVXLCDM]{1,6})[.)]\s+/);
  if (roman) return { kind: 'number', marker: roman[1], level: indentLevel, parts: [roman[1]], fmt: fmtOf(roman[1]) };
  return null;
}

/** "%1.%2.%3.%4" for 1.2.1.a ; "%1.%2." for 1.2 */
export function levelTextForDepth(depth, lastFmt = 'decimal') {
  const s = Array.from({ length: depth + 1 }, (_, i) => `%${i + 1}`).join('.');
  return lastFmt === 'decimal' ? s + '.' : s;
}

/** Walk every page's lines, group consecutive list items into restartable instances. */
export function buildDocumentNumbering(models, { levelPt = 18 } = {}) {
  const map = new Map();       // line object -> { reference, level, kind, marker }
  const instances = [];
  let cur = null, lastVal = new Map();
  const breakRun = () => { cur = null; lastVal = new Map(); };
  for (const m of models || []) {
    for (const l of m.lines || []) {
      const info = parseListMarker(l.text, Math.max(0, (l.x ?? 0) - (m.minX ?? 0)), levelPt);
      if (!info) { breakRun(); continue; }
      const v = info.parts && /^\d+$/.test(info.parts[info.level]) ? parseInt(info.parts[info.level], 10) : null;
      const restart = cur && (info.kind !== cur.kind ||
        (v != null && lastVal.get(info.level) != null && v < lastVal.get(info.level)));
      if (!cur || restart) {
        cur = { kind: info.kind, reference: `pdfforge-list-${instances.length + 1}`, maxDepth: 0, fmts: {} };
        instances.push(cur); lastVal = new Map();
      }
      cur.maxDepth = Math.max(cur.maxDepth, info.level);
      cur.fmts[info.level] = info.fmt;
      lastVal.set(info.level, v);
      map.set(l, { reference: cur.reference, level: info.level, kind: info.kind, marker: info.marker });
    }
    breakRun();
  }
  const config = instances.map((inst) => ({
    reference: inst.reference,
    levels: Array.from({ length: 9 }, (_, i) => {
      const fmt = inst.kind === 'bullet' ? 'bullet' : (inst.fmts[i] || 'decimal');
      return {
        level: i,
        format: LF[fmt] ?? LevelFormat.DECIMAL,
        text: inst.kind === 'bullet' ? ['•', '◦', '▪'][i % 3] : levelTextForDepth(i, fmt),
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: (i + 1) * 360, hanging: 360 } } },
      };
    }),
  }));
  return { config, map };
}

/** Remove the literal marker from the first span so Word renders it natively. */
export function stripMarker(spans, marker) {
  if (!spans?.length || !marker) return spans;
  const out = spans.map(s => ({ ...s }));
  const re = new RegExp(`^\\s*${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[.)]?\\s*`);
  for (const s of out) {
    if (!s.text) continue;
    if (re.test(s.text)) { s.text = s.text.replace(re, ''); break; }
    s.text = s.text.replace(/^\s+/, ''); break;
  }
  return out.filter(s => s.text);
}
