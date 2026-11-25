import { zipSync } from 'fflate';

self.onmessage = (e) => {
  try {
    const buf = zipSync(e.data.files, { level: 0 }).buffer;
    self.postMessage({ ok: true, buf }, [buf]);
  } catch (err) {
    self.postMessage({ ok: false, message: err?.message || String(err) });
  }
};
