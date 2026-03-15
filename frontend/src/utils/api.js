import axios from 'axios'

// In production, VITE_API_URL is set to your Render backend URL
// In development, Vite proxy forwards /api to localhost:8000
const BASE = import.meta.env.VITE_API_URL || '/api'

const api = axios.create({ baseURL: BASE })

// Generic POST helper
export const _post = (path, form) => api.post(path, form, { responseType:'blob' })

export const uploadPDF      = (file)              => { const f=new FormData(); f.append('file',file); return api.post('/upload',f) }
export const exportPDF      = (sid,blocks)        => api.post(`/export/${sid}`,{blocks},{responseType:'blob'})
export const mergePDFs      = (files)             => { const f=new FormData(); files.forEach(x=>f.append('files',x)); return _post('/tools/merge',f) }
export const splitPDF       = (file,pages)        => { const f=new FormData(); f.append('file',file); f.append('pages',pages); return _post('/tools/split',f) }
export const rotatePDF      = (file,deg,pages)    => { const f=new FormData(); f.append('file',file); f.append('degrees',deg); f.append('pages',pages); return _post('/tools/rotate',f) }
export const compressPDF    = (file)              => { const f=new FormData(); f.append('file',file); return _post('/tools/compress',f) }
export const watermarkPDF   = (file,text,opacity) => { const f=new FormData(); f.append('file',file); f.append('text',text); f.append('opacity',opacity); return _post('/tools/watermark',f) }
export const pageNumbersPDF = (file,pos)          => { const f=new FormData(); f.append('file',file); f.append('position',pos); return _post('/tools/page-numbers',f) }
export const pdfToImages    = (file)              => { const f=new FormData(); f.append('file',file); return _post('/tools/pdf-to-images',f) }
export const imageToPDF     = (files)             => { const f=new FormData(); files.forEach(x=>f.append('files',x)); return _post('/tools/image-to-pdf',f) }
export const deletePages    = (file,pages)        => { const f=new FormData(); f.append('file',file); f.append('pages',pages); return _post('/tools/delete-pages',f) }
export const stampPDF       = (file,label,pages)  => { const f=new FormData(); f.append('file',file); f.append('label',label); f.append('pages',pages); return _post('/tools/stamp',f) }
export const findReplace    = (file,find,rep,mc,ww) => { const f=new FormData(); f.append('file',file); f.append('find',find); f.append('replace',rep); f.append('match_case',mc); f.append('whole_word',ww); return _post('/tools/find-replace',f) }
export const wordToPDF      = (file)              => { const f=new FormData(); f.append('file',file); return _post('/tools/word-to-pdf',f) }
export const pdfToWord      = (file)              => { const f=new FormData(); f.append('file',file); return _post('/tools/pdf-to-word',f) }
export const pdfToJpg       = (file)              => { const f=new FormData(); f.append('file',file); return _post('/tools/pdf-to-jpg',f) }
export const pdfToPptx      = (file)              => { const f=new FormData(); f.append('file',file); return _post('/tools/pdf-to-pptx',f) }
export const pdfToXlsx      = (file)              => { const f=new FormData(); f.append('file',file); return _post('/tools/pdf-to-xlsx',f) }
export const pdfToPdfa      = (file)              => { const f=new FormData(); f.append('file',file); return _post('/tools/pdf-to-pdfa',f) }

export const downloadBlob = (data, filename, type='application/pdf') => {
  const url = URL.createObjectURL(new Blob([data],{type}))
  const a   = document.createElement('a')
  a.href=url; a.download=filename; a.click()
  URL.revokeObjectURL(url)
}
