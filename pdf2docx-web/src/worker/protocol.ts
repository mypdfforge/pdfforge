import { ConvertReport } from '../dla/pipeline.js';
import { BuildOptions } from '../ast/build.js';

export type ProgressCallback = (stage: string, page: number, total: number) => void;

export interface ConversionEngineWorker {
  convert(
    fileBuffer: ArrayBuffer,
    options?: BuildOptions,
    onProgress?: ProgressCallback
  ): Promise<{ docx: Uint8Array; report: ConvertReport }>;
}
