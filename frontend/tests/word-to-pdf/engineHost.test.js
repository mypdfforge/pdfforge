import { describe, it, expect, vi, beforeEach } from 'vitest'

// Shared fake engine state. Reset in beforeEach.
const fake = vi.hoisted(() => ({
  inits: 0, destroys: 0, active: 0, maxActive: 0,
  convertImpl: null, events: [],
}))

vi.mock('@matbee/libreoffice-converter/browser', () => ({
  createWasmPaths: () => ({}),
  loadFontsFromUrl: async () => [],
  WorkerBrowserConverter: class {
    async initialize() { fake.inits++; fake.events.push('init') }
    async destroy() { fake.destroys++; fake.events.push('destroy') }
    async convert(...args) {
      fake.active++
      fake.maxActive = Math.max(fake.maxActive, fake.active)
      fake.events.push('convert-start')
      try { return await fake.convertImpl(...args) } finally { fake.active--; fake.events.push('convert-end') }
    }
  },
}))

const file = (name = 'a.docx') => new File([new Uint8Array([1, 2, 3])], name)
const okPdf = async () => ({ data: new Uint8Array([37, 80, 68, 70]) })

let host

beforeEach(async () => {
  Object.assign(fake, { inits: 0, destroys: 0, active: 0, maxActive: 0, convertImpl: okPdf, events: [] })
  vi.resetModules()
  globalThis.self = globalThis
  globalThis.crossOriginIsolated = true
  globalThis.SharedArrayBuffer = globalThis.SharedArrayBuffer || ArrayBuffer
  globalThis.Worker = globalThis.Worker || class Worker {}
  globalThis.window = { location: { origin: 'http://localhost' }, addEventListener() {} }
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ version: 'test1' }) }))
  host = await import('../../src/features/word-to-pdf/engine/engineHost.js')
  await host.releaseEngine()
  Object.assign(fake, { inits: 0, destroys: 0, events: [] })
})

describe('engineHost', () => {
  it('converts and returns a PDF blob', async () => {
    const blob = await host.convertToPdf(file())
    expect(blob.type).toBe('application/pdf')
    expect(blob.size).toBe(4)
  })

  it('never runs two conversions at once', async () => {
    fake.convertImpl = async () => { await new Promise((r) => setTimeout(r, 20)); return okPdf() }
    await Promise.all([host.convertToPdf(file()), host.convertToPdf(file()), host.convertToPdf(file())])
    expect(fake.maxActive).toBe(1)
    expect(fake.inits).toBe(1) // one engine reused
  })

  it('rebuilds for CJK only AFTER the running job ends', async () => {
    fake.convertImpl = async () => { await new Promise((r) => setTimeout(r, 30)); return okPdf() }
    const a = host.convertToPdf(file('a.docx'), { needsCjk: false })
    const b = host.convertToPdf(file('b.docx'), { needsCjk: true })
    await Promise.all([a, b])
    const firstEnd = fake.events.indexOf('convert-end')
    const destroy = fake.events.indexOf('destroy')
    expect(destroy).toBeGreaterThan(firstEnd)
    expect(fake.inits).toBe(2)
  })

  it('cancel stops the job and destroys the engine', async () => {
    fake.convertImpl = () => new Promise(() => {}) // hangs forever
    const ctl = new AbortController()
    const p = host.convertToPdf(file(), { signal: ctl.signal })
    await new Promise((r) => setTimeout(r, 10))
    ctl.abort()
    await expect(p).rejects.toMatchObject({ code: 'ABORTED' })
    expect(fake.destroys).toBeGreaterThanOrEqual(1)
    // next job still works on a fresh engine
    fake.convertImpl = okPdf
    await expect(host.convertToPdf(file())).resolves.toBeInstanceOf(Blob)
  })

  it('retries once on a crash with a fresh engine', async () => {
    let calls = 0
    fake.convertImpl = async () => {
      calls++
      if (calls === 1) throw new Error('RuntimeError: memory access out of bounds')
      return okPdf()
    }
    await expect(host.convertToPdf(file())).resolves.toBeInstanceOf(Blob)
    expect(fake.inits).toBe(2)
  })

  it('gives a clear error when the engine returns nothing', async () => {
    fake.convertImpl = async () => ({ data: new Uint8Array(0) })
    await expect(host.convertToPdf(file())).rejects.toMatchObject({ code: 'EMPTY' })
  })

  it('shows engine-missing error when manifest is gone', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false }))
    await expect(host.convertToPdf(file())).rejects.toMatchObject({ code: 'ENGINE_MISSING' })
  })
})
