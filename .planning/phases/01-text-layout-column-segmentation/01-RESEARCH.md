# Phase 1: Text Layout & Column Segmentation - Research

**Date:** 2026-11-07
**Phase:** 01-text-layout-column-segmentation
**Requirements:** FLOW-01, FLOW-02, TYPO-04

## Executive Summary

Currently, the client-side `pdfToWord` implementation in `frontend/src/utils/convertClient.js` (lines 71–97) uses a naive horizontal line grouping function `pageRows()`. It bins text items within 3 points of vertical difference (`Math.abs(r.y - y) < 3`) and sorts them strictly left-to-right (`a.x - b.x`).

On Section 3 (Multi-Column Layout) of `test_25pages_output.pdf`, this causes horizontal interleaving across columns:
```
Column 1: Converters often struggle when transitioning Column 2: Margin bounds must be strictly respected.
from wide banner titles into balanced column flows. When embedded tables or images interface with column
...
```
Furthermore, `pageRows()` discards item font sizes and heights, preventing title/heading classification, and treats every physical text line as an independent paragraph rather than flowing sentences naturally.

To satisfy **FLOW-01**, **FLOW-02**, and **TYPO-04**, the text extraction pipeline must implement:
1. **Vertical Band & Column Gutter Detection** (XY-Cut / Projection Histogram)
2. **Topological Reading-Order Sorting** (Banners &rarr; Col 1 &rarr; Col 2 &rarr; Footers)
3. **Statistical Font-Size Classification** for Headings (`HeadingLevel.HEADING_1`, `HEADING_2`)
4. **Paragraph Cohesion & Long-String Margin Wrap**

---

## 1. Column Flow & Segmentation Algorithm

### The Defect in Naive Y-Binning
When text is placed in multiple columns, text runs in Column 1 and Column 2 often share identical Y-coordinates. A simple Y-grouping merges them into a single line.

### Multi-Column Extraction Architecture
```text
┌────────────────────────────────────────────────────────┐
│ Full-Width Title Banner (spans x0=50 to x1=550)        │ -> Band 1 (1 Col)
├──────────────────────────┬─────────────────────────────┤
│ Column 1 (x: 50 .. 280)  │ Column 2 (x: 320 .. 550)    │ -> Band 2 (2 Cols)
│ Line 1                   │ Line 1                      │    Gutter: [280..320]
│ Line 2                   │ Line 2                      │
├──────────────────────────┴─────────────────────────────┤
│ Full-Width Quote / Footer (spans x0=50 to x1=550)      │ -> Band 3 (1 Col)
└────────────────────────────────────────────────────────┘
```

### Proposed XY-Cut / Gutter Identification Algorithm:
1. **Extract Rich Items**: From `page.getTextContent()`, extract `{ str, x, y, w, h, size, fontName }`.
2. **Identify Horizontal Bands**:
   - Elements spanning wider than 65% of the content width are classified as full-width blocks (Banners, Titles, Callout boxes, Footers).
   - Regions where items cluster into distinct horizontal intervals with a clear white-space gap ($\text{gap} \ge 18\text{pt}$) are segmented into discrete columns.
3. **Column Assignment**:
   - Items within a multi-column band are partitioned by their X-midpoint (`x + w/2`).
   - Each column is sorted top-to-bottom ($\Delta y > 0$).
4. **Emit Order**:
   - Band 1 (Title) &rarr; Band 2 Column 1 &rarr; Band 2 Column 2 &rarr; Band 3 (Footer).

---

## 2. Heading Classification Heuristics (TYPO-04)

### Page & Document Font Distribution
1. Build a histogram of font sizes across all text items in the document.
2. Find the median font size: $S_{body}$ (typically 10pt–11pt).
3. Compute dynamic thresholds:
   - $S \ge 1.6 \times S_{body}$ (e.g., $\ge 18\text{pt}$): Document Title / Heading 1
   - $S \ge 1.25 \times S_{body}$ (e.g., $\ge 13.5\text{pt}$): Section Header / Heading 2
   - $S \ge 1.10 \times S_{body}$ or Bold at $S_{body}$: Sub-heading / Heading 3
   - Standard: Regular Body Paragraph
4. Map to `docx` library primitives:
   - `HeadingLevel.HEADING_1`
   - `HeadingLevel.HEADING_2`
   - `HeadingLevel.HEADING_3`

---

## 3. Paragraph Assembly & Margin Bounds (FLOW-02)

### Line Joining Rules:
- If consecutive lines in the same column have vertical spacing $\le 1.4 \times \text{fontSize}$, they belong to the same paragraph unless separated by a clear paragraph break.
- Ensure proper spacing between words: if the gap between two consecutive spans exceeds $0.15 \times \text{fontSize}$, inject a space `' '`.

### Long Unbroken Strings & URL Overflow:
- Strings like URLs (Section 11) or Base64 hashes exceed standard word wrap boundaries in Word if treated as an atomic token without breaking opportunities.
- In Word OpenXML (`docx`), paragraphs containing long unbroken strings should have `breakOnSpaces: false` or have zero-width break opportunities inserted or zero-width spaces (`\u200B`) after path slashes (`/`, `-`, `_`, `?`, `&`) so Microsoft Word wraps within the page margin without clipping.

---

## 4. Validation Architecture

- **Visual / Text Verification**: Run conversion on `test_25pages_output.pdf` Section 3 and confirm that Column 1 text precedes Column 2 text rather than interleaving.
- **Heading Inspection**: Verify that "Section 03: Multi-Column Layout & Editorial Typography" renders with Heading styling in the `.docx` package.
- **URL Verification**: Section 11 URL wraps cleanly within the 1-inch right margin.

---
*Research complete: 2026-11-07*
