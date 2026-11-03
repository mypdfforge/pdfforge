import { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { AlertCircle, CheckCircle, Download, FileText, Upload, X } from 'lucide-react'
import TopBar from '../../../components/TopBar'
import { useWordToPdf } from '../state/useWordToPdf.js'
import { MAX_FILE_BYTES } from '../lib/probe.js'
import { downloadBlob, formatBytes, pdfName, zipPdfs } from '../lib/download.js'

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const card = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: '12px',
}
const notice = (color) => ({
  display: 'flex', gap: '10px', alignItems: 'flex-start',
  padding: '12px 14px', borderRadius: '10px', fontSize: '13px', lineHeight: 1.5,
  color: 'var(--text)', background: 'var(--bg2)', border: `1px solid ${color}`,
})
const primaryBtn = (disabled) => ({
  background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '10px',
  padding: '12px 22px', fontSize: '14px', fontWeight: 600,
  cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
})
const ghostBtn = {
  background: 'transparent', color: 'var(--text)', border: '1px solid var(--border)',
  borderRadius: '8px', padding: '7px 12px', fontSize: '13px', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: '6px',
}

function progressText(item) {
  const base = item.message || 'Working...'
  if (item.bytesTotal) {
    const mb = (n) => (n / 1048576).toFixed(1)
    const speed = item.speedMBs ? `, ${item.speedMBs} MB/s` : ''
    return `${base} ${mb(item.bytesLoaded)} of ${mb(item.bytesTotal)} MB${speed}`
  }
  return base
}

function rejectionText(rejections) {
  return rejections
    .map((r) => {
      const code = r.errors?.[0]?.code
      if (code === 'file-too-large') return `${r.file.name}: over the 50 MB limit.`
      if (code === 'file-invalid-type') return `${r.file.name}: only .docx and .doc files work.`
      return `${r.file.name}: ${r.errors?.[0]?.message || 'rejected.'}`
    })
    .join(' ')
}

function ItemRow({ item, onCancel, onRemove }) {
  const { status } = item
  const color =
    status === 'error' ? 'var(--red)' : status === 'done' ? 'var(--green)' : 'var(--text3)'

  let text = ''
  if (status === 'checking') text = 'Checking file...'
  else if (status === 'ready') text = `Ready, ${formatBytes(item.file.size)}`
  else if (status === 'converting') text = progressText(item)
  else if (status === 'done') text = `Done, PDF is ${formatBytes(item.pdf.size)}`
  else if (status === 'cancelled') text = 'Cancelled'
  else if (status === 'error') text = item.error

  return (
    <li style={{ ...card, padding: '12px 14px', display: 'flex', gap: '12px', alignItems: 'center', listStyle: 'none' }}>
      {status === 'done' ? <CheckCircle size={20} color="var(--green)" />
        : status === 'error' ? <AlertCircle size={20} color="var(--red)" />
        : <FileText size={20} color="var(--text3)" />}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.file.name}
        </div>
        <div style={{ fontSize: '12px', color, marginTop: '2px' }}>{text}</div>
        {status === 'converting' && (
          <div
            role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.percent || 0)}
            style={{ height: '4px', borderRadius: '2px', background: 'var(--border)', marginTop: '8px', overflow: 'hidden' }}
          >
            <div style={{ height: '100%', width: `${item.percent || 0}%`, background: 'var(--accent)', transition: 'width .2s linear' }} />
          </div>
        )}
      </div>

      {status === 'done' && (
        <button type="button" style={ghostBtn} onClick={() => downloadBlob(item.pdf, pdfName(item.file.name))}>
          <Download size={14} /> Download PDF
        </button>
      )}
      {status === 'converting' ? (
        <button type="button" style={ghostBtn} onClick={() => onCancel(item.id)}>Cancel</button>
      ) : (
        <button type="button" aria-label={`Remove ${item.file.name}`} style={{ ...ghostBtn, padding: '7px' }} onClick={() => onRemove(item.id)}>
          <X size={14} />
        </button>
      )}
    </li>
  )
}

