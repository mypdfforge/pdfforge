/**
 * ooxmlPatcher.js — Post-build OOXML XML validator, deterministic text/table
 * patcher, and media deduplicator for the PDF → PPTX v2 engine.
 */

import JSZip from 'jszip';
import { normalizePptxXml } from '../pdfToPptxBuild.js';

const MIME_PPTX =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const PT_TO_EMU = 12700;

/**
 * Validates slide XML invariants before packaging:
 * - Single <a:pPr> per <a:p>
 * - Balanced <p:sp> and <p:graphicFrame> tags
 * - No NaN or Infinity in <a:off> or <a:ext>
 * - gridSpan row consistency inside <a:tbl>
 *
 * @param {string} xml
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSlideXml(xml) {
  const errors = [];
  if (typeof xml !== 'string' || !xml.length) {
    return { valid: false, errors: ['Empty or non-string slide XML'] };
  }

  // 1. Single <a:pPr> per <a:p>
  const pRe = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g;
  let pMatch;
  let pIdx = 0;
  while ((pMatch = pRe.exec(xml)) !== null) {
    const pPrMatches = pMatch[1].match(/<a:pPr\b/g);
    if (pPrMatches && pPrMatches.length > 1) {
      errors.push(`Paragraph #${pIdx} has ${pPrMatches.length} <a:pPr> elements (expected <= 1)`);
    }
    pIdx++;
  }

  // 2. Balanced <p:sp> and <p:graphicFrame> tags
  for (const tag of ['p:sp', 'p:graphicFrame']) {
    const openRe = new RegExp(`<${tag}\\b(?:[^>]*[^/])?>`, 'g');
    const closeRe = new RegExp(`</${tag}>`, 'g');
    const opens = (xml.match(openRe) || []).length;
    const closes = (xml.match(closeRe) || []).length;
    if (opens !== closes) {
      errors.push(`Unbalanced <${tag}> tags: ${opens} opening vs ${closes} closing`);
    }
  }

  // 3. No NaN or Infinity in <a:off> or <a:ext>
  const geomRe = /<a:(?:off|ext)\b[^>]*>/g;
  let gMatch;
  while ((gMatch = geomRe.exec(xml)) !== null) {
    if (/\b(?:NaN|-?Infinity)\b/i.test(gMatch[0])) {
      errors.push(`Invalid coordinate value in ${gMatch[0]}`);
    }
  }

  // 4. gridSpan row consistency inside <a:tbl>
  const tblRe = /<a:tbl\b[^>]*>([\s\S]*?)<\/a:tbl>/g;
  let tblMatch;
  let tblIdx = 0;
  while ((tblMatch = tblRe.exec(xml)) !== null) {
    const tblXml = tblMatch[1];
    const gridCols = (tblXml.match(/<a:gridCol\b/g) || []).length;
    if (gridCols > 0) {
      const trRe = /<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g;
      let trMatch;
      let trIdx = 0;
      while ((trMatch = trRe.exec(tblXml)) !== null) {
        const tcRe = /<a:tc\b([^>]*)>/g;
        let tcMatch;
        let spanSum = 0;
        let hasCells = false;
        while ((tcMatch = tcRe.exec(trMatch[1])) !== null) {
          hasCells = true;
          const attrs = tcMatch[1];
          if (/\bhMerge="1"/.test(attrs)) continue;
          const gsMatch = attrs.match(/\bgridSpan="(\d+)"/);
          spanSum += gsMatch ? parseInt(gsMatch[1], 10) : 1;
        }
        if (hasCells && spanSum !== gridCols) {
          errors.push(
            `Table #${tblIdx} row #${trIdx} gridSpan sum (${spanSum}) !== gridCol count (${gridCols})`
          );
        }
        trIdx++;
      }
    }
    tblIdx++;
  }

  return { valid: errors.length === 0, errors };
}

function setAttr(tagAttrs, name, value) {
  const re = new RegExp(`\\b${name}="[^"]*"`);
  if (re.test(tagAttrs)) {
    return tagAttrs.replace(re, `${name}="${value}"`);
  }
  return `${tagAttrs} ${name}="${value}"`;
}

function patchBodyPr(txBodyXml, patch) {
  return txBodyXml.replace(
    /<a:bodyPr\b([^>]*)(?:\/>|>([\s\S]*?)<\/a:bodyPr>)/,
    (_m, rawAttrs, inner = '') => {
      let attrs = rawAttrs || '';
      if (patch.zeroInsets !== false) {
        attrs = setAttr(attrs, 'lIns', '0');
        attrs = setAttr(attrs, 'tIns', '0');
        attrs = setAttr(attrs, 'rIns', '0');
        attrs = setAttr(attrs, 'bIns', '0');
      }
      if (patch.wrap === 'none' || patch.noWrap) {
        attrs = setAttr(attrs, 'wrap', 'none');
      }
      let nextInner = inner;
      if (patch.noAutofit !== false) {
        nextInner = nextInner
          .replace(/<a:(?:spAutofit|normAutofit|noAutofit)\b[^>]*(?:\/>|>[\s\S]*?<\/a:(?:spAutofit|normAutofit|noAutofit)>)/g, '')
          .trim();
        nextInner = `${nextInner}<a:noAutofit/>`;
      }
      return nextInner ? `<a:bodyPr${attrs}>${nextInner}</a:bodyPr>` : `<a:bodyPr${attrs}/>`;
    }
  );
}

function patchParagraphPPr(pInner, patch) {
  const needsLnSpc = Number.isFinite(patch.lineSpacingPt) && patch.lineSpacingPt > 0;
  const needsRtl = Boolean(patch.rtl);
  if (!needsLnSpc && !needsRtl) return pInner;

  const lnSpcXml = needsLnSpc
    ? `<a:lnSpc><a:spcPts val="${Math.round(patch.lineSpacingPt * 100)}"/></a:lnSpc>`
    : '';

  const pPrRe = /<a:pPr\b([^>]*)(?:\/>|>([\s\S]*?)<\/a:pPr>)/;
  if (pPrRe.test(pInner)) {
    return pInner.replace(pPrRe, (_m, rawAttrs, inner = '') => {
      let attrs = rawAttrs || '';
      if (needsRtl) {
        attrs = setAttr(attrs, 'rtl', '1');
        attrs = setAttr(attrs, 'algn', 'r');
      }
      let nextInner = inner;
      if (lnSpcXml) {
        nextInner = nextInner.replace(/<a:lnSpc\b[^>]*>[\s\S]*?<\/a:lnSpc>/g, '');
        nextInner = `${lnSpcXml}${nextInner}`;
      }
      return nextInner ? `<a:pPr${attrs}>${nextInner}</a:pPr>` : `<a:pPr${attrs}/>`;
    });
  }

  const attrs = needsRtl ? ' rtl="1" algn="r"' : '';
  return lnSpcXml ? `<a:pPr${attrs}>${lnSpcXml}</a:pPr>${pInner}` : `<a:pPr${attrs}/>${pInner}`;
}

function normalizeBaselineVal(baseline) {
  if (baseline === 'super') return 30000;
  if (baseline === 'sub') return -25000;
  if (Number.isFinite(baseline)) return Math.round(baseline);
  return null;
}

function patchRunRPr(rXml, runPatch) {
  if (!runPatch) return rXml;
  const baselineVal = normalizeBaselineVal(runPatch.baseline);
  const spcVal = Number.isFinite(runPatch.charSpacingPt)
    ? Math.round(runPatch.charSpacingPt * 100)
    : null;
  const alphaVal = runPatch.ghost
    ? 0
    : Number.isFinite(runPatch.opacity) && runPatch.opacity < 1
      ? Math.max(0, Math.min(100000, Math.round(runPatch.opacity * 100000)))
      : null;

  if (baselineVal === null && spcVal === null && alphaVal === null) return rXml;

  const applyRPr = (rawAttrs = '', inner = '') => {
    let attrs = rawAttrs;
    if (baselineVal !== null) attrs = setAttr(attrs, 'baseline', String(baselineVal));
    if (spcVal !== null) attrs = setAttr(attrs, 'spc', String(spcVal));

    let nextInner = inner;
    if (alphaVal !== null) {
      const alphaTag = `<a:alpha val="${alphaVal}"/>`;
      if (/<a:solidFill\b[^>]*>[\s\S]*?<\/a:solidFill>/.test(nextInner)) {
        nextInner = nextInner.replace(
          /<a:srgbClr\b([^>]*)(?:\/>|>([\s\S]*?)<\/a:srgbClr>)/,
          (_cm, cAttrs, cInner = '') => {
            const cleaned = cInner.replace(/<a:alpha\b[^>]*\/>/g, '');
            return `<a:srgbClr${cAttrs}>${cleaned}${alphaTag}</a:srgbClr>`;
          }
        );
      } else {
        const hex = (runPatch.color || '000000').replace('#', '').toUpperCase();
        nextInner = `<a:solidFill><a:srgbClr val="${hex}">${alphaTag}</a:srgbClr></a:solidFill>${nextInner}`;
      }
    }
    return nextInner ? `<a:rPr${attrs}>${nextInner}</a:rPr>` : `<a:rPr${attrs}/>`;
  };

  if (/<a:rPr\b/.test(rXml)) {
    return rXml.replace(/<a:rPr\b([^>]*)(?:\/>|>([\s\S]*?)<\/a:rPr>)/, (_m, a, i) => applyRPr(a, i));
  }
  return rXml.replace(/<a:r\b([^>]*)>/, `<a:r$1>${applyRPr()}`);
}

function applyTextPatchToShape(spXml, patch) {
  if (!patch) return spXml;
  let out = spXml.replace(/<p:txBody>([\s\S]*?)<\/p:txBody>/, (_m, inner) => {
    let body = patchBodyPr(inner, patch);
    let runCursor = 0;
    body = body.replace(/<a:p>([\s\S]*?)<\/a:p>/g, (_pm, pInner) => {
      let nextP = patchParagraphPPr(pInner, patch);
      nextP = nextP.replace(/<a:r\b[^>]*>[\s\S]*?<\/a:r>/g, (rXml) => {
        const runPatch =
          (Array.isArray(patch.runs) ? patch.runs[runCursor] : null) || {
            baseline: patch.baseline,
            charSpacingPt: patch.charSpacingPt,
            opacity: patch.opacity,
            ghost: patch.ghost,
            color: patch.color,
          };
        runCursor++;
        return patchRunRPr(rXml, runPatch);
      });
      return `<a:p>${nextP}</a:p>`;
    });
    return `<p:txBody>${body}</p:txBody>`;
  });
  return out;
}

function buildBorderXml(sideTag, spec) {
  if (!spec) return '';
  const wEmu = Math.max(1270, Math.round((spec.widthPt ?? 0.75) * PT_TO_EMU));
  const color = (spec.color || '000000').replace('#', '').toUpperCase();
  const dash = spec.dash || 'solid';
  return `<${sideTag} w="${wEmu}" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:prstDash val="${dash}"/></${sideTag}>`;
}

function applyTablePatchToFrame(frameXml, tablePatch) {
  if (!tablePatch?.cells?.length) return frameXml;
  const cellMap = new Map();
  for (const c of tablePatch.cells) {
    cellMap.set(`${c.row}:${c.col}`, c);
  }

  let rowIdx = 0;
  return frameXml.replace(/<a:tr\b([^>]*)>([\s\S]*?)<\/a:tr>/g, (_trM, trAttrs, trInner) => {
    const r = rowIdx++;
    let colIdx = 0;
    const nextTr = trInner.replace(
      /<a:tc\b([^>]*)>([\s\S]*?)<\/a:tc>/g,
      (_tcM, tcAttrs, tcInner) => {
        const c = colIdx++;
        const spec = cellMap.get(`${r}:${c}`);
        if (!spec) return `<a:tc${tcAttrs}>${tcInner}</a:tc>`;

        let nextTcAttrs = tcAttrs;
        if (spec.hMerge) nextTcAttrs = setAttr(nextTcAttrs, 'hMerge', '1');
        if (spec.vMerge) nextTcAttrs = setAttr(nextTcAttrs, 'vMerge', '1');
        if (Number.isInteger(spec.gridSpan) && spec.gridSpan > 1) {
          nextTcAttrs = setAttr(nextTcAttrs, 'gridSpan', String(spec.gridSpan));
        }
        if (Number.isInteger(spec.rowSpan) && spec.rowSpan > 1) {
          nextTcAttrs = setAttr(nextTcAttrs, 'rowSpan', String(spec.rowSpan));
        }

        let nextTcInner = tcInner;
        if (spec.borders) {
          const sides = [
            ['a:lnL', spec.borders.left],
            ['a:lnR', spec.borders.right],
            ['a:lnT', spec.borders.top],
            ['a:lnB', spec.borders.bottom],
          ]
            .map(([tag, b]) => buildBorderXml(tag, b))
            .join('');

          if (sides) {
            if (/<a:tcPr\b/.test(nextTcInner)) {
              nextTcInner = nextTcInner.replace(
                /<a:tcPr\b([^>]*)(?:\/>|>([\s\S]*?)<\/a:tcPr>)/,
                (_pm, pAttrs, pInner = '') => {
                  const stripped = pInner.replace(/<a:ln[LRTB]\b[^>]*>[\s\S]*?<\/a:ln[LRTB]>/g, '');
                  return `<a:tcPr${pAttrs}>${sides}${stripped}</a:tcPr>`;
                }
              );
            } else {
              nextTcInner = `${nextTcInner}<a:tcPr>${sides}</a:tcPr>`;
            }
          }
        }
        return `<a:tc${nextTcAttrs}>${nextTcInner}</a:tc>`;
      }
    );
    return `<a:tr${trAttrs}>${nextTr}</a:tr>`;
  });
}

function fnv1a(bytes) {
  let h = 2166136261;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function deduplicateMedia(zip) {
  const mediaPaths = Object.keys(zip.files)
    .filter((k) => /^ppt\/media\/.+/.test(k) && !zip.files[k].dir)
    .sort();
  if (mediaPaths.length < 2) return;

  const buckets = new Map();
  const remap = new Map();

  for (const path of mediaPaths) {
    const bytes = await zip.file(path).async('uint8array');
    const key = `${bytes.length}:${fnv1a(bytes)}`;
    const list = buckets.get(key) || [];
    const match = list.find((entry) => bytesEqual(entry.bytes, bytes));
    if (match) {
      remap.set(path.replace(/^ppt\/media\//, ''), match.name);
      zip.remove(path);
    } else {
      const name = path.replace(/^ppt\/media\//, '');
      list.push({ name, bytes });
      buckets.set(key, list);
    }
  }

  if (remap.size === 0) return;

  const relsPaths = Object.keys(zip.files).filter((k) => /\.rels$/.test(k) && !zip.files[k].dir);
  for (const relPath of relsPaths) {
    let relXml = await zip.file(relPath).async('string');
    let changed = false;
    for (const [dupName, canonicalName] of remap.entries()) {
      const targetRe = new RegExp(`(Target="(?:\\.\\./|ppt/)?media/)${dupName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(")`, 'g');
      if (targetRe.test(relXml)) {
        relXml = relXml.replace(targetRe, `$1${canonicalName}$2`);
        changed = true;
      }
    }
    if (changed) zip.file(relPath, relXml);
  }
}

/**
 * Normalizes, patches, validates, and deduplicates media in a generated .pptx.
 *
 * @param {ArrayBuffer|Uint8Array|Blob} arrayBuffer
 * @param {Array<object>|Record<string, object>} [patches]
 * @param {object} [opts]
 * @param {function} [opts.onProgress]
 * @returns {Promise<Blob>}
 */
