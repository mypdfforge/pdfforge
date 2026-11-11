---
last_mapped_commit: b21884f1c66d14e46e24dcca588d6fb591273045
last_mapped_at: 2026-11-07
---
# Coding Conventions

**Analysis Date:** 2026-11-07

## Naming Patterns

**Files:**
- React components use PascalCase: `frontend/src/components/SmartUpload.jsx`, `frontend/src/pages/MergeToolPage.jsx`
- Client utilities use camelCase: `frontend/src/utils/convertClient.js`, `frontend/src/utils/zipClient.js`
- Python backend modules use snake_case: `backend/routes/tools.py`, `backend/services/safe_paths.py`
- Test files suffix with `.test.js` or `.test.ts`: `frontend/tests/word-to-pdf/engineHost.test.js`

**Functions & Variables:**
- JavaScript / TypeScript: camelCase for functions (`pdfToWord`, `applyPageModifications`, `downloadBlob`) and variables (`docState`, `fileKey`)
- Python: snake_case for functions and local variables (`safe_join`, `apply_changes`, `ensure_noto`, `pdf_to_word`)
- Constants: UPPER_SNAKE_CASE (`LIMITS`, `CONFIGS`, `GRID_TOOLS`, `A4`)

**Types & Interfaces:**
- PascalCase for TypeScript interfaces, types, and Python Pydantic models (`DocState`, `TextElement`, `ExportBody`, `FileCheck`)

## Code Style

**JavaScript / TypeScript:**
- Modern ES Modules (`import`/`export`)
- Explicit async/await for asynchronous file and stream operations
- Functional React components using hooks (`useState`, `useEffect`, `useCallback`, `useRef`)
- Defensive checks for canvas contexts, DOM elements, and file streams

**Python:**
- Clean FastAPI route decorators (`@router.post(...)`)
- Explicit type annotations on endpoint arguments (`file: UploadFile = File(...)`)
- Resource cleanup using context managers (`with open(...) as f`) and explicit cleanup in `finally` blocks or `shutil.rmtree`

## Import Organization

**JavaScript / React:**
1. Core React imports (`import React, { useState, useEffect } from 'react'`)
2. Third-party libraries (`lucide-react`, `pdfjs-dist`, `jspdf`, `docx`)
3. Internal feature components and pages (`from '../components/...'`)
4. Internal utilities and helpers (`from '../utils/...'`)

**Python:**
1. Standard library modules (`os`, `tempfile`, `shutil`, `base64`, `math`, `pathlib`)
2. Third-party frameworks (`fastapi`, `pydantic`, `fitz`)
3. Internal service and route imports (`from services.safe_paths import safe_join`)

## Error Handling

**Backend Strategy:**
- Raise typed `fastapi.HTTPException` with explicit HTTP status codes (e.g., 400 for bad input, 500 for missing dependencies)
- Catch specific library errors (`fitz.FileDataError`, `docx.opc.exceptions.PackageNotFoundError`)
- Always execute cleanup of temporary directories in `finally` or immediately before returning

**Frontend Strategy:**
- Try/catch wrappers around client-side document conversions with fallback mechanisms (e.g. WASM falling back to OOXML parser)
- User-facing error notifications via toast alerts or UI status badges without unhandled promise rejections

## Security Conventions

- **Path Traversal Protection:** Always use `safe_join(base_dir, untrusted_filename)` from `backend/services/safe_paths.py` instead of naive `os.path.join` to prevent directory traversal exploits.
- **XML Sanitization:** Cleanse illegal XML control characters (`[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]`) prior to feeding text to Word/Excel generation engines.
- **Rate Limiting:** Enforce maximum file size and concurrent request limits through `backend/limits.py`.

---

*Convention analysis: 2026-11-07*