export default function WordToPdfTool({
  onBack, dark, onToggleTheme, onGoHome,
  showCategories, activeCategory, onCategoryChange, search, onSearch,
}) {
  const { items, running, caps, engineCached, addFiles, start, cancel, remove, clear } = useWordToPdf()
  const [rejected, setRejected] = useState('')

  const onDrop = useCallback((accepted, rejections) => {
    setRejected(rejections.length ? rejectionText(rejections) : '')
    addFiles(accepted)
  }, [addFiles])

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: { [DOCX]: ['.docx'], 'application/msword': ['.doc'] },
    maxSize: MAX_FILE_BYTES,
    multiple: true,
    disabled: !caps.ok,
    noClick: true,
    noKeyboard: true,
  })

  const readyCount = items.filter((i) => i.status === 'ready').length
  const done = items.filter((i) => i.status === 'done')

  const downloadAll = async () => {
    const zip = await zipPdfs(done.map((i) => ({ name: pdfName(i.file.name), blob: i.pdf })))
    downloadBlob(zip, 'word_to_pdf.zip')
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      <TopBar
        onBack={onBack} title="Word to PDF" subtitle="Convert .docx to PDF."
        dark={dark} onToggleTheme={onToggleTheme} onGoHome={onGoHome}
        showCategories={showCategories} activeCategory={activeCategory} onCategoryChange={onCategoryChange}
        search={search} onSearch={onSearch}
      />

      <main style={{ flex: 1, width: '100%', maxWidth: '720px', margin: '0 auto', padding: '32px 20px 64px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <p style={{ fontSize: '13px', color: 'var(--text3)', margin: 0, lineHeight: 1.5 }}>
          Your files never leave this device. Conversion runs in your browser.
          {!engineCached && caps.ok && ' The first conversion downloads the converter (about 55 MB). Your browser keeps it for next time.'}
        </p>

        {caps.blockers.map((b) => (
          <div key={b} role="alert" style={notice('var(--red)')}>
            <AlertCircle size={18} color="var(--red)" style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>{b}</span>
          </div>
        ))}
        {caps.ok && caps.warnings.map((w) => (
          <div key={w} style={notice('var(--border)')}>
            <AlertCircle size={18} color="var(--text3)" style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>{w}</span>
          </div>
        ))}

        <div
          {...getRootProps()}
          style={{
            ...card,
            border: `2px dashed ${isDragActive ? 'var(--accent)' : 'var(--border)'}`,
            padding: '40px 20px', textAlign: 'center', opacity: caps.ok ? 1 : 0.5,
          }}
        >
          <input {...getInputProps()} />
          <Upload size={28} color="var(--text3)" />
          <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)', margin: '12px 0 4px' }}>
            {isDragActive ? 'Drop to add files' : 'Drop Word files here'}
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text3)', marginBottom: '16px' }}>
            .docx or .doc, up to 50 MB each. Add as many as you like.
          </div>
          <button type="button" style={primaryBtn(!caps.ok)} disabled={!caps.ok} onClick={open}>
            Choose files
          </button>
        </div>

        {rejected && <div role="alert" style={notice('var(--red)')}><span>{rejected}</span></div>}

        {items.length > 0 && (
          <>
            <ul aria-live="polite" style={{ margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {items.map((item) => (
                <ItemRow key={item.id} item={item} onCancel={cancel} onRemove={remove} />
              ))}
            </ul>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button type="button" style={primaryBtn(running || readyCount === 0)} disabled={running || readyCount === 0} onClick={start}>
                {running ? 'Converting...' : `Convert ${readyCount} ${readyCount === 1 ? 'file' : 'files'} to PDF`}
              </button>
              {done.length > 1 && (
                <button type="button" style={{ ...ghostBtn, padding: '12px 18px', fontSize: '14px' }} onClick={downloadAll}>
                  <Download size={16} /> Download all as ZIP
                </button>
              )}
              <button type="button" style={{ ...ghostBtn, padding: '12px 18px', fontSize: '14px' }} onClick={clear} disabled={running}>
                Clear list
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
