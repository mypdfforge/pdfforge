// run: node mergeClient.check.mjs
import assert from 'node:assert/strict'
import { moveFilePages, movePage, byFileOrder, sectionsOf, rangeLabel } from './mergeClient.js'
const P = (fileId, origIdx) => ({ id: `${fileId}:${origIdx}`, fileId, origIdx })
const ids = a => a.map(p => p.id).join()
const pages = [P('a',0),P('a',1),P('b',0)]
assert.equal(ids(movePage(pages,'a:0','b:0',true)),  'a:1,b:0,a:0')
assert.equal(ids(movePage(pages,'b:0','a:0',false)), 'b:0,a:0,a:1')
assert.equal(movePage(pages,'a:0','a:0',true), pages)
const files = [{id:'b'},{id:'a'}]
assert.equal(ids(byFileOrder(pages,files)), 'b:0,a:0,a:1')
assert.equal(sectionsOf(movePage(pages,'b:0','a:0',true)).map(s=>s.fileId+s.pages.length).join(), 'a1,b1,a1')
assert.equal(rangeLabel([0,1,2,4]), '1–3, 5')
assert.equal(rangeLabel([3]), '4')
assert.equal(rangeLabel([0,0,1]), '1–2')
const m = [P('a',0),P('b',0),P('a',1),P('b',1)]
assert.equal(ids(moveFilePages(m,'a','b',true)),  'b:0,b:1,a:0,a:1')
assert.equal(ids(moveFilePages(m,'b','a',false)), 'b:0,b:1,a:0,a:1')
console.log('ok')
