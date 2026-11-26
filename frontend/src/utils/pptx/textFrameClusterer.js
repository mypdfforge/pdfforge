/**
 * textFrameClusterer.js — Groups extracted PDF text spans into lines and logical
 * PowerPoint TextFrames with inferred alignment, line spacing, paragraph breaks,
 * bullet/numbered lists, and coalesced styled runs.
 */

import { CFG } from './config.js';
import { contains, intersects, unionRect } from './slideCoords.js';
import { resolveFont } from './fontResolver.js';

const BULLET_RE = /^\s*([•◦▪‣–▸✓◆]|[-*])\s+(.*)$/;
const NUMBERED_RE = /^\s*(?:\(([a-zA-Z0-9]{1,4})\)|([0-9]{1,3}|[ivxlcdmIVXLCDM]{1,5}|[a-zA-Z])[.)])\s+(.*)$/;

function normRot90(deg) {
  const r = ((Math.round((deg || 0) / 90) * 90) % 360 + 360) % 360;
  return r === 360 ? 0 : r;
}

function getBaselineY(span) {
  const ascent = typeof span.ascent === 'number' && span.ascent > 0 ? span.ascent : 0.82;
  const descent = typeof span.descent === 'number' ? Math.abs(span.descent) : 0.18;
  const ratio = ascent / Math.max(ascent + descent, 1e-4);
  return span.rect.y + span.rect.h * ratio;
}

function getContainerRect(c) {
  return c?.rect || c;
}

function findTightestRegion(rect, regions, threshold = 0.85) {
  let best = null;
  let bestArea = Infinity;
  for (let i = 0; i < (regions?.length || 0); i++) {
    const r = getContainerRect(regions[i]);
    if (!r || r.w == null || r.h == null) continue;
    if (contains(r, rect, threshold)) {
      const area = r.w * r.h;
      if (area < bestArea) {
        bestArea = area;
        best = { id: regions[i].id ?? i, rect: r, item: regions[i] };
      }
    }
  }
  return best;
}

function findColumn(rect, columns) {
  if (!columns?.length) return null;
  let best = null;
  let bestWidth = Infinity;
  const tol = CFG.merge.alignTolIn;

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    const r = getContainerRect(col);
    if (r?.x == null || r?.w == null) continue;

    const withinX = rect.x >= r.x - tol && rect.x + rect.w <= r.x + r.w + tol;
    const withinY = r.y != null && r.h != null ? contains(r, rect, 0.7) : withinX;
    if (withinX && withinY && r.w < bestWidth) {
      bestWidth = r.w;
      best = { id: col.id ?? i, rect: r };
    }
  }
  return best;
}

function spanToRunProps(span, page) {
  const resolved = span.face
    ? {
        face: span.face,
        bold: Boolean(span.bold),
        italic: Boolean(span.italic),
        mono: Boolean(span.mono),
      }
    : resolveFont(page, span.fontName, span);

  return {
    text: span.text,
    face: resolved.face,
    sizePt: Math.round((span.fontSizePt || 12) * 10) / 10,
    bold: Boolean(span.bold ?? resolved.bold),
    italic: Boolean(span.italic ?? resolved.italic),
    mono: Boolean(span.mono ?? resolved.mono),
    color: (span.color || '000000').toUpperCase(),
    opacity: span.opacity ?? 1,
    baseline: span.baseline ?? null,
    charSpacingPt: span.charSpacingPt ?? 0,
    breakLine: false,
    bullet: null,
    indentLevel: 0,
    spaceAfter: 0,
  };
}

