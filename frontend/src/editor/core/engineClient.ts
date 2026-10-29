// Main-thread facade over PdfEngine: Web Worker when available, same code in-thread otherwise.
import { PdfEngine, EngineError } from './engine.ts'
import type { PageAnalysis, EngineCode } from './engine.ts'
import type { Plan, BuildReport } from './types.ts'

export type BuildOpts = { only?: number[]; onProgress?: (done: number, total: number) => void }
export type EngineLike = {
  mode: 'worker' | 'main'
  open(bytes: Uint8Array): Promise<{ pageCount: number }>
  analyzePage(i: number): Promise<PageAnalysis>
  build(plan: Plan, opts?: BuildOpts): { promise: Promise<{ bytes: Uint8Array; report: BuildReport }>; cancel: () => void }
  close(): void
}

class MainEngine implements EngineLike {
  mode = 'main' as const
  e: PdfEngine
  constructor(L: any) { this.e = new PdfEngine(L) }
  open(b: Uint8Array) { return this.e.open(b) }
  async analyzePage(i: number) { return this.e.analyzePage(i) }
  build(plan: Plan, opts: BuildOpts = {}) {
    let stop = false
    return { promise: this.e.build(plan, { ...opts, isCancelled: () => stop }), cancel: () => { stop = true } }
  }
  close() { this.e.close() }
}

class WorkerEngine implements EngineLike {
  mode = 'worker' as const
  private w: Worker
  private seq = 0
  private pending = new Map<number, { res: (v: any) => void; rej: (e: any) => void; progress?: BuildOpts['onProgress'] }>()
  constructor(w: Worker) {
    this.w = w
    w.onmessage = (ev: MessageEvent) => {
      const m: any = ev.data, p = this.pending.get(m.id)
      if (!p) return
      if (m.progress) { p.progress?.(m.progress.done, m.progress.total); return }
      this.pending.delete(m.id)
      m.ok ? p.res(m.result) : p.rej(new EngineError((m.code as EngineCode) ?? 'corrupt', m.message))
    }
    w.onerror = (ev) => { const err = new Error(ev.message || 'Worker crashed'); this.pending.forEach((p) => p.rej(err)); this.pending.clear() }
  }
  send<T>(msg: any, transfer: Transferable[] = [], progress?: BuildOpts['onProgress']): { id: number; promise: Promise<T> } {
    const id = ++this.seq
    const promise = new Promise<T>((res, rej) => { this.pending.set(id, { res, rej, progress }); this.w.postMessage({ ...msg, id }, transfer) })
    return { id, promise }
  }
  init(libUrl: string) { return this.send<void>({ type: 'init', libUrl }).promise }
  open(bytes: Uint8Array) { const copy = bytes.slice(); return this.send<{ pageCount: number }>({ type: 'open', bytes: copy.buffer }, [copy.buffer]).promise }
  analyzePage(page: number) { return this.send<PageAnalysis>({ type: 'analyze', page }).promise }
  build(plan: Plan, opts: BuildOpts = {}) {
    const { id, promise } = this.send<{ bytes: Uint8Array; report: BuildReport }>({ type: 'build', plan, only: opts.only }, [], opts.onProgress)
    return { promise, cancel: () => this.w.postMessage({ type: 'cancel', target: id }) }
  }
  close() { this.pending.forEach((p) => p.rej(new EngineError('cancelled', 'Closed'))); this.pending.clear(); this.w.terminate() }
}

/** Prefers a worker; any failure to start one falls back to running the same engine on the main thread. */
export async function createEngine(L: any, libUrl: string, makeWorker?: () => Worker): Promise<EngineLike> {
  if (makeWorker && typeof Worker !== 'undefined') {
    try {
      const we = new WorkerEngine(makeWorker())
      await Promise.race([we.init(libUrl), new Promise((_, rej) => setTimeout(() => rej(new Error('worker init timeout')), 8000))])
      return we
    } catch { /* fall through */ }
  }
  return new MainEngine(L)
}
