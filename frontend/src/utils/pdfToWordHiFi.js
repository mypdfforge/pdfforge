/** Bridge: engineHost → pdf2docx-web, with abort, progress and the OpenXML gate. */
import { verifyDocxBlob } from './docxVerify.js';

export async function pdfToWordHiFi(file, onProgress, opts = {}) {
  const { signal } = opts;
  const throwIfAborted = () => {
    if (signal?.aborted) {
      const e = new Error('Conversion cancelled');
      e.code = 'ABORTED';
      throw e;
    }
  };
  throwIfAborted();
  const [{ loadPdfDocument }, { convertDocumentIRToDocx }] = await Promise.all([
    import('../../../pdf2docx-web/src/ingest/pdfLoader.ts'),
    import('../../../pdf2docx-web/src/dla/pipeline.ts'),
  ]);
  const buf = await file.arrayBuffer();
  throwIfAborted();
  const ir = await loadPdfDocument(new Uint8Array(buf), (cur, total) => {
    throwIfAborted();
    onProgress?.(0.05 + 0.6 * (cur / Math.max(1, total)));
  });
  throwIfAborted();
  const { docx, report } = await convertDocumentIRToDocx(ir, { title: file.name?.replace(/\.pdf$/i, '') });
  ir.binaryStore?.clear?.();
  const blob = new Blob([docx], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const gate = await verifyDocxBlob(blob);
  onProgress?.(1);
  return { data: blob, warnings: gate.ok ? [] : gate.violations.map(v => ({ code: v.code, message: v.detail })), stats: report };
}