function groupSpansIntoLines(spans, rot, page) {
  const verticalReading = rot === 90 || rot === 270;
  const enriched = spans.map((s) => {
    const sizeIn = (s.fontSizePt || 12) / 72;
    const baselineY = getBaselineY(s);
    const along = verticalReading ? s.rect.y : s.rect.x;
    const alongEnd = verticalReading ? s.rect.y + s.rect.h : s.rect.x + s.rect.w;
    const across = verticalReading ? s.rect.x + s.rect.w * 0.5 : baselineY;
    return { span: s, sizeIn, baselineY, along, alongEnd, across };
  });

  enriched.sort((a, b) => a.across - b.across || a.along - b.along);

  const lines = [];
  for (const item of enriched) {
    let targetLine = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      const maxSize = Math.max(line.maxSizeIn, item.sizeIn);
      if (Math.abs(item.across - line.across) > 0.28 * maxSize) {
        if (item.across - line.across > 0.28 * maxSize) break;
        continue;
      }
      const gap = item.along - line.alongEnd;
      if (gap >= -0.5 * maxSize && gap < 1.6 * maxSize) {
        targetLine = line;
        break;
      }
    }

    if (!targetLine) {
      targetLine = {
        items: [item],
        across: item.across,
        baselineY: item.baselineY,
        alongStart: item.along,
        alongEnd: item.alongEnd,
        maxSizeIn: item.sizeIn,
      };
      lines.push(targetLine);
    } else {
      targetLine.items.push(item);
      const n = targetLine.items.length;
      targetLine.across = (targetLine.across * (n - 1) + item.across) / n;
      targetLine.baselineY = (targetLine.baselineY * (n - 1) + item.baselineY) / n;
      targetLine.alongStart = Math.min(targetLine.alongStart, item.along);
      targetLine.alongEnd = Math.max(targetLine.alongEnd, item.alongEnd);
      targetLine.maxSizeIn = Math.max(targetLine.maxSizeIn, item.sizeIn);
    }
  }

  return lines.map((line) => {
    line.items.sort((a, b) => a.along - b.along);
    const runs = [];
    for (let i = 0; i < line.items.length; i++) {
      const cur = line.items[i];
      const run = spanToRunProps(cur.span, page);
      if (i > 0) {
        const prev = line.items[i - 1];
        const gap = cur.along - prev.alongEnd;
        const minSize = Math.min(prev.sizeIn, cur.sizeIn);
        const prevRun = runs[runs.length - 1];
        if (
          gap > 0.18 * minSize &&
          prevRun &&
          !/\s$/.test(prevRun.text) &&
          !/^\s/.test(run.text)
        ) {
          prevRun.text += ' ';
        }
      }
      runs.push(run);
    }

    const rect = unionRect(line.items.map((it) => it.span.rect));
    const avgSizePt =
      line.items.reduce((sum, it) => sum + (it.span.fontSizePt || 12), 0) / line.items.length;

    return {
      rect,
      baselineY: line.baselineY,
      sizeIn: line.maxSizeIn,
      sizePt: avgSizePt,
      rotate: rot,
      z: Math.max(...line.items.map((it) => it.span.z ?? 0)),
      dir: line.items.some((it) => it.span.dir === 'rtl') ? 'rtl' : 'ltr',
      mono: line.items.every((it) => spanToRunProps(it.span, page).mono),
      runs,
      text: runs.map((r) => r.text).join(''),
    };
  });
}

function detectListPrefix(line) {
  const text = line.text;
  const bMatch = text.match(BULLET_RE);
  if (bMatch) {
    return { type: 'bullet', marker: bMatch[1], prefixLen: text.length - bMatch[2].length };
  }
  const nMatch = text.match(NUMBERED_RE);
  if (nMatch) {
    return {
      type: 'number',
      marker: nMatch[1] || nMatch[2],
      prefixLen: text.length - nMatch[3].length,
    };
  }
  return null;
}

function stripListPrefixFromLine(line, listInfo) {
  if (!listInfo || !line.runs.length) return;
  let remaining = listInfo.prefixLen;
  while (remaining > 0 && line.runs.length > 0) {
    const first = line.runs[0];
    if (first.text.length <= remaining) {
      remaining -= first.text.length;
      line.runs.shift();
    } else {
      first.text = first.text.slice(remaining);
      remaining = 0;
    }
  }
  if (line.runs.length === 0) {
    line.runs.push({ ...spanToRunProps({ text: '', fontSizePt: line.sizePt }, null) });
  }
}

