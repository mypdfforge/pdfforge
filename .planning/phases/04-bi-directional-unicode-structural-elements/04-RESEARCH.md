# Phase 4 Research: Bi-Directional Unicode & Structural Elements

## Problem Statement
The 25-page PDFForge QA stress suite contains:
1. Multi-lingual sections with Arabic and Hebrew right-to-left (RTL) text flows, Devanagari (Hindi/Sanskrit) complex ligatures, and CJK (Chinese, Japanese, Korean) characters.
2. Structural admonition callout boxes (`[NOTE]`, `[WARNING]`, `[CRITICAL]`, `[TIP]`, `[INFO]`) with colored left accent borders.
3. Monospace code blocks (`FLOW-03`) with dark or light syntax shading and indented margins.
4. Form fields and survey checkboxes (`[ ]`, `[x]`, `☑`, `☐`) that should render as discrete, clean form elements rather than unformatted brackets.

## Technical Feasibility in Browser Memory

### 1. Bi-Directional (RTL) Arabic & Hebrew
- In `docx`, a paragraph supports `bidirectional: true` and `alignment: AlignmentType.RIGHT`.
- Text runs support `rightToLeft: true`.
- Character ranges:
  - Arabic: `/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/`
  - Hebrew: `/[\u0590-\u05FF\uFB1D-\uFB4F]/`
- When a line contains predominantly RTL characters, tag `isRTL: true`.

### 2. Complex Brahmic/Devanagari & CJK
- Devanagari: `/[\u0900-\u097F]/`
- CJK: `/[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/`
- In `docx`, specify font families known for robust CJK/Indic coverage (`Segoe UI`, `Nirmala UI`, `Microsoft YaHei`) to avoid rendering fallback rectangles.

### 3. Structural Admonition Callout Boxes
- In `docx.Paragraph`:
  - `border: { left: { color: accentHex, space: 15, value: 'single', size: 24 } }`
  - `shading: { fill: bgHex }`
  - `indent: { left: 360 }`
- Admonition styling:
  - `NOTE` / `INFO`: Left border `#3B82F6` (blue), bg `#EFF6FF`
  - `WARNING`: Left border `#F59E0B` (amber), bg `#FFFBEB`
  - `CRITICAL` / `DANGER`: Left border `#EF4444` (red), bg `#FEF2F2`
  - `TIP` / `SUCCESS`: Left border `#10B981` (emerald), bg `#ECFDF5`

### 4. Monospace Code Blocks
- Detected when font family includes `courier`, `consolas`, `monaco`, `menlo` or character patterns match code syntax.
- Styled with `shading: { fill: 'F8FAFC' }`, font `Consolas`, size `9.5pt`, and subtle paragraph indentation.

### 5. Interactive Form Checkboxes
- Regex: `/^(\[\s*\]|\[[xX]\]|[☑☐])\s*(.*)$/`
- Unchecked: `☐` (`\u2610`)
- Checked: `☑` (`\u2611`)
- Render with dedicated bold symbol run and hanging indent for the following description text.
