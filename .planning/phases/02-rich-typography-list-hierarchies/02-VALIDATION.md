---
phase: '2'
phase_slug: rich-typography-list-hierarchies
created_at: '2026-11-07'
validation_strategy_version: '1.0'
---

# Phase 2: Rich Typography & List Hierarchies - Validation Strategy

## Core Requirements Covered
- **TYPO-01**: Run-level bold, italic, strikethrough, and underline attributes
- **TYPO-02**: Mathematical and chemical superscripts ($E=mc^2$) and subscripts ($H_2SO_4$)
- **TYPO-03**: Hex colors and highlight runs
- **LIST-01**: Bullet (•, ◦, -) and outline numbering (`1.2.1.a`) recognition
- **LIST-02**: 7-level hanging indent hierarchy calculation in twips

## Validation Tests

### 1. Script Detection Test (Super/Subscript)
- **Input**: Section 9 spans ("H 2 SO 4", "E = mc 2 + 2 n-1")
- **Target**: Ensure digits '2' and '4' in chemical formulas have `subScript: true`, and powers have `superScript: true`.

### 2. Typographic Attributes Test
- **Input**: Section 9 items with bold, italic, underline, strikethrough
- **Target**: Distinct `TextRun` items are emitted with corresponding boolean flags.

### 3. List Indentation Stress Test
- **Input**: Section 15 of `test_25pages_output.pdf` (7-Level Nested Bullet Hierarchy)
- **Target**: Indent levels scale from level 1 to level 7 with non-overflowing twip values (`level * 360 <= 2520`).

---
*Validation strategy created: 2026-11-07*