function stylesCompatible(a, b) {
  if (a.mono !== b.mono) return false;
  const maxPt = Math.max(a.sizePt, b.sizePt);
  return Math.abs(a.sizePt - b.sizePt) <= Math.max(2.5, maxPt * 0.25);
}

function canMergeIntoFrame(frame, line) {
  const prev = frame.lines[frame.lines.length - 1];
  if (frame.containerId !== line.containerId || frame.columnId !== line.columnId) {
    return false;
  }
  if (!stylesCompatible(prev, line)) return false;

  const lineHeight = Math.max(prev.sizeIn, line.sizeIn);
  // Reject side-by-side lines on the same horizontal band
  if (line.baselineY - prev.baselineY < 0.5 * lineHeight) return false;

  const verticalGap = line.rect.y - (prev.rect.y + prev.rect.h);
  if (verticalGap > CFG.merge.maxGapLh * lineHeight) return false;

  const tol = Math.max(CFG.merge.alignTolIn, 0.04);
  const lineLeft = line.rect.x;
  const lineRight = line.rect.x + line.rect.w;
  const lineCenter = lineLeft + line.rect.w * 0.5;

  const sameLeft = Math.abs(lineLeft - frame.anchorLeft) <= tol;
  const sameRight = Math.abs(lineRight - frame.anchorRight) <= tol;
  const sameCenter = Math.abs(lineCenter - frame.anchorCenter) <= tol;

  const isBullet = Boolean(line.listInfo);
  const prevWasBullet = Boolean(frame.lines.some((l) => l.listInfo));
  const hangingIndent =
    prevWasBullet && lineLeft >= frame.anchorLeft - tol && lineLeft <= frame.anchorLeft + 0.65;

  return sameLeft || sameRight || sameCenter || isBullet || hangingIndent;
}

function inferAlignment(lines, frameRect, containerRect, pageRect) {
  const tol = Math.max(CFG.merge.alignTolIn, 0.04);

  if (lines.length === 1) {
    const ref = containerRect || pageRect;
    if (!ref) return 'left';
    const line = lines[0];
    const lineCenter = line.rect.x + line.rect.w * 0.5;
    const refCenter = ref.x + ref.w * 0.5;
    if (
      Math.abs(lineCenter - refCenter) <= tol &&
      line.rect.x > ref.x + 0.15 &&
      line.rect.x + line.rect.w < ref.x + ref.w - 0.15
    ) {
      return 'center';
    }
    if (
      Math.abs(line.rect.x + line.rect.w - (ref.x + ref.w)) <= tol &&
      line.rect.x > ref.x + 0.25
    ) {
      return 'right';
    }
    return 'left';
  }

  const fLeft = frameRect.x;
  const fRight = frameRect.x + frameRect.w;
  const fCenter = fLeft + frameRect.w * 0.5;

  const leftMatch = lines.every((l) => Math.abs(l.rect.x - fLeft) <= tol);
  const rightMatch = lines.every((l) => Math.abs(l.rect.x + l.rect.w - fRight) <= tol);
  const centerMatch = lines.every((l) => Math.abs(l.rect.x + l.rect.w * 0.5 - fCenter) <= tol);

  // Justified: non-last lines align on both left and right edges, and lines vary in width or last line is shorter
  const nonLast = lines.slice(0, -1);
  const nonLastBoth =
    nonLast.length >= 2 &&
    nonLast.every(
      (l) => Math.abs(l.rect.x - fLeft) <= tol && Math.abs(l.rect.x + l.rect.w - fRight) <= tol
    );
  const lastShorter = lines[lines.length - 1].rect.w < frameRect.w - tol;
  if ((leftMatch && rightMatch && lines.some((l) => l.rect.w > frameRect.w * 0.5)) || (nonLastBoth && lastShorter)) {
    return 'justify';
  }
  if (centerMatch && !leftMatch) return 'center';
  if (rightMatch && !leftMatch) return 'right';
  return 'left';
}

