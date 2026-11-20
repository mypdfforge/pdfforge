import { clientMerge, clientSplit, clientExtract, clientRotate, clientDeletePages, clientDuplicatePage, clientCompress, clientRepair } from './pdfClient'
import { clientPdfToImages, clientPdfToJpg } from './pdfToImageClient'
import axios from 'axios'

// ── Render backend (decommissioned - all tools run client-side) ──
export const wakeRender = () => {}

export const _post = (path, form, timeout = 300000) =>
  Promise.reject(new Error('Backend server is decommissioned. All operations now run 100% in-browser.'))

// Compress uses XHR directly — no axios timeout, real upload progress
export const compressPDFServer = (file, onProgress) =>
  new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('file', file)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${RENDER_URL}/tools/compress`)
    xhr.responseType = 'blob'
    xhr.timeout = 0  // no timeout — large files can take minutes
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress)
        onProgress({ stage: 'uploading', done: e.loaded, total: e.total })
    }
    xhr.upload.onload = () => {
      // Upload finished, server is now processing
      if (onProgress) onProgress({ stage: 'processing', done: 1, total: 1, label: 'Compressing on server…' })
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ data: xhr.response })
      } else {
        reject(new Error(`Server error ${xhr.status}`))
      }
    }
    xhr.onerror   = () => reject(new Error('Network error — check your connection'))
    xhr.ontimeout = () => reject(new Error('Request timed out'))
    xhr.send(form)
  })

export const mergePDFs      = (files)               => clientMerge(files)
export const splitPDF       = (file,p)              => clientSplit(file,p)
export const rotatePDF      = (file,d,p)            => clientRotate(file,d,p)
export const compressPDF    = (file, onProgress) => clientCompress(file, onProgress)
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
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data],{type}))
  const a   = document.createElement('a')
  a.href=url; a.download=filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
