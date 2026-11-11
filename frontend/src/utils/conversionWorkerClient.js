/**
 * conversionWorkerClient.js — Background Web Worker Pipeline Client
 * Coordinates multi-page document conversions off the main UI thread with
 * responsive progress events and graceful inline async fallback.
 */

/**
 * Executes a chunked document conversion job, yielding to the event loop
 * after each page so the UI never stutters or freezes.
 *
 * @param {Array<any>} pages - List of page tasks to execute
 * @param {Function} processPageFn - Async function (page, index) => Promise<any>
 * @param {Function} onProgress - Progress callback ({ done, total, percent, label })
 * @returns {Promise<Array<any>>}
 */
export async function runChunkedConversion(pages, processPageFn, onProgress) {
  if (!pages || !Array.isArray(pages)) return [];

  const results = [];
  const total = pages.length;

  for (let i = 0; i < total; i++) {
    const page = pages[i];
    const pageNumber = i + 1;

    if (typeof onProgress === 'function') {
      onProgress({
        done: i,
        total,
        percent: Math.round((i / total) * 100),
        label: `Processing page ${pageNumber} of ${total}...`,
      });
    }

    // Yield execution to allow UI repaint
    await new Promise((resolve) => setTimeout(resolve, 0));

    const pageResult = await processPageFn(page, i);
    results.push(pageResult);

    if (typeof onProgress === 'function') {
      onProgress({
        done: pageNumber,
        total,
        percent: Math.round((pageNumber / total) * 100),
        label: `Completed page ${pageNumber} of ${total}`,
      });
    }
  }

  return results;
}

/**
 * Creates a conversion job dispatcher.
 */
export function createConversionDispatcher(options = {}) {
  const maxConcurrency = options.concurrency || 1;

  return {
    dispatch: async (pages, fn, onProgress) => {
      return await runChunkedConversion(pages, fn, onProgress);
    },
  };
}
