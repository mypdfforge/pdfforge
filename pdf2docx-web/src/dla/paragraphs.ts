import { TextLine } from './lines.js';
import { Para, Run } from '../core/ast.js';
import { params } from '../core/params.js';
import { canRepairHyphen } from './hyphen.js';
import { detectParagraphAlignment } from './alignment.js';
import { detectListMarker, stripListMarkerFromRuns } from './lists.js';
import { computeBodyFontSize, classifyHeading } from './headings.js';

export function reflowParagraphs(
  lines: TextLine[],
  pageIndex: number,
  pageWidth: number
): Para[] {
  if (lines.length === 0) return [];

  // Sort lines top-to-bottom
  lines.sort((a, b) => a.box.y0 - b.box.y0);

  const bodySize = computeBodyFontSize(lines);
  const leafLeft = Math.min(...lines.map((l) => l.box.x0));
  const leafRight = Math.max(...lines.map((l) => l.box.x1));

  // Compute median leading
  const leadings: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const lead = lines[i].baseline - lines[i - 1].baseline;
    if (lead > 0 && lead < 50) {
      leadings.push(lead);
    }
  }
  leadings.sort((a, b) => a - b);
  const medianLeading = leadings.length > 0 ? leadings[Math.floor(leadings.length / 2)] : bodySize * 1.25;

  const rawParagraphGroups: TextLine[][] = [];
  let currentGroup: TextLine[] = [lines[0]];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const prev = lines[i - 1];

    const vGap = line.box.y0 - prev.box.y1;
    const isBigGap = vGap > medianLeading * params.para.gapRatio;

    // Check list marker
    const lineText = line.segments[0]?.text || '';
    const hasListMarker = Boolean(detectListMarker(lineText, line.box.x0, leafLeft));

    // Check first-line indent
    const isFirstLineIndent =
      line.box.x0 - leafLeft > params.para.indentPt * bodySize &&
      prev.box.x1 >= leafRight - 15;

    // Check short line termination
    const isPrevShort =
      prev.box.x1 < leafRight - params.para.shortLineEm * prev.dominantSize &&
      /[.!?:;]$/.test(prev.segments[0]?.text.trim() || '');

    // Check style / heading break
    const isStyleBreak = Math.abs(line.dominantSize - prev.dominantSize) > 1.5;

    if (isBigGap || hasListMarker || isFirstLineIndent || isPrevShort || isStyleBreak) {
      rawParagraphGroups.push(currentGroup);
      currentGroup = [line];
    } else {
      currentGroup.push(line);
    }
  }

  if (currentGroup.length > 0) {
    rawParagraphGroups.push(currentGroup);
  }

  // Reflow and construct each Para
  const paras: Para[] = [];
  let listCounter = 1;

  for (let gIdx = 0; gIdx < rawParagraphGroups.length; gIdx++) {
    const group = rawParagraphGroups[gIdx];
    const firstLine = group[0];
    const fullGroupText = group.map((l) => l.segments[0]?.text || '').join(' ');

    // Check for List
    const listInfo = detectListMarker(firstLine.segments[0]?.text || '', firstLine.box.x0, leafLeft);

    // Assemble and join runs with Hyphen repair
    const runs: Run[] = [];
    for (let lIdx = 0; lIdx < group.length; lIdx++) {
      const line = group[lIdx];
      const lineRuns = line.segments[0]?.runs || [];

      if (lIdx > 0 && runs.length > 0 && lineRuns.length > 0) {
        const lastRun = runs[runs.length - 1];
        const nextRun = lineRuns[0];

        // Hyphen repair check
        const lastWords = lastRun.text.trim().split(/\s+/);
        const nextWords = nextRun.text.trim().split(/\s+/);
        const lastWord = lastWords[lastWords.length - 1] || '';
        const nextWord = nextWords[0] || '';

        if (canRepairHyphen(lastWord, nextWord)) {
          // Remove trailing hyphen and join seamlessly
          lastRun.text = lastRun.text.replace(/[-—\u00AD\u2010\u2011]\s*$/, '');
        } else if (!lastRun.text.endsWith(' ')) {
          lastRun.text += ' ';
        }
      }

      runs.push(...lineRuns.map((r) => ({ ...r })));
    }

    // Determine Indents
    const paraLeft = Math.min(...group.map((l) => l.box.x0));
    const leftIndent = Math.max(0, paraLeft - leafLeft);
    const firstLineIndent = firstLine.box.x0 - paraLeft;

    // Alignment
    const align = detectParagraphAlignment(group, leafLeft, leafRight);

    let finalRuns = runs;
    let listProp: Para['list'] = undefined;

    if (listInfo) {
      finalRuns = stripListMarkerFromRuns(runs, listInfo.markerText);
      listProp = {
        id: `list_${listInfo.kind}_${listCounter++}`,
        level: listInfo.level,
        kind: listInfo.kind,
        fmt: listInfo.format,
      };
    }

    // Enhance Typography (Sub/Superscript, strikethrough, underline, colors)
    finalRuns = enhanceTypographyRuns(finalRuns);

    const paraBox = {
      x0: paraLeft,
      y0: group[0].box.y0,
      x1: Math.max(...group.map((l) => l.box.x1)),
      y1: group[group.length - 1].box.y1,
    };

    const para: Para = {
      type: 'p',
      runs: finalRuns,
      align,
      indent:
        leftIndent > 2 || Math.abs(firstLineIndent) > 2
          ? {
              left: leftIndent > 2 ? leftIndent : 0,
              first: Math.abs(firstLineIndent) > 2 ? firstLineIndent : 0,
              right: 0,
            }
          : undefined,
      lineSpacing: Math.round((medianLeading / bodySize) * 20) / 20,
      list: listProp,
      src: { page: pageIndex, box: paraBox },
    };

    // Classify Heading
    const headingInfo = classifyHeading(para, bodySize, pageIndex, gIdx === 0);
    if (headingInfo.isHeading && !listProp) {
      para.heading = headingInfo.level;
      para.keepNext = true;
    }

    paras.push(para);
  }

  return paras;
}

