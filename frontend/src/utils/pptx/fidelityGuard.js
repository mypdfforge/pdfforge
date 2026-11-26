/**
 * fidelityGuard.js — Fast luminance SSIM and pixel-diff evaluation for
 * verifying rendered slides against PDF ground-truth canvases.
 */

import { CFG } from './config.js';

const C1 = (0.01 * 255) ** 2; // 6.5025
const C2 = (0.03 * 255) ** 2; // 58.5225

function luminanceAt(buf, idx) {
  return 0.299 * buf[idx] + 0.587 * buf[idx + 1] + 0.114 * buf[idx + 2];
}

function blockSsim(bufA, bufB, width, x0, y0, bw, bh) {
  const n = bw * bh;
  let sumA = 0;
  let sumB = 0;

  for (let dy = 0; dy < bh; dy++) {
    let row = ((y0 + dy) * width + x0) * 4;
    for (let dx = 0; dx < bw; dx++) {
      sumA += luminanceAt(bufA, row);
      sumB += luminanceAt(bufB, row);
      row += 4;
    }
  }

  const muA = sumA / n;
  const muB = sumB / n;
  let varA = 0;
  let varB = 0;
  let cov = 0;

  for (let dy = 0; dy < bh; dy++) {
    let row = ((y0 + dy) * width + x0) * 4;
    for (let dx = 0; dx < bw; dx++) {
      const da = luminanceAt(bufA, row) - muA;
      const db = luminanceAt(bufB, row) - muB;
      varA += da * da;
      varB += db * db;
      cov += da * db;
      row += 4;
    }
  }

  const denom = n > 1 ? n - 1 : 1;
  varA /= denom;
  varB /= denom;
  cov /= denom;

  const num = (2 * muA * muB + C1) * (2 * cov + C2);
  const den = (muA * muA + muB * muB + C1) * (varA + varB + C2);
  return den === 0 ? 1 : num / den;
}

/**
 * Computes fast block-averaged luminance SSIM between two RGBA buffers.
 *
 * @param {Uint8ClampedArray|Uint8Array} bufA
 * @param {Uint8ClampedArray|Uint8Array} bufB
 * @param {number} width
 * @param {number} height
 * @returns {number} SSIM in [0, 1]
 */
export function computeSsim(bufA, bufB, width, height) {
  if (!bufA || !bufB || width <= 0 || height <= 0) return 1;
  const expectedLen = width * height * 4;
  if (bufA.length < expectedLen || bufB.length < expectedLen) {
    throw new Error('RGBA buffer length smaller than width * height * 4');
  }

  const win = 8;
  if (width < win || height < win) {
    return Math.max(0, Math.min(1, blockSsim(bufA, bufB, width, 0, 0, width, height)));
  }

  let total = 0;
  let count = 0;
  for (let y = 0; y + win <= height; y += win) {
    for (let x = 0; x + win <= width; x += win) {
      total += blockSsim(bufA, bufB, width, x, y, win, win);
      count++;
    }
  }

  const mean = count > 0 ? total / count : 1;
  return Math.max(0, Math.min(1, mean));
}

/**
 * Evaluates visual fidelity between a PDF ground-truth RGBA buffer and
 * a predicted PPTX render RGBA buffer, returning a degradation decision.
 *
 * @param {Uint8ClampedArray|Uint8Array} groundTruthRgba
 * @param {Uint8ClampedArray|Uint8Array} predictedRgba
 * @param {number} width
 * @param {number} height
 * @param {object} [thresholds]
 * @param {number} [thresholds.ssimTarget]
 * @param {number} [thresholds.diffFailRatio]
 * @returns {{ ssim: number, diffRatio: number, passed: boolean, action: 'ok'|'repair'|'fallback-t3' }}
 */
export function evaluateFidelity(
  groundTruthRgba,
  predictedRgba,
  width,
  height,
  {
    ssimTarget = CFG.fidelity.ssimTarget,
    diffFailRatio = CFG.fidelity.diffFailRatio,
  } = {}
) {
  const ssim = computeSsim(groundTruthRgba, predictedRgba, width, height);
  const pixelCount = Math.max(1, width * height);
  let diffPixels = 0;

  for (let i = 0; i < pixelCount * 4; i += 4) {
    const dr = Math.abs(groundTruthRgba[i] - predictedRgba[i]);
    const dg = Math.abs(groundTruthRgba[i + 1] - predictedRgba[i + 1]);
    const db = Math.abs(groundTruthRgba[i + 2] - predictedRgba[i + 2]);
    if (dr > 24 || dg > 24 || db > 24) {
      diffPixels++;
    }
  }

  const diffRatio = diffPixels / pixelCount;
  const passed = ssim >= ssimTarget && diffRatio <= diffFailRatio;

  let action = 'ok';
  if (!passed) {
    action =
      ssim >= ssimTarget - 0.06 && diffRatio <= diffFailRatio * 3
        ? 'repair'
        : 'fallback-t3';
  }

  return { ssim, diffRatio, passed, action };
}
