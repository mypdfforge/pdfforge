export const params = {
  // Line extraction (§5 S2)
  line: {
    baselineTol: 0.3, // baseline diff <= tol * fontSize
    segmentGapEm: 1.5, // wide gap splitting for columns/tables
  },
  // Word extraction (§5 S2)
  word: {
    gapEm: 0.18, // gap > gapEm * fontSize => insert synthetic space
  },
  // XY-cut and reading order (§5 S3)
  xy: {
    hGapLineH: 1.0, // horizontal band gap threshold (multiplied by medianLineHeight)
    vGutterPt: 10.0, // vertical gutter in pt (or 1.2x median char width)
    minSideLines: 3, // min lines on each side of vertical cut
    minSideTextRatio: 0.2, // min text ratio on each side
  },
  // Paragraph reflow (§5 S6)
  para: {
    gapRatio: 1.35, // vertical gap > medianLeading * gapRatio => new para
    indentPt: 0.8, // first-line indent threshold in em
    shortLineEm: 2.5, // previous line short threshold in em
    dropCapEm: 1.8,
  },
  // Lists (§5 S7)
  list: {
    levelPt: 18.0, // indent per list level in pt
  },
  // Tables (§5 S5)
  tbl: {
    mergeTol: 1.5, // collinear segment merge tolerance in pt
    gridSnapTol: 2.0, // grid coordinate snap tolerance in pt
    contGapRatio: 0.85, // continuation line gap ratio
    numericRatio: 0.7, // threshold for classifying numeric column
    minBorderCoverage: 0.8, // 80% edge coverage for cell border
  },
  // Shapes & Images (§5 S8)
  shape: {
    maxPaths: 25, // region with > maxPaths and < 15% glyphs => rasterize
  },
  // ML Layout (§5 S-ML)
  ml: {
    minConf: 0.7,
    iouThreshold: 0.6,
  },
};

export type Params = typeof params;
