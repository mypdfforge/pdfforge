(async () => {
  const pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  // Fetch payload
  const res = await fetch('http://localhost:4173/../docx2pdf/render_payload.json').catch(() => null);
  // Or read from a global variable set by caller
  return { ready: true };
})()
