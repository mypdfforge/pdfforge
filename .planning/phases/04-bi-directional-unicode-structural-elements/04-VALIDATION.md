# Phase 4 Validation Plan

## Test Strategy
1. **Unit Testing (`vitest run tests/word-to-pdf`)**:
   - `bidiUnicode.test.js`:
     - Test Arabic text detection and `isRTL` flagging.
     - Test Hebrew text detection.
     - Test Devanagari and CJK unicode preservation and font hints.
   - `structuralElements.test.js`:
     - Test callout detection for `[NOTE]`, `[WARNING]`, `[CRITICAL]`.
     - Test code block shading and monospace classification.
     - Test checkbox detection (`[ ]`, `[x]`, `☑`, `☐`).
2. **Build Verification**:
   - `npm run build` succeeds cleanly without packaging regressions.
3. **End-to-End Stress Suite**:
   - Run complete suite with all Phase 1-4 tests passing.