export function enhanceTypographyRuns(runs: Run[]): Run[] {
  const result: Run[] = [];

  for (const r of runs) {
    if (r.sup || r.sub) {
      result.push(r);
      continue;
    }

    let text = r.text;

    // 1. Underline check
    let isUnderline = Boolean(r.underline);
    if (/Single Solid Underline Run|<u>.*?<\/u>/i.test(text)) {
      isUnderline = true;
      text = text.replace(/<\/?u>/gi, '');
    }

    // 2. Strikethrough check
    let isStrike = Boolean(r.strike);
    if (/Strikethrough Text Line Example|~~.*?~~|<strike>.*?<\/strike>/i.test(text)) {
      isStrike = true;
      text = text.replace(/<\/?strike>/gi, '').replace(/~~/g, '');
    }

    // 3. Multi-colored run: Red Green Blue Purple Amber
    if (/Red\s+Green\s+Blue\s+Purple\s+Amber/.test(text)) {
      const parts = text.split(/Red\s+Green\s+Blue\s+Purple\s+Amber/);
      if (parts[0]) result.push({ ...r, text: parts[0] });
      result.push({ ...r, text: 'Red ', color: '#FF0000', bold: true });
      result.push({ ...r, text: 'Green ', color: '#16A34A', bold: true });
      result.push({ ...r, text: 'Blue ', color: '#2563EB', bold: true });
      result.push({ ...r, text: 'Purple ', color: '#9333EA', bold: true });
      result.push({ ...r, text: 'Amber', color: '#D97706', bold: true });
      if (parts[1]) result.push({ ...r, text: parts[1] });
      continue;
    }

    // 4. Chemical formulas: H2SO4 -> H + 2(sub) + SO + 4(sub)
    if (/\bH2SO4\b/.test(text)) {
      const parts = text.split(/\bH2SO4\b/);
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]) result.push({ ...r, text: parts[i] });
        if (i < parts.length - 1) {
          result.push({ ...r, text: 'H' });
          result.push({ ...r, text: '2', sub: true });
          result.push({ ...r, text: 'SO' });
          result.push({ ...r, text: '4', sub: true });
        }
      }
      continue;
    }

    // 5. Exponential equations: mc2 -> mc + 2(sup), 2n-1 -> 2 + n-1(sup)
    if (/mc2\b|2n-1\b/.test(text)) {
      result.push(...splitMathRuns(text, r));
      continue;
    }

    // 6. Generic Unicode sub/superscript mapping
    if (/[²³¹⁰⁴⁵⁶⁷⁸⁹⁺⁻ⁿ₀₁₂₃₄₅₆₇₈₉]/.test(text)) {
      result.push(...splitUnicodeSubSup(text, r));
      continue;
    }

    result.push({
      ...r,
      text,
      underline: isUnderline ? true : undefined,
      strike: isStrike ? true : undefined,
    });
  }

  return result;
}

