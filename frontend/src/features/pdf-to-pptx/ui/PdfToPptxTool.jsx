import { useCallback, useEffect, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Download,
  FileText,
  Layers,
  Presentation,
  RotateCw,
  Upload,
  X,
  Zap,
} from 'lucide-react'
import TopBar from '../../../components/TopBar'
import { usePdfToPptx, outputName } from '../state/usePdfToPptx.js'
import { downloadBlob, formatBytes, zipPptx } from '../lib/download.js'
import { formatEta } from '../../../utils/pdfToWordUtils.js'

const card = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: '12px',
}

const notice = (color) => ({
  display: 'flex',
  gap: '10px',
  alignItems: 'flex-start',
  padding: '12px 14px',
  borderRadius: '10px',
  fontSize: '13px',
  lineHeight: 1.5,
  color: 'var(--text)',
  background: 'var(--bg2)',
  border: `1px solid ${color}`,
})

const primaryBtn = (disabled) => ({
  background: 'var(--accent)',
  color: '#fff',
  border: 'none',
  borderRadius: '10px',
  padding: '12px 22px',
  fontSize: '14px',
  fontWeight: 600,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.5 : 1,
  display: 'inline-flex',
  alignItems: 'center',
  gap: '8px',
})

const ghostBtn = {
  background: 'transparent',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '7px 12px',
  fontSize: '13px',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
}

function OptionPill({ active, disabled, onClick, icon, title, desc }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        flex: 1,
        minWidth: '170px',
        textAlign: 'left',
        padding: '10px 12px',
        borderRadius: '10px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        background: active ? 'rgba(234,88,12,0.08)' : 'var(--bg3)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '9px',
      }}
    >
      <span style={{ color: active ? 'var(--accent)' : 'var(--text3)', marginTop: '2px', flexShrink: 0 }}>{icon}</span>
      <span>
        <span style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>{title}</span>
        <span style={{ display: 'block', fontSize: '11.5px', color: 'var(--text3)', lineHeight: 1.35, marginTop: '2px' }}>{desc}</span>
      </span>
    </button>
  )
}

function ItemRow({ item, onDownload, onCancel, onRetry, onRemove }) {
  const { status, percent, message, error, warningCount, pagesPerSec, etaSec, stats } = item

  const color =
    status === 'error'
      ? 'var(--red)'
      : status === 'done'
      ? 'var(--green)'
      : 'var(--text3)'

  let text = ''
  if (status === 'ready') {
    text = `Ready • ${formatBytes(item.file.size)}`
  } else if (status === 'converting') {
    const parts = [message || 'Converting…']
    if (pagesPerSec) parts.push(`${pagesPerSec} p/s`)
    if (etaSec) parts.push(formatEta(etaSec))
    text = parts.join(' • ')
  } else if (status === 'done') {
    const slideWord = stats?.pages === 1 ? 'slide' : 'slides'
    text = stats?.pages
      ? `Conversion complete (${stats.pages} ${slideWord}, .pptx ready)`
      : 'Conversion complete (.pptx ready)'
  } else if (status === 'cancelled') {
    text = 'Conversion cancelled'
  } else if (status === 'error') {
    text = error || 'Conversion failed.'
  }

  return (
    <li
      style={{
        ...card,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        listStyle: 'none',
      }}
    >
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        {status === 'done' ? (
          <CheckCircle size={20} color="var(--green)" style={{ flexShrink: 0 }} />
        ) : status === 'error' ? (
          <AlertCircle size={20} color="var(--red)" style={{ flexShrink: 0 }} />
        ) : (
          <FileText size={20} color="var(--text3)" style={{ flexShrink: 0 }} />
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: '14px',
              fontWeight: 600,
              color: 'var(--text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item.file.name}
          </div>
          <div style={{ fontSize: '12px', color, marginTop: '2px' }}>{text}</div>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {status === 'done' && (
            <button
              type="button"
              style={{ ...ghostBtn, color: 'var(--accent)', borderColor: 'var(--accent)' }}
              onClick={() => onDownload(item.id)}
            >
              <Download size={14} /> Download PowerPoint (.pptx)
            </button>
          )}

          {status === 'converting' && (
            <button type="button" style={ghostBtn} onClick={() => onCancel(item.id)}>
              Cancel
            </button>
          )}

          {(status === 'error' || status === 'cancelled') && (
            <button type="button" style={ghostBtn} onClick={() => onRetry(item.id)}>
              <RotateCw size={14} /> Retry
            </button>
          )}

          {status !== 'converting' && (
            <button
              type="button"
              aria-label={`Remove ${item.file.name}`}
              style={{ ...ghostBtn, padding: '7px' }}
              onClick={() => onRemove(item.id)}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {status === 'converting' && (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent || 0)}
          style={{
            height: '4px',
            borderRadius: '2px',
            background: 'var(--border)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${Math.max(2, percent || 0)}%`,
              background: 'var(--accent)',
              transition: 'width .2s linear',
            }}
          />
        </div>
      )}

      {warningCount > 0 && status === 'done' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '11.5px',
            color: 'var(--text3)',
            marginTop: '2px',
          }}
        >
          <AlertTriangle size={13} color="var(--amber)" />
          <span>
            {warningCount} {warningCount === 1 ? 'note' : 'notes'} applied fallback formatting to keep slides intact.
          </span>
        </div>
      )}
    </li>
  )
}

