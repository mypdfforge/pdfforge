# Phase 3: In-Browser Table Reconstruction - Research

**Date:** 2026-11-07
**Phase:** 03-in-browser-table-reconstruction
**Requirements:** TABLE-01, TABLE-02, TABLE-03

## Executive Summary

When documents contain data grids (such as Section 4: Cluster Allocation Matrix, Section 5: Financial Balance Sheet, Section 10: 8-Column Data Matrix, Section 18: Product Comparison, and Section 23: Security Audit Logs), standard PDF text extractions flatten the rows into loose text paragraphs with spaces.

In `frontend/src/utils/pdfToExcel.js`, PDFForge already has proven algorithms for 1D spatial coordinate clustering (`cluster()`), ruling intersection, and column edge projection (`streamEdges()`).

Phase 3 adapts these spatial clustering algorithms into a **Table Reconstruction Engine** that outputs native `docx.Table` structures with cell borders, column widths, header shading, and numeric right-alignment.

---

## 1. Tabular Structure Detection (TABLE-01)

### Spatial Alignment Heuristic
A group of 3 or more consecutive lines constitutes a Table candidate if:
1. Each line contains $\ge 2$ text items separated by significant horizontal gaps ($\ge 14\text{pt}$).
2. The X-start coordinates of items across consecutive lines cluster into consistent column positions ($X_0, X_1, \dots, X_k$).
3. The bounding box of the group has consistent left and right margins.

### Merged Header Handling (TABLE-03)
In Section 4, the top header:
`"ENTERPRISE MULTI-TIER CLUSTER ALLOCATION MATRIX (MERGED HEADER)"`
spans the full table width ($x_0$ near col 0, $x_1$ near col 3).
- **Rule**: If a row has only 1 text run spanning across the width of $K$ columns, it is emitted as a `TableCell` with `columnSpan: K`.

### Financial Alignment & Number Formatting (TABLE-03)
In Section 5:
- Items starting with currency signs (`$`, `€`, `£`, `¥`) or enclosed in parentheses `($3,420,100.00)` or percentage variances `+34.8%` are numeric values.
- In Word tables, numeric cells are set to `AlignmentType.RIGHT`.
- Text labels in the first column ("Reporting Category", "Gross SaaS Revenue") are set to `AlignmentType.LEFT`.

---

## 2. Docx Table Model Generation (TABLE-02)

### Table Construction Primitives:
```javascript
import { Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType } from 'docx';

new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  rows: [
    new TableRow({
      tableHeader: true,
      children: [
        new TableCell({
          children: [new Paragraph({ text: "Cluster Node ID", bold: true })],
          shading: { fill: "F3F4F6" },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: "D1D5DB" },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: "9CA3AF" },
            left: { style: BorderStyle.SINGLE, size: 1, color: "D1D5DB" },
            right: { style: BorderStyle.SINGLE, size: 1, color: "D1D5DB" },
          },
        }),
      ],
    }),
  ],
})
```

---

## 3. Validation Architecture

- **Section 4**: Validates merged header row (`columnSpan: 4`) and 4 data rows.
- **Section 5**: Validates 5-column financial ledger with currency symbols and right-aligned numeric cells.
- **Section 10**: Validates 8-column wide grid ("ID", "Hostname", "Zone", "CPU%", "RAM%", "Disk%", "Latency", "Status").

---
*Research complete: 2026-11-07*
