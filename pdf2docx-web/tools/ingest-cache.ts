import fs from 'fs';
import path from 'path';
import { PageIR } from '../src/core/pageir.js';

export class IngestCache {
  private cacheDir: string;

  constructor(cacheDir: string = 'corpus/.cache') {
    this.cacheDir = cacheDir;
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  getCachePath(docId: string, pageIndex: number): string {
    const docDir = path.join(this.cacheDir, docId);
    if (!fs.existsSync(docDir)) {
      fs.mkdirSync(docDir, { recursive: true });
    }
    return path.join(docDir, `p${pageIndex}.json`);
  }

  has(docId: string, pageIndex: number): boolean {
    return fs.existsSync(this.getCachePath(docId, pageIndex));
  }

  get(docId: string, pageIndex: number): PageIR | null {
    const p = this.getCachePath(docId, pageIndex);
    if (!fs.existsSync(p)) return null;
    try {
      const data = fs.readFileSync(p, 'utf-8');
      return JSON.parse(data) as PageIR;
    } catch {
      return null;
    }
  }

  set(docId: string, pageIndex: number, pageIr: PageIR): void {
    const p = this.getCachePath(docId, pageIndex);
    fs.writeFileSync(p, JSON.stringify(pageIr), 'utf-8');
  }
}
