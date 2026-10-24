// Run: node pdfToExcel.test.mjs [path/to/sample.pdf]   (needs: npm i -D pdfjs-dist@3.11.174 exceljs)
import { createRequire } from 'module'
import fs from 'fs'
import assert from 'assert'
import ExcelJS from 'exceljs'
const require = createRequire(import.meta.url)
const { setPdfjs, pdfToExcel } = await import('./src/utils/convertClient.js')
setPdfjs(require('pdfjs-dist/legacy/build/pdf.js'))

const pdf = fs.readFileSync(process.argv[2] || new URL('./fixtures/bill-sample.pdf', import.meta.url))
const { data } = await pdfToExcel(pdf, null, {})
const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await data.arrayBuffer())
const ws = wb.worksheets[0]
const cells = []; ws.eachRow((r) => r.eachCell((c) => { if (c.type !== ExcelJS.ValueType.Merge) cells.push(c) }))
const find = (t) => cells.find((c) => String(c.value).trim() === t)

// 1. hidden text under redaction boxes must not leak
assert(!find('10.1') && !find('GRO'), 'redacted text leaked')
// 2. group headers merge across their 3 sub-columns
const span = (c) => ws._merges?.[c.address]?.model
for (const h of ['Quantity', 'Amount']) {
  const m = span(find(h)); assert(m && m.right - m.left === 2, `${h} must merge over 3 columns`)
}
// 3. money is numeric, 2 decimals, incl. integer-looking 3060
for (const [v, label] of [[34000, '34,000.00'], [3060, '3060'], [40120, '40,120.00']]) {
  const c = cells.find((x) => x.value === v); assert(c, `${label} must be a Number`); assert.equal(c.numFmt, '#,##0.00')
}
// 4. total rows keep fills
const fills = (t) => ws.getCell(find(t).address).fill?.fgColor?.argb
assert(fills('TOTAL Amount') && fills('TOTAL WITH TAXES'), 'row fills lost')
// 5. title block is above the table, outside the table's header cell
assert(String(find('Brigade Enterprises Limited.').value) && find('Brigade Enterprises Limited.').row < find('Description').row)
// 6. borders survive on merged cells
assert(ws.getCell(find('Quantity').address).border?.top, 'merged cell lost border')
console.log('PASS: pdfToExcel')
