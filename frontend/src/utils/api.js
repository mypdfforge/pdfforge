import axios from 'axios'

// Your Cloudflare Worker URL (update this after deploying the Worker)
const BRAIN_URL = import.meta.env.VITE_BRAIN_URL || 'https://pdfforge-brain.YOUR-SUBDOMAIN.workers.dev'

const HF_NODES = [
  'https://mypdfforge-pdfforge-node-1.hf.space',
  'https://mypdfforge-pdfforge-node-2.hf.space',
  'https://mypdfforge-pdfforge-node-3.hf.space',
  'https://mypdfforge-pdfforge-node-4.hf.space',
  'https://mypdfforge-pdfforge-node-5.hf.space',
]

if (typeof window !== 'undefined') {
  HF_NODES.forEach(url => {
    fetch(`${url}/health`, { method: 'GET' }).catch(() => {})
  })
}

const brain = axios.create({ baseURL: BRAIN_URL })

export const _post = (path, form) =>
  brain.post(path, form, { responseType: 'blob', timeout: 120000 })

export const mergePDFs      = (files)               => { const f=new FormData(); files.forEach(x=>f.append('files',x)); return _post('/api/tools/merge',f) }
export const splitPDF       = (file,p)              => { const f=new FormData(); f.append('file',file); f.append('pages',p); return _post('/api/tools/split',f) }
export const rotatePDF      = (file,d,p)            => { const f=new FormData(); f.append('file',file); f.append('degrees',d); f.append('pages',p); return _post('/api/tools/rotate',f) }
export const compressPDF    = (file)                => { const f=new FormData(); f.append('file',file); return _post('/api/tools/compress',f) }
export const watermarkPDF   = (file,text,opacity)   => { const f=new FormData(); f.append('file',file); f.append('text',text); f.append('opacity',opacity); return _post('/api/tools/watermark',f) }
export const pageNumbersPDF = (file,pos)            => { const f=new FormData(); f.append('file',file); f.append('position',pos); return _post('/api/tools/page-numbers',f) }
export const pdfToImages    = (file)                => { const f=new FormData(); f.append('file',file); return _post('/api/tools/pdf-to-images',f) }
export const imageToPDF     = (files)               => { const f=new FormData(); files.forEach(x=>f.append('files',x)); return _post('/api/tools/image-to-pdf',f) }
export const deletePages    = (file,p)              => { const f=new FormData(); f.append('file',file); f.append('pages',p); return _post('/api/tools/delete-pages',f) }
export const stampPDF       = (file,label,pages)    => { const f=new FormData(); f.append('file',file); f.append('label',label); f.append('pages',pages); return _post('/api/tools/stamp',f) }
export const findReplace    = (file,find,rep,mc,ww) => { const f=new FormData(); f.append('file',file); f.append('find',find); f.append('replace',rep); f.append('match_case',mc); f.append('whole_word',ww); return _post('/api/tools/find-replace',f) }
export const wordToPDF      = (file)                => { const f=new FormData(); f.append('file',file); return _post('/api/tools/word-to-pdf',f) }
export const pdfToWord      = (file)                => { const f=new FormData(); f.append('file',file); return _post('/api/tools/pdf-to-word',f) }
export const pdfToJpg       = (file)                => { const f=new FormData(); f.append('file',file); return _post('/api/tools/pdf-to-jpg',f) }
export const pdfToPptx      = (file)                => { const f=new FormData(); f.append('file',file); return _post('/api/tools/pdf-to-pptx',f) }
export const pdfToXlsx      = (file)                => { const f=new FormData(); f.append('file',file); return _post('/api/tools/pdf-to-xlsx',f) }
export const pdfToPdfa      = (file)                => { const f=new FormData(); f.append('file',file); return _post('/api/tools/pdf-to-pdfa',f) }

export const uploadPDF = (file)       => { const f=new FormData(); f.append('file',file); return brain.post('/api/upload',f) }
export const exportPDF = (sid,blocks) => brain.post(`/api/export/${sid}`,{blocks},{responseType:'blob'})

export const downloadBlob = (data, filename, type='application/pdf') => {
  const url = URL.createObjectURL(new Blob([data],{type}))
  const a   = document.createElement('a')
  a.href=url; a.download=filename; a.click()
  URL.revokeObjectURL(url)
}
