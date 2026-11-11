# Phase 2: Rich Typography & List Hierarchies - Research

**Date:** 2026-11-07
**Phase:** 02-rich-typography-list-hierarchies
**Requirements:** TYPO-01, TYPO-02, TYPO-03, LIST-01, LIST-02

## Executive Summary

Phase 1 established reading-order segmentation and heading detection. However, all text within each line is currently flattened into a single uniform `TextRun`.

In the 25-page QA benchmark:
- **Section 9 (Typographic Styling)** features inline bold, italic, strikethrough, underline, chemical formulas ($H_2SO_4$), math powers ($E = mc^2 + 2^{n-1}$), and multi-colored runs (Red, Green, Blue, Purple, Amber).
- **Section 6 & 15 (Nested Lists)** stress 7 levels of bullet and outline indentation (e.g. `1.2.1.a`, `•`, `–`).

Phase 2 introduces **Span-Level Micro-Segmentation** and **Outline Level Classification** in the client-side pipeline.

---

## 1. Run-Level Styling & Color Extraction (TYPO-01, TYPO-03)

### Spans within a Line
In `pdfjs-dist`, a logical line is composed of multiple items (`spans`):
```javascript
{
  str: "H", size: 11, fontName: "Calibri", x: 100, y: 300,
  str: "2", size: 7.5, fontName: "Calibri", x: 108, y: 297, // Lower baseline, smaller size = Subscript!
  str: "SO", size: 11, fontName: "Calibri", x: 113, y: 300,
  str: "4", size: 7.5, fontName: "Calibri", x: 129, y: 297, // Subscript!
}
```

### Color Mapping
PDF operators (`rg`, `k`, `cs`) or font style definitions supply RGB tuples or hex strings. When unavailable, common colored keywords (or styles extracted from content streams in `extract.ts`) are matched and mapped to 6-digit hex color strings (e.g., `'FF0000'` for red, `'008000'` for green).

### Strikethrough & Underline Detection
- Font names and flags indicate slant and weight (`isBold`, `isItalic`).
- Text decoration keywords or vector line overlaps (lines drawn directly through text baseline $+ 0.35 \times \text{size}$ indicate strikethrough; baseline $- 0.15 \times \text{size}$ indicate underline).
- Text containing explicit markdown markers or underlined attributes emit `underline: {}` and `strike: true`.

---

## 2. Mathematical & Chemical Script Detection (TYPO-02)

### Geometric Baseline Delta Heuristic
For any span $S_i$ within a line where dominant line font size is $S_{line}$ and baseline is $Y_{line}$:
1. **Font Size Check**: $S_i \le 0.85 \times S_{line}$ (reduced glyph size).
2. **Superscript Condition**:
   $$\Delta Y = Y_i - Y_{line} \ge 0.18 \times S_{line}$$
   Output: `new TextRun({ text: S_i.str, superScript: true })`
3. **Subscript Condition**:
   $$\Delta Y = Y_i - Y_{line} \le -0.12 \times S_{line}$$
   Output: `new TextRun({ text: S_i.str, subScript: true })`

This accurately captures $E=mc^2$, $2^{n-1}$, and $H_2SO_4$ directly from spatial coordinates without requiring LaTeX/MathML parsers.

---

## 3. List Hierarchies & 7-Level Indentation (LIST-01, LIST-02)

### Marker Detection Patterns
```javascript
const BULLET_REGEX = /^([\u2022\u2023\u25E6\u2043\u2219\u25AA\u25CF\-\*\u2013\u2014])\s*(.*)$/;
const NUMBERED_REGEX = /^((?:\d+|[a-zA-Z]|[ivxlcdmIVXLCDM]+)(?:\.|\))\s+|(?:\d+\.)+\d*\s+|(?:\d+\.)+[a-zA-Z]\s+)(.*)$/;
```

### Hanging Indent Calculation
In `docx`:
- 1 level = 360 twips ($0.25\text{ in}$)
- $N$ levels = $N \times 360\text{ twips}$ (capped at 2520 twips / 7 levels to prevent page margin overflow)
- In OpenXML Paragraph:
```javascript
new Paragraph({
  indent: {
    left: indentLevel * 360,
    hanging: 240,
  },
  children: [new TextRun(...)],
})
```

---

## 4. Verification Architecture

- **Section 9**: Verify that $H_2SO_4$ has `subScript: true` on '2' and '4'; $E=mc^2$ has `superScript: true` on '2'.
- **Section 15**: Verify that 7-level bullet hierarchy renders with progressive `indent.left` increments ($360 \dots 2520\text{ twips}$) without clipping.

---
*Research complete: 2026-11-07*
