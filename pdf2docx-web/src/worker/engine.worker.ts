import * as Comlink from 'comlink';
import { loadPdfDocument } from '../ingest/pdfLoader.js';
import { convertDocumentIRToDocx } from '../dla/pipeline.js';
import { ConversionEngineWorker, ProgressCallback } from './protocol.js';
import { BuildOptions } from '../ast/build.js';

export const engineWorker: ConversionEngineWorker = {
  async convert(
    fileBuffer: ArrayBuffer,
    options: BuildOptions = {},
    onProgress?: ProgressCallback
  ) {
    if (onProgress) {
      onProgress('Ingest', 0, 1);
    }

    const docIr = await loadPdfDocument(fileBuffer, (current, total) => {
      if (onProgress) {
        onProgress('Ingest', current, total);
      }
    });

    if (onProgress) {
      onProgress('DLA', 1, docIr.pages.length);
    }

    const result = await convertDocumentIRToDocx(docIr, options);

    if (onProgress) {
      onProgress('Done', docIr.pages.length, docIr.pages.length);
    }

    return {
      docx: result.docx,
      report: result.report,
    };
  },
};

Comlink.expose(engineWorker);