export async function patchOoxml(arrayBuffer, patches = [], { onProgress } = {}) {
  const inputBlob = arrayBuffer instanceof Blob ? arrayBuffer : new Blob([arrayBuffer]);
  const normalizedBlob = await normalizePptxXml(inputBlob);
  const zip = await JSZip.loadAsync(await normalizedBlob.arrayBuffer());

  const slidePaths = Object.keys(zip.files)
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)\.xml$/)[1], 10);
      const nb = parseInt(b.match(/slide(\d+)\.xml$/)[1], 10);
      return na - nb;
    });

  for (let i = 0; i < slidePaths.length; i++) {
    const path = slidePaths[i];
    const slidePatch = Array.isArray(patches)
      ? patches[i]
      : patches?.[i] ?? patches?.[path] ?? null;

    let xml = await zip.file(path).async('string');

    if (slidePatch?.textPatches?.length) {
      let txIdx = 0;
      xml = xml.replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, (spXml) => {
        if (!/<p:txBody>/.test(spXml)) return spXml;
        const patch = slidePatch.textPatches[txIdx++];
        return applyTextPatchToShape(spXml, patch);
      });
    }

    if (slidePatch?.tablePatches?.length) {
      let tblIdx = 0;
      xml = xml.replace(/<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/g, (frameXml) => {
        if (!/<a:tbl\b/.test(frameXml)) return frameXml;
        const patch = slidePatch.tablePatches[tblIdx++];
        return applyTablePatchToFrame(frameXml, patch);
      });
    }

    const validation = validateSlideXml(xml);
    if (!validation.valid) {
      throw new Error(`Invalid OOXML in ${path}: ${validation.errors.join('; ')}`);
    }

    zip.file(path, xml);
    onProgress?.({ phase: 'patch', done: i + 1, total: slidePaths.length });
  }

  await deduplicateMedia(zip);

  return zip.generateAsync({ type: 'blob', mimeType: MIME_PPTX });
}