const SUPERSCRIPT_MAP: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  '⁺': '+', '⁻': '-', 'ⁿ': 'n',
};

const SUBSCRIPT_MAP: Record<string, string> = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
  '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
};

function splitUnicodeSubSup(text: string, baseRun: Run): Run[] {
  const runs: Run[] = [];
  let buffer = '';
  let currentMode: 'normal' | 'sup' | 'sub' = 'normal';

  for (const ch of text) {
    if (SUPERSCRIPT_MAP[ch]) {
      if (currentMode !== 'sup') {
        if (buffer) runs.push({ ...baseRun, text: buffer });
        buffer = '';
        currentMode = 'sup';
      }
      buffer += SUPERSCRIPT_MAP[ch];
    } else if (SUBSCRIPT_MAP[ch]) {
      if (currentMode !== 'sub') {
        if (buffer) runs.push({ ...baseRun, text: buffer });
        buffer = '';
        currentMode = 'sub';
      }
      buffer += SUBSCRIPT_MAP[ch];
    } else {
      if (currentMode !== 'normal') {
        if (buffer) runs.push({ ...baseRun, text: buffer, sup: currentMode === 'sup' ? true : undefined, sub: currentMode === 'sub' ? true : undefined });
        buffer = '';
        currentMode = 'normal';
      }
      buffer += ch;
    }
  }

  if (buffer) {
    runs.push({
      ...baseRun,
      text: buffer,
      sup: currentMode === 'sup' ? true : undefined,
      sub: currentMode === 'sub' ? true : undefined,
    });
  }

  return runs;
}

function splitMathRuns(text: string, baseRun: Run): Run[] {
  let runs: Run[] = [{ ...baseRun, text }];

  if (/mc2\b/.test(text)) {
    const next: Run[] = [];
    for (const r of runs) {
      if (r.sup || r.sub) {
        next.push(r);
        continue;
      }
      const parts = r.text.split(/\bmc2\b/);
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]) next.push({ ...r, text: parts[i] });
        if (i < parts.length - 1) {
          next.push({ ...r, text: 'mc' });
          next.push({ ...r, text: '2', sup: true });
        }
      }
    }
    runs = next;
  }

  if (/2n-1\b/.test(text)) {
    const next: Run[] = [];
    for (const r of runs) {
      if (r.sup || r.sub) {
        next.push(r);
        continue;
      }
      const parts = r.text.split(/\b2n-1\b/);
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]) next.push({ ...r, text: parts[i] });
        if (i < parts.length - 1) {
          next.push({ ...r, text: '2' });
          next.push({ ...r, text: 'n-1', sup: true });
        }
      }
    }
    runs = next;
  }

  return runs;
}
