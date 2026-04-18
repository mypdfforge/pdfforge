import { clientMerge, clientSplit, clientExtract, clientRotate, clientDeletePages, clientDuplicatePage, clientCompress, clientRepair } from './pdfClient'
import { clientPdfToImages, clientPdfToJpg } from './pdfToImageClient'
import axios from 'axios'

// ── Render backend (existing tools) ──────────────────────────
const RENDER_URL = import.meta.env.VITE_API_URL || 'https://mypdfforge.onrender.com/api'
const render = axios.create({ baseURL: RENDER_URL, timeout: 300000 })

// Wake up Render from sleep (free tier spins down after inactivity).
// Call this as early as possible so the cold start happens in the background.
export const wakeRender = () =>
  axios.get(`${RENDER_URL.replace('/api', '')}/api/health`, { timeout: 60000 }).catch(() => {})

// ── Cloudflare Brain (distributed grid tools) ─────────────────
const BRAIN_URL = import.meta.env.VITE_BRAIN_URL || ''
const brain = BRAIN_URL ? axios.create({ baseURL: BRAIN_URL }) : null

export const _post = (path, form, timeout = 300000) =>
  render.post(path, form, { responseType: 'blob', timeout })

export const mergePDFs      = (files)               => clientMerge(files)
export const splitPDF       = (file,p)              => clientSplit(file,p)
export const rotatePDF      = (file,d,p)            => clientRotate(file,d,p)
export const compressPDF    = (file)                => clientCompress(file)
export const watermarkPDF   = (file,text,opacity)   => { const f=new FormData(); f.append('file',file); f.append('text',text); f.append('opacity',opacity); return _post('/tools/watermark',f) }
export const pageNumbersPDF = (file,pos)            => { const f=new FormData(); f.append('file',file); f.append('position',pos); return _post('/tools/page-numbers',f) }
export const pdfToImages    = (file, onProgress)    => clientPdfToImages(file, onProgress)
export const imageToPDF     = (files)               => { const f=new FormData(); files.forEach(x=>f.append('files',x)); return _post('/tools/image-to-pdf',f) }
export const deletePages    = (file,p)              => clientDeletePages(file,p)
export const stampPDF       = (file,label,pages)    => { const f=new FormData(); f.append('file',file); f.append('label',label); f.append('pages',pages); return _post('/tools/stamp',f) }
export const findReplace    = (file,find,rep,mc,ww) => { const f=new FormData(); f.append('file',file); f.append('find',find); f.append('replace',rep); f.append('match_case',mc); f.append('whole_word',ww); return _post('/tools/find-replace',f) }
export const wordToPDF      = (file)                => { const f=new FormData(); f.append('file',file); return _post('/tools/word-to-pdf',f) }
export const pdfToWord      = (file)                => { const f=new FormData(); f.append('file',file); return _post('/tools/pdf-to-word',f) }
export const pdfToJpg       = (file, onProgress)    => clientPdfToJpg(file, onProgress)
export const pdfToPptx      = (file)                => { const f=new FormData(); f.append('file',file); return _post('/tools/pdf-to-pptx',f) }
export const pdfToXlsx      = (file)                => { const f=new FormData(); f.append('file',file); return _post('/tools/pdf-to-xlsx',f) }
export const pdfToPdfa      = (file)                => { const f=new FormData(); f.append('file',file); return _post('/tools/pdf-to-pdfa',f) }

export const uploadPDF = (file)       => { const f=new FormData(); f.append('file',file); return render.post('/upload',f) }
export const exportPDF = (sid,blocks) => render.post(`/export/${sid}`,{blocks},{responseType:'blob'})

export const downloadBlob = (data, filename, type='application/pdf') => {
  const url = URL.createObjectURL(new Blob([data],{type}))
  const a   = document.createElement('a')
  a.href=url; a.download=filename; a.click()
  URL.revokeObjectURL(url)
}