function inferValign(frameRect, containerRect) {
  if (!containerRect) return 'top';
  const cMid = containerRect.y + containerRect.h * 0.5;
  const fMid = frameRect.y + frameRect.h * 0.5;
  if (
    Math.abs(fMid - cMid) <= 0.06 &&
    frameRect.y > containerRect.y + 0.05 &&
    frameRect.y + frameRect.h < containerRect.y + containerRect.h - 0.05
  ) {
    return 'middle';
  }
  return 'top';
}

function sameRunStyle(a, b) {
  return (
    a.face === b.face &&
    a.sizePt === b.sizePt &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.color === b.color &&
    a.opacity === b.opacity &&
    a.baseline === b.baseline &&
    a.charSpacingPt === b.charSpacingPt &&
    Boolean(a.bullet) === Boolean(b.bullet) &&
    a.bullet?.type === b.bullet?.type &&
    a.indentLevel === b.indentLevel
  );
}

function coalesceRuns(runs) {
  const out = [];
  for (const r of runs) {
    if (!r.text && !r.breakLine && !r.bullet) continue;
    const prev = out[out.length - 1];
    if (prev && !prev.breakLine && sameRunStyle(prev, r)) {
      prev.text += r.text;
      prev.breakLine = r.breakLine;
      prev.spaceAfter = r.spaceAfter;
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

function buildTextFrame(frame, pageRect) {
  const lines = frame.lines;
  const rect = unionRect(lines.map((l) => l.rect));
  const wrap = lines.length > 1;

  // Measure baseline deltas for lineSpacingPt
  const baselineDeltasPt = [];
  const verticalGapsIn = [];
  for (let i = 1; i < lines.length; i++) {
    baselineDeltasPt.push((lines[i].baselineY - lines[i - 1].baselineY) * 72);
    verticalGapsIn.push(Math.max(0, lines[i].rect.y - (lines[i - 1].rect.y + lines[i - 1].rect.h)));
  }

  let lineSpacingPt = null;
  let medianGapIn = 0;
  if (baselineDeltasPt.length > 0) {
    const sortedDeltas = [...baselineDeltasPt].sort((a, b) => a - b);
    lineSpacingPt = Math.round(sortedDeltas[Math.floor((sortedDeltas.length - 1) / 2)] * 10) / 10;
    const sortedGaps = [...verticalGapsIn].sort((a, b) => a - b);
    medianGapIn = sortedGaps[Math.floor((sortedGaps.length - 1) / 2)];
  }

  const align = inferAlignment(lines, rect, frame.containerRect, pageRect);
  const valign = inferValign(rect, frame.containerRect);
  const baseLeft = rect.x;
  const rawRuns = [];
  let maxSpaceAfter = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineRuns = line.runs.map((r) => ({ ...r }));

    // Determine indentLevel relative to frame left
    const indentIn = Math.max(0, line.rect.x - baseLeft);
    const indentLevel = indentIn >= 0.2 ? Math.min(4, Math.round(indentIn / 0.25)) : 0;

    if (line.listInfo) {
      stripListPrefixFromLine({ runs: lineRuns }, line.listInfo);
      lineRuns[0].bullet = { type: line.listInfo.type };
      lineRuns[0].indentLevel = indentLevel;
    }

    const isLastLine = i === lines.length - 1;
    let isParaBreak = false;
    let spaceAfterPt = 0;

    if (!isLastLine) {
      const next = lines[i + 1];
      const gapIn = Math.max(0, next.rect.y - (line.rect.y + line.rect.h));
      const lineHeight = Math.max(line.sizeIn, next.sizeIn);
      const largeGap = gapIn > Math.max(medianGapIn * 1.45, 0.35 * lineHeight);
      if (line.listInfo || next.listInfo || largeGap) {
        isParaBreak = true;
        spaceAfterPt = Math.max(0, Math.round((gapIn - medianGapIn) * 72 * 10) / 10);
        if (spaceAfterPt > maxSpaceAfter) maxSpaceAfter = spaceAfterPt;
      } else {
        // Soft wrap within same paragraph: ensure space between lines
        const lastRun = lineRuns[lineRuns.length - 1];
        if (lastRun && !/\s$/.test(lastRun.text)) {
          lastRun.text += ' ';
        }
      }
    }

    if (isParaBreak) {
      const lastRun = lineRuns[lineRuns.length - 1];
      lastRun.breakLine = true;
      lastRun.spaceAfter = spaceAfterPt;
    }

    for (const r of lineRuns) {
      if (line.listInfo) r.indentLevel = indentLevel;
      rawRuns.push(r);
    }
  }

  return {
    rect,
    rotate: frame.rotate,
    z: Math.max(...lines.map((l) => l.z)),
    containerId: frame.containerId,
    columnId: frame.columnId,
    align,
    valign,
    wrap,
    lineSpacingPt,
    paraSpaceAfter: maxSpaceAfter,
    dir: lines.some((l) => l.dir === 'rtl') ? 'rtl' : 'ltr',
    runs: coalesceRuns(rawRuns),
  };
}

/**
 * Clusters extracted StyledTextSpan[] into logical PowerPoint TextFrames.
 * @param {Array<object>} spans - Output from extractStyledSpans()
 * @param {object} [opts]
 * @param {Array<object>} [opts.containers] - Candidate container shapes/rects
 * @param {object} [opts.pageRect] - Slide/page bounding rect in inches
 * @param {Array<object>} [opts.columns] - Detected column rects
 * @param {object|null} [opts.page] - Optional pdf.js page for font resolution
 * @returns {Array<object>}
 */
export function clusterTextFrames(
  spans,
  { containers = [], pageRect = null, columns = [], page = null } = {}
) {
  if (!spans?.length) return [];

  // 1. Bucket by 90-degree rotation
  const buckets = new Map();
  for (const s of spans) {
    if (!s?.text || !s.rect) continue;
    const rot = normRot90(s.rotate);
    if (!buckets.has(rot)) buckets.set(rot, []);
    buckets.get(rot).push(s);
  }

  const frames = [];

  for (const [rot, bucketSpans] of buckets.entries()) {
    // 2. Group spans into lines
    const lines = groupSpansIntoLines(bucketSpans, rot, page);

    // 3. Assign tightest container & column and detect list markers
    for (const line of lines) {
      const c = findTightestRegion(line.rect, containers);
      const col = findColumn(line.rect, columns);
      line.containerId = c ? c.id : null;
      line.containerRect = c ? c.rect : null;
      line.columnId = col ? col.id : null;
      line.listInfo = detectListPrefix(line);
    }

    // Sort lines top-to-bottom, left-to-right
    lines.sort((a, b) => a.baselineY - b.baselineY || a.rect.x - b.rect.x);

    // 4. Merge lines into logical TextFrames
    const activeFrames = [];
    for (const line of lines) {
      let merged = false;
      for (let i = activeFrames.length - 1; i >= 0; i--) {
        const frame = activeFrames[i];
        if (canMergeIntoFrame(frame, line)) {
          frame.lines.push(line);
          merged = true;
          break;
        }
      }
      if (!merged) {
        activeFrames.push({
          rotate: rot,
          containerId: line.containerId,
          containerRect: line.containerRect,
          columnId: line.columnId,
          anchorLeft: line.rect.x,
          anchorRight: line.rect.x + line.rect.w,
          anchorCenter: line.rect.x + line.rect.w * 0.5,
          lines: [line],
        });
      }
    }

    for (const frame of activeFrames) {
      frames.push(buildTextFrame(frame, pageRect));
    }
  }

  return frames;
}
