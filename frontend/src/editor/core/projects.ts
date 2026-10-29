// Local project library (IndexedDB). Everything stays in this browser; nothing here touches the network.
import type { DocState } from './types.ts'
import { LIMITS } from './limits.ts'

export type ProjectMeta = { id: string; name: string; size: number; pages: number; createdAt: number; updatedAt: number; edits: number }
export type Version = { id: string; label: string; at: number; doc: DocState }
export type Loaded = { meta: ProjectMeta; doc: DocState; bytes: Uint8Array; versions: Version[] }

const DB = 'pdfforge-editor', VERSION = 1
let dbp: Promise<IDBDatabase> | null = null
const db = () => (dbp ??= new Promise((res, rej) => {
  const r = indexedDB.open(DB, VERSION)
  r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('meta', { keyPath: 'id' }); d.createObjectStore('docs', { keyPath: 'id' }); d.createObjectStore('src', { keyPath: 'id' }) }
  r.onsuccess = () => res(r.result); r.onerror = () => { dbp = null; rej(r.error) }
}))
const run = async <T,>(stores: string[], mode: IDBTransactionMode, f: (tx: IDBTransaction) => IDBRequest | void): Promise<T> => {
  const d = await db()
  return new Promise<T>((res, rej) => {
    const tx = d.transaction(stores, mode)
    let out: any
    const rq = f(tx)
    if (rq) rq.onsuccess = () => { out = rq.result }
    tx.oncomplete = () => res(out); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error ?? new Error('Storage aborted'))
  })
}
export const isStorageError = (e: any) => e?.name === 'QuotaExceededError' || /quota/i.test(String(e?.message))
export const storageAvailable = () => typeof indexedDB !== 'undefined'
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2))

export const listProjects = async (): Promise<ProjectMeta[]> => (await run<ProjectMeta[]>(['meta'], 'readonly', (tx) => tx.objectStore('meta').getAll())).sort((a, b) => b.updatedAt - a.updatedAt)

export async function createProject(name: string, bytes: Uint8Array, doc: DocState): Promise<ProjectMeta> {
  const now = Date.now()
  const meta: ProjectMeta = { id: uid(), name, size: bytes.length, pages: doc.pages.length, createdAt: now, updatedAt: now, edits: 0 }
  await run(['meta', 'docs', 'src'], 'readwrite', (tx) => {
    tx.objectStore('meta').put(meta); tx.objectStore('docs').put({ id: meta.id, doc, versions: [] }); tx.objectStore('src').put({ id: meta.id, bytes: bytes.slice().buffer })
  })
  return meta
}
export async function saveDoc(id: string, doc: DocState, edits: number): Promise<void> {
  await run(['meta', 'docs'], 'readwrite', (tx) => {
    const m = tx.objectStore('meta'), d = tx.objectStore('docs')
    const gm = m.get(id), gd = d.get(id)
    let have = 0, meta: any, rec: any
    const done = () => { if (++have < 2) return; if (!meta || !rec) return; m.put({ ...meta, updatedAt: Date.now(), edits, pages: doc.pages.length, name: doc.name }); d.put({ ...rec, doc }) }
    gm.onsuccess = () => { meta = gm.result; done() }; gd.onsuccess = () => { rec = gd.result; done() }
  })
}
export async function addVersion(id: string, label: string, doc: DocState): Promise<Version[]> {
  const rec: any = await run(['docs'], 'readonly', (tx) => tx.objectStore('docs').get(id))
  const versions: Version[] = [{ id: uid(), label, at: Date.now(), doc }, ...(rec?.versions ?? [])].slice(0, LIMITS.versions)
  await run(['docs'], 'readwrite', (tx) => { tx.objectStore('docs').put({ ...rec, versions }) })
  return versions
}
export const listVersions = async (id: string): Promise<Version[]> => ((await run<any>(['docs'], 'readonly', (tx) => tx.objectStore('docs').get(id)))?.versions ?? [])
export async function loadProject(id: string): Promise<Loaded | null> {
  const [meta, rec, src] = await Promise.all([
    run<any>(['meta'], 'readonly', (tx) => tx.objectStore('meta').get(id)),
    run<any>(['docs'], 'readonly', (tx) => tx.objectStore('docs').get(id)),
    run<any>(['src'], 'readonly', (tx) => tx.objectStore('src').get(id)),
  ])
  if (!meta || !rec || !src) return null
  return { meta, doc: rec.doc, bytes: new Uint8Array(src.bytes), versions: rec.versions ?? [] }
}
export const renameProject = async (id: string, name: string) => { const m: any = await run(['meta'], 'readonly', (tx) => tx.objectStore('meta').get(id)); if (m) await run(['meta'], 'readwrite', (tx) => { tx.objectStore('meta').put({ ...m, name }) }) }
export const deleteProject = (id: string) => run(['meta', 'docs', 'src'], 'readwrite', (tx) => { for (const s of ['meta', 'docs', 'src']) tx.objectStore(s).delete(id) })
export async function duplicateProject(id: string): Promise<ProjectMeta | null> {
  const l = await loadProject(id); if (!l) return null
  const doc = { ...l.doc, name: l.meta.name.replace(/(\.pdf)?$/i, ' copy.pdf') }
  const m = await createProject(doc.name, l.bytes, doc); await saveDoc(m.id, doc, l.meta.edits); return m
}
export async function storageEstimate(): Promise<{ used: number; quota: number } | null> {
  try { const e = await navigator.storage.estimate(); return { used: e.usage ?? 0, quota: e.quota ?? 0 } } catch { return null }
}
