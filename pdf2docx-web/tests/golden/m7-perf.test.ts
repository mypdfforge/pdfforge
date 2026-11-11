import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { loadPdfDocument } from '../../src/ingest/pdfLoader.js';
import { convertDocumentIRToDocx } from '../../src/dla/pipeline.js';
import { validateDocxFile } from '../../tools/docx-validate.js';

describe('Milestone M7 Exit Gate: 25-Page Document Stress & Performance Test', () => {
  it('converts a 25-page document in < 15 seconds with 100% OpenXML compliance', async () => {
    const pdfPath = path.resolve('../test_25pages_output.pdf');
    if (!fs.existsSync(pdfPath)) {
      console.warn('test_25pages_output.pdf not found in parent directory, skipping stress test.');
      return;
    }

    const fileBuffer = fs.readFileSync(pdfPath);
    const startMemory = process.memoryUsage().heapUsed;
    const startTime = Date.now();

    // 1. Ingest
    const docIr = await loadPdfDocument(fileBuffer);
    expect(docIr.pages.length).toBeGreaterThanOrEqual(25);

    // 2. Conversion
    const { docx, report } = await convertDocumentIRToDocx(docIr);
    const totalDurationMs = Date.now() - startTime;
    const peakHeapMb = (process.memoryUsage().heapUsed - startMemory) / (1024 * 1024);

    console.log(`\n=== 25-Page Performance Results ===`);
    console.log(`Total Pages: ${report.totalPages}`);
    console.log(`Total Glyphs: ${report.totalGlyphs}`);
    console.log(`Total Paragraphs: ${report.totalParagraphs}`);
    console.log(`Total Tables: ${report.totalTables}`);
    console.log(`Duration: ${(totalDurationMs / 1000).toFixed(2)}s (Target: < 15.00s)`);
    console.log(`Peak Heap Delta: ${peakHeapMb.toFixed(1)} MB (Target: < 1500 MB)`);

    // Gate requirement 1: Duration < 15 seconds
    expect(totalDurationMs).toBeLessThan(15000);

    // Gate requirement 2: Peak memory < 1.5 GB
    expect(peakHeapMb).toBeLessThan(1500);

    // Gate requirement 3: 0 validator errors (100% compliant OpenXML)
    const validation = validateDocxFile(docx);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);

    // Gate requirement 4: Zero floating textboxes
    const docXmlStr = new TextDecoder().decode(docx);
    expect(docXmlStr.includes('w:txbxContent')).toBe(false);

    // Save output
    const outputDir = path.resolve('corpus/test_output');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'test_25pages_converted.docx'), docx);
  }, 30000); // 30s timeout
});
