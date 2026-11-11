# Plan 02-01 Summary: Inline Styling & Super/Subscript Detection

**Executed:** 2026-11-07
**Status:** Completed
**Requirements:** TYPO-01, TYPO-02, TYPO-03

## What Was Built
1. Enhanced `frontend/src/utils/pdfLayoutSegmenter.js`:
   - Updated `groupItemsIntoLines` to retain distinct `line.spans` instead of dropping run-level formatting.
   - Robust Baseline Calculation: computes `baselineY` strictly from dominant-sized items (ignoring superscripts/subscripts), preventing baseline inflation.
   - Script Detection:
     - Superscripts (e.g. $E=mc^2$): flags spans where `size <= 0.88 * line.size` and `y - baselineY >= 0.10 * line.size` with `superScript: true`.
     - Subscripts (e.g. $H_2SO_4$): flags spans where `size <= 0.88 * line.size` and `baselineY - y >= 0.08 * line.size` with `subScript: true`.
   - Color Detection: maps color keywords ("Red" -> "FF0000", "Green" -> "008000", "Blue" -> "0000FF", etc.) to 6-digit hex color strings.
   - Merging: consolidates adjacent spans sharing identical styling to keep AST compact.
2. Verified with unit tests in `frontend/tests/word-to-pdf/layoutSegmenter.test.js`:
   - Tested chemical formulas ($H_2SO_4$) &rarr; verified digits '2' and '4' receive `subScript: true`.
   - Tested mathematical powers ($E = mc^2$) &rarr; verified exponent '2' receives `superScript: true`.
   - Tested color runs &rarr; verified RGB hex values.