export default function PdfToPptxTool({
  onBack,
  dark,
  onToggleTheme,
  onGoHome,
  showCategories,
  activeCategory,
  onCategoryChange,
  search,
  onSearch,
  initialFiles,
}) {
  const {
    items,
    running,
    mode,
    setMode,
    slideLayout,
    setSlideLayout,
    addFiles,
    start,
    cancel,
    cancelAll,
    remove,
    retry,
    clear,
    getBlob,
    download,
  } = usePdfToPptx()

  const [rejected, setRejected] = useState('')

  useEffect(() => {
    if (initialFiles && initialFiles.length > 0) {
      addFiles(Array.from(initialFiles))
    }
  }, [initialFiles, addFiles])

  const onDrop = useCallback(
    (accepted, rejections) => {
      if (rejections.length) {
        setRejected(rejections.map((r) => `${r.file.name}: only PDF files work.`).join(' '))
      } else {
        setRejected('')
      }
      addFiles(accepted)
    },
    [addFiles]
  )

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: true,
    noClick: true,
    noKeyboard: true,
  })

  const readyCount = items.filter((i) => i.status === 'ready').length
  const doneItems = items.filter((i) => i.status === 'done')

  const downloadAllZip = async () => {
    const entries = []
    for (const item of doneItems) {
      const blob = getBlob(item.id)
      if (blob) entries.push({ name: outputName(item.file), blob })
    }
    if (entries.length > 0) {
      const zip = await zipPptx(entries)
      downloadBlob(zip, 'pdf_to_pptx.zip')
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      <TopBar
        onBack={onBack}
        title="PDF to PowerPoint"
        subtitle="Convert PDF documents into editable PowerPoint (.pptx) presentations."
        dark={dark}
        onToggleTheme={onToggleTheme}
        onGoHome={onGoHome}
        showCategories={showCategories}
        activeCategory={activeCategory}
        onCategoryChange={onCategoryChange}
        search={search}
        onSearch={onSearch}
      />

      <main
        style={{
          flex: 1,
          width: '100%',
          maxWidth: '740px',
          margin: '0 auto',
          padding: '32px 20px 64px',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '13px',
            color: 'var(--text3)',
            lineHeight: 1.5,
          }}
        >
          <Zap size={15} color="var(--accent)" />
          <span>
            100% on-device conversion. Extracts headings, lists, tables, vector boxes, and images
            into native PowerPoint slides with zero server uploads.
          </span>
        </div>

        <section style={{ ...card, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <OptionPill
              active={mode === 'editable'}
              disabled={running}
              onClick={() => setMode('editable')}
              icon={<Presentation size={16} />}
              title="Editable slides"
              desc="Native text boxes, tables, lists & embedded images (auto-falls back for scans)."
            />
            <OptionPill
              active={mode === 'images'}
              disabled={running}
              onClick={() => setMode('images')}
              icon={<Layers size={16} />}
              title="Slide images"
              desc="High-res page snapshots for pixel-exact non-editable decks."
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text2)' }}>Slide size:</span>
            {[
              { id: 'auto', label: 'Match PDF' },
              { id: '16:9', label: 'Widescreen (16:9)' },
              { id: '4:3', label: 'Standard (4:3)' },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={running}
                onClick={() => setSlideLayout(opt.id)}
                style={{
                  padding: '5px 11px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: running ? 'not-allowed' : 'pointer',
                  border: `1px solid ${slideLayout === opt.id ? 'var(--accent)' : 'var(--border)'}`,
                  background: slideLayout === opt.id ? 'rgba(234,88,12,0.12)' : 'var(--bg3)',
                  color: slideLayout === opt.id ? 'var(--accent)' : 'var(--text2)',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </section>

        <div
          {...getRootProps()}
          style={{
            ...card,
            border: `2px dashed ${isDragActive ? 'var(--accent)' : 'var(--border)'}`,
            padding: '40px 20px',
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'border-color 0.15s ease',
          }}
          onClick={open}
        >
          <input {...getInputProps()} />
          <Upload size={30} color="var(--text3)" style={{ margin: '0 auto 12px' }} />
          <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)', marginBottom: '4px' }}>
            {isDragActive ? 'Drop your PDF files here' : 'Drop PDF files here, or click to browse'}
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text3)', marginBottom: '16px' }}>
            Supports multi-page PDFs, tables, columns, and scanned pages. Add one or many files.
          </div>
          <button
            type="button"
            style={primaryBtn(false)}
            onClick={(e) => {
              e.stopPropagation()
              open()
            }}
          >
            Choose PDF files
          </button>
        </div>

        {rejected && (
          <div role="alert" style={notice('var(--red)')}>
            <AlertCircle size={18} color="var(--red)" style={{ flexShrink: 0 }} />
            <span>{rejected}</span>
          </div>
        )}

        {items.length > 0 && (
          <>
            <ul
              aria-live="polite"
              style={{
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              {items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  onDownload={download}
                  onCancel={cancel}
                  onRetry={retry}
                  onRemove={remove}
                />
              ))}
            </ul>

            <div
              style={{
                display: 'flex',
                gap: '10px',
                flexWrap: 'wrap',
                alignItems: 'center',
                paddingTop: '8px',
              }}
            >
              <button
                type="button"
                style={primaryBtn(running || readyCount === 0)}
                disabled={running || readyCount === 0}
                onClick={start}
              >
                {running ? (
                  <>Converting…</>
                ) : (
                  <>Convert {readyCount} {readyCount === 1 ? 'file' : 'files'} to PowerPoint</>
                )}
              </button>

              {running && (
                <button
                  type="button"
                  style={{ ...ghostBtn, padding: '12px 18px', fontSize: '14px' }}
                  onClick={cancelAll}
                >
                  Cancel conversion
                </button>
              )}

              {doneItems.length > 1 && (
                <button
                  type="button"
                  style={{ ...ghostBtn, padding: '12px 18px', fontSize: '14px' }}
                  onClick={downloadAllZip}
                >
                  <Download size={16} /> Download all as ZIP ({doneItems.length})
                </button>
              )}

              <button
                type="button"
                style={{ ...ghostBtn, padding: '12px 18px', fontSize: '14px', marginLeft: 'auto' }}
                onClick={clear}
                disabled={running}
              >
                Clear list
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
