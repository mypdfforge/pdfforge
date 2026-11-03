/**
 * capabilities.js - can this browser run the converter?
 * Pure functions. No side effects. Safe to call many times.
 */

export function isIOS() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function isMobile() {
  if (typeof navigator === 'undefined') return false
  return isIOS() || /Mobi|Android/i.test(navigator.userAgent || '')
}

/**
 * @returns {{ ok: boolean, blockers: string[], warnings: string[] }}
 * blockers = cannot run at all. warnings = can run, may be slow or crash.
 */
export function checkCapabilities() {
  const blockers = []
  const warnings = []

  if (typeof WebAssembly === 'undefined' || typeof Worker === 'undefined') {
    blockers.push('This browser cannot run the converter. Use a current Chrome, Edge, Firefox or Safari on a computer.')
  } else if (typeof SharedArrayBuffer === 'undefined' || self.crossOriginIsolated !== true) {
    blockers.push('Secure browser mode is off, so the converter cannot start. Reload the page. If it keeps happening, the site is missing its COOP and COEP headers.')
  }

  if (isIOS()) {
    blockers.push('iPhone and iPad do not give web pages enough memory for this converter. Open this page on a computer.')
  } else if (isMobile()) {
    warnings.push('Phones can run out of memory on large documents. A computer works best.')
  }

  const mem = typeof navigator !== 'undefined' ? navigator.deviceMemory : undefined
  if (typeof mem === 'number' && mem < 4) {
    warnings.push('This device has less than 4 GB of memory. Large documents may fail.')
  }
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined
  if (typeof cores === 'number' && cores < 2) {
    warnings.push('This device has one CPU core. Conversion will be slow.')
  }

  return { ok: blockers.length === 0, blockers, warnings }
}

/** Background engine download is OK only on good network and device. */
export function canWarmEngine() {
  if (typeof navigator === 'undefined') return false
  if (!checkCapabilities().ok) return false
  if (isMobile()) return false
  const c = navigator.connection
  if (c?.saveData) return false
  if (c?.type === 'cellular') return false
  if (['slow-2g', '2g', '3g'].includes(c?.effectiveType)) return false
  if (typeof navigator.deviceMemory === 'number' && navigator.deviceMemory < 4) return false
  return true
}
