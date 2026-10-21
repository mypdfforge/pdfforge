import {
  Layers, Scissors, FileOutput, RotateCw, Trash2, Copy, Crop, ImagePlus, FileText, Presentation,
  FileSpreadsheet, Globe, FileImage, Archive, Minimize2, Wrench, Droplets, Hash, Stamp, Replace,
  LayoutGrid, PenLine, ScanText, Languages, Lock, Unlock, EyeOff, Pencil,
} from 'lucide-react'

export const CATEGORIES = [
  { id: 'all',      label: 'All tools' },
  { id: 'organize', label: 'Organize'  },
  { id: 'convert',  label: 'Convert'   },
  { id: 'optimize', label: 'Optimize'  },
  { id: 'enhance',  label: 'Edit'      },
  { id: 'security', label: 'Security'  },
]

// runs: 'browser' = file never leaves the device (verified: no network calls in its code path)
//       'server'  = file is uploaded to the PDFForge backend (OCR also sends page images to OCR.space)
export const TOOLS = [
  { id:'editor',       icon:Pencil,        label:'Resume Editor',    desc:'Edit text directly on the page, keeping the original layout.', category:'enhance',  runs:'server', featured:true },
  { id:'merge',        icon:Layers,        label:'Merge PDF',        desc:'Combine several PDFs into one.',                  category:'organize', runs:'browser' },
  { id:'split',        icon:Scissors,      label:'Split PDF',        desc:'Split by page range, selecting pages visually.',  category:'organize', runs:'browser' },
  { id:'extract',      icon:FileOutput,    label:'Extract pages',    desc:'Pull specific pages into a new PDF.',             category:'organize', runs:'browser' },
  { id:'rotate',       icon:RotateCw,      label:'Rotate pages',     desc:'Rotate one or all pages.',                        category:'organize', runs:'browser' },
  { id:'delete',       icon:Trash2,        label:'Delete pages',     desc:'Remove unwanted pages.',                          category:'organize', runs:'browser' },
  { id:'duplicate',    icon:Copy,          label:'Duplicate page',   desc:'Insert a copy of any page after the original.',   category:'organize', runs:'browser' },
  { id:'organize',     icon:LayoutGrid,    label:'Organize pages',   desc:'Drag to reorder, rotate or delete pages.',        category:'organize', runs:'browser' },
  { id:'crop',         icon:Crop,          label:'Crop PDF',         desc:'Trim margins from pages.',                        category:'organize', runs:'browser' },
  { id:'image-to-pdf', icon:ImagePlus,     label:'Images to PDF',    desc:'Combine JPG and PNG images into one PDF.',        category:'convert',  runs:'browser', sub:'to' },
  { id:'word-to-pdf',  icon:FileText,      label:'Word to PDF',      desc:'Convert .docx documents to PDF.',                 category:'convert',  runs:'server',  sub:'to' },
  { id:'pptx-to-pdf',  icon:Presentation,  label:'PowerPoint to PDF',desc:'Convert .pptx presentations to PDF.',             category:'convert',  runs:'server',  sub:'to' },
  { id:'xlsx-to-pdf',  icon:FileSpreadsheet,label:'Excel to PDF',    desc:'Convert .xlsx spreadsheets to PDF.',              category:'convert',  runs:'server',  sub:'to' },
  { id:'html-to-pdf',  icon:Globe,         label:'HTML to PDF',      desc:'Convert an HTML file to PDF.',                    category:'convert',  runs:'server',  sub:'to' },
  { id:'images',       icon:FileImage,     label:'PDF to PNG',       desc:'Export every page as PNG, downloaded as a ZIP.',  category:'convert',  runs:'browser', sub:'from' },
  { id:'pdf-to-jpg',   icon:FileImage,     label:'PDF to JPG',       desc:'Export every page as JPG, downloaded as a ZIP.',  category:'convert',  runs:'browser', sub:'from' },
  { id:'pdf-to-word',  icon:FileText,      label:'PDF to Word',      desc:'Extract text into an editable .docx.',            category:'convert',  runs:'browser', sub:'from' },
  { id:'pdf-to-pptx',  icon:Presentation,  label:'PDF to PowerPoint',desc:'Turn pages into slides (as images).',             category:'convert',  runs:'browser', sub:'from' },
  { id:'pdf-to-xlsx',  icon:FileSpreadsheet,label:'PDF to Excel',    desc:'Extract page content into a spreadsheet.',        category:'convert',  runs:'browser', sub:'from' },
  { id:'pdf-to-pdfa',  icon:Archive,       label:'PDF to PDF/A',     desc:'Clean re-save of the PDF.',                       category:'convert',  runs:'server',  sub:'from' },
  { id:'compress',     icon:Minimize2,     label:'Compress PDF',     desc:'Reduce file size.',                               category:'optimize', runs:'browser' },
  { id:'repair',       icon:Wrench,        label:'Repair PDF',       desc:'Try to fix a damaged PDF.',                       category:'optimize', runs:'browser' },
  { id:'watermark',    icon:Droplets,      label:'Watermark',        desc:'Add a text or image watermark with live preview.',category:'enhance',  runs:'browser' },
  { id:'pagenums',     icon:Hash,          label:'Page numbers',     desc:'Add page numbers with live preview.',             category:'enhance',  runs:'browser' },
  { id:'stamp',        icon:Stamp,         label:'Stamp',            desc:'Add APPROVED, DRAFT or CONFIDENTIAL stamps.',     category:'enhance',  runs:'browser' },
  { id:'sign',         icon:PenLine,       label:'Sign PDF',         desc:'Draw, type or upload a signature and place it.',  category:'enhance',  runs:'browser' },
  { id:'findreplace',  icon:Replace,       label:'Find & replace',   desc:'Search and replace text across the PDF.',         category:'enhance',  runs:'server' },
  { id:'ocr',          icon:ScanText,      label:'OCR',              desc:'Make scanned PDFs searchable or extract text.',   category:'enhance',  runs:'server' },
  { id:'translate',    icon:Languages,     label:'Translate PDF',    desc:'Translate a PDF into another language.',          category:'enhance',  runs:'server' },
  { id:'protect',      icon:Lock,          label:'Protect PDF',      desc:'Add a password to a PDF.',                        category:'security', runs:'server' },
  { id:'unlock',       icon:Unlock,        label:'Unlock PDF',       desc:'Remove password protection.',                     category:'security', runs:'server' },
  { id:'redact',       icon:EyeOff,        label:'Redact text',      desc:'Permanently black out sensitive text.',           category:'security', runs:'browser' },
]

export const toolById = (id) => TOOLS.find(t => t.id === id)

export const RUNS_LABEL = {
  browser: 'Runs in your browser',
  server:  'Uploads to server',
}
