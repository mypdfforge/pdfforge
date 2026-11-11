---
last_mapped_commit: b21884f1c66d14e46e24dcca588d6fb591273045
last_mapped_at: 2026-11-07
---
# External Integrations

**Analysis Date:** 2026-11-07

## APIs & External Services

**Document Font Delivery:**
- Google Fonts Raw CDN - Used in `backend/routes/export.py` to retrieve metric-compatible TrueType fonts (`NotoSans-Regular.ttf`, `NotoSans-Bold.ttf`) when not cached locally.
  - Client: Python `urllib.request`
  - Fallback: System standard metric substitutes (`helv`, `hebo`)

**Optical Character Recognition (OCR):**
- Tesseract OCR Engine - Integrated in `backend/routes/tools.py` via `pytesseract` for image-to-text and scanned PDF extraction.
  - Native binary dependency: `tesseract-ocr` host package

## Data Storage

**Databases:**
- None. The architecture is stateless by design. Document streams and uploaded binaries are processed in-memory or transient disk buffers.

**File Storage:**
- Local filesystem & temporary directories only:
  - Backend creates isolated ephemeral directories via `tempfile.mkdtemp()` with safe path containment (`backend/services/safe_paths.py`).
  - Temporary files are explicitly purged via `shutil.rmtree(tmp, ignore_errors=True)` upon task completion.
  - Browser IndexedDB / Memory Cache: Progressive thumbnail caching in `frontend/src/utils/thumbnailCache.js` for instant page previewing.

**Caching:**
- In-memory object URLs (`URL.createObjectURL`) and blob buffers for client-side processing.
- Font glyph measurement cache and subset cache in `frontend/src/editor/core/`.

## Authentication & Identity

**Auth Provider:**
- None required for core conversions. The application provides instant client-side and open API execution without mandatory user accounts.
- Local storage session history: Tracks recent user exports in `frontend/src/components/FileHistory.jsx` within the user's browser sandbox.

## Monitoring & Observability

**Error Tracking:**
- Console error logging and standard HTTP exceptions (`fastapi.HTTPException`).
- Detailed conversion diagnostics logged to browser dev console and FastAPI stdout.

**Rate Limiting & Protection:**
- Custom `LimitsMiddleware` in `backend/limits.py` enforcing payload size ceilings and concurrency controls.

## CI/CD & Deployment

**Hosting:**
- Backend: Configured for Render deployment via `backend/render.yaml` with Python 3 environment.
- Frontend: Static site distribution compatible with Vite build output (`frontend/dist/`).

**CI Pipeline:**
- Local automated test suites:
  - `npm run test` (Node test runner)
  - `npm run test:word` (Vitest suite)
  - `npm run test:e2e` (Playwright suite)

## Environment Configuration

**Required env vars:**
- `ALLOWED_ORIGINS`: Comma-separated allowed frontend origins for CORS (default: `http://localhost:5173`).
- `PORT`: Server listening port (default: `8000`).

**Secrets location:**
- No third-party API keys or sensitive secret credentials required. All processing runs locally or on self-hosted instances.

## Webhooks & Callbacks

**Incoming:**
- None. Synchronous request-response and streaming HTTP downloads.

**Outgoing:**
- None.

---

*Integration audit: 2026-11-07*
