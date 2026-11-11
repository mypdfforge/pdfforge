import React, { useState } from 'react';
import * as Comlink from 'comlink';
import { ConversionEngineWorker } from '../worker/protocol.js';

export function App() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string>('Ready');
  const [progress, setProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [converting, setConverting] = useState<boolean>(false);
  const [report, setReport] = useState<any>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const handleConvert = async () => {
    if (!file) return;
    setConverting(true);
    setStatus('Initializing Worker...');
    try {
      const worker = new Worker(new URL('../worker/engine.worker.ts', import.meta.url), {
        type: 'module',
      });
      const engine = Comlink.wrap<ConversionEngineWorker>(worker);

      const buffer = await file.arrayBuffer();
      setStatus('Converting PDF...');

      const result = await engine.convert(
        buffer,
        { mode: 'flow' },
        Comlink.proxy((stage: string, current: number, total: number) => {
          setStatus(`${stage} (${current}/${total})`);
          setProgress({ current, total });
        })
      );

      setReport(result.report);
      setStatus('Done! Downloading DOCX...');

      // Trigger download
      const blob = new Blob([result.docx], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name.replace(/\.pdf$/i, '') + '.docx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error(err);
      setStatus(`Error: ${err.message || String(err)}`);
    } finally {
      setConverting(false);
    }
  };

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', padding: '2rem', maxWidth: '700px', margin: '0 auto' }}>
      <h1>pdf2docx-web</h1>
      <p style={{ color: '#666' }}>100% Client-Side PDF to DOCX Engine (No uploads, WebAssembly / Web Workers)</p>
      
      <div style={{ border: '2px dashed #bbb', borderRadius: '8px', padding: '2.5rem', textAlign: 'center', marginTop: '1.5rem' }}>
        <input type="file" accept=".pdf" onChange={handleFileChange} disabled={converting} />
        {file && <p style={{ marginTop: '1rem', fontWeight: 600 }}>Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)</p>}
      </div>

      <div style={{ marginTop: '1.5rem' }}>
        <button
          onClick={handleConvert}
          disabled={!file || converting}
          style={{
            padding: '0.75rem 1.5rem',
            backgroundColor: !file || converting ? '#aaa' : '#0066cc',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            fontSize: '1rem',
            cursor: !file || converting ? 'not-allowed' : 'pointer',
          }}
        >
          {converting ? 'Converting...' : 'Convert to Word (.docx)'}
        </button>
      </div>

      <div style={{ marginTop: '1.5rem', padding: '1rem', backgroundColor: '#f5f5f5', borderRadius: '4px' }}>
        <strong>Status:</strong> {status}
        {progress.total > 0 && (
          <div style={{ marginTop: '0.5rem' }}>
            <progress value={progress.current} max={progress.total} style={{ width: '100%' }} />
          </div>
        )}
      </div>

      {report && (
        <div style={{ marginTop: '1.5rem', padding: '1rem', backgroundColor: '#eef8ee', borderRadius: '4px' }}>
          <h3>Conversion Report</h3>
          <p>Pages: {report.totalPages}</p>
          <p>Glyphs: {report.totalGlyphs}</p>
          <p>Paragraphs: {report.totalParagraphs}</p>
          <p>Time: {report.durationMs} ms</p>
        </div>
      )}
    </div>
  );
}
