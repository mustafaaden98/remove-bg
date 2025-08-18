'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

function hasWebGPU() {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/** Downscale big images on the main thread so we send fewer pixels to the worker/server */
async function downscaleOnMain(file: File | Blob, maxSide = 1280): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  if (scale === 1) return file; // File extends Blob

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: true })!;
  ctx.drawImage(bmp, 0, 0, w, h);

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
  );
  canvas.width = canvas.height = 0;
  return blob;
}

export default function Page() {
  const [previewURL, setPreviewURL] = useState<string | null>(null);
  const [resultURL, setResultURL] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [useBrowser, setUseBrowser] = useState(true); // prefer local/WebGPU
  const [message, setMessage] = useState<{ type: 'info' | 'success' | 'error'; text: string } | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState<string>('');


  // Keep a single worker instance
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    return () => {
      if (previewURL) URL.revokeObjectURL(previewURL);
      if (resultURL) URL.revokeObjectURL(resultURL);
    };
  }, [previewURL, resultURL]);

  useEffect(() => {
    const input = prompt('Enter password:') as string;
    // console.log('input', input, process.env.NEXT_PUBLIC_ACCESS_PASSWORD)
    setPassword(input)
    if (input.toLowerCase() === process.env.NEXT_PUBLIC_ACCESS_PASSWORD) {
      setAuthenticated(true);
      setPassword(input);
    } else {
      setPassword('');
      alert('Wrong password!');
    }
  }, []);

  // const canUseBrowserPath = useMemo(
  //   () => useBrowser && hasWebGPU() && typeof OffscreenCanvas !== 'undefined',
  //   [useBrowser]
  // );
  const canUseBrowserPath = false

  // function resetState() {
  //   if (previewURL) URL.revokeObjectURL(previewURL);
  //   if (resultURL) URL.revokeObjectURL(resultURL);
  //   setPreviewURL(null);
  //   setResultURL(null);
  //   setMessage(null);
  //   setProgress(null);
  // }

  async function handleIncomingFile(file: File) {
    // Clean previous
    if (previewURL) URL.revokeObjectURL(previewURL);
    if (resultURL) URL.revokeObjectURL(resultURL);
    setResultURL(null);
    setMessage(null);

    const nextPrev = URL.createObjectURL(file);
    setPreviewURL(nextPrev);

    setLoading(true);
    setProgress(10);
    try {
      const smallBlob = await downscaleOnMain(file, 1280);
      setProgress(35);

      if (canUseBrowserPath) {
        // ── Browser path (WebGPU + worker) ──────────────────────────────
        if (!workerRef.current) {
          workerRef.current = new Worker(new URL('./worker/removeBg.worker.ts', import.meta.url), { type: 'module' });
          workerRef.current.onmessage = (e: MessageEvent<{ buffer: ArrayBuffer; type: string }>) => {
            const { buffer, type } = e.data;
            const outBlob = new Blob([buffer], { type });
            const url = URL.createObjectURL(outBlob);
            setResultURL((old) => {
              if (old) URL.revokeObjectURL(old);
              return url;
            });
            setLoading(false);
            setProgress(null);
            setMessage({ type: 'success', text: 'Processed locally (WebGPU)' });
          };
          workerRef.current.onerror = (err) => {
            console.error('Worker error', err);
            setMessage({ type: 'info', text: 'Local processing failed. Falling back to server…' });
            fallbackToServer(smallBlob);
          };
        }

        setProgress(55);
        workerRef.current.postMessage({ blob: smallBlob, useWebGPU: true, dtype: 'fp16' });
      } else {
        // ── Server fallback (your Next.js API route) ────────────────────
        await fallbackToServer(smallBlob);
      }
    } catch (e: any) {
      console.error(e);
      setMessage({ type: 'error', text: e?.message || 'Failed to process image' });
      setLoading(false);
      setProgress(null);
    }
  }

  async function fallbackToServer(blob: Blob) {
    try {
      setMessage({ type: 'info', text: 'Processing on server…' });
      setProgress(65);
      const fd = new FormData();
      fd.append('file', blob, 'input.png');
      fd.append('password', password);

      const res = await fetch('/api/remove-bg', { method: 'POST', body: fd });
      setProgress(85);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Server error ${res.status}: ${text.slice(0, 200)}`);
      }
      const outBlob = await res.blob();
      const url = URL.createObjectURL(outBlob);
      setResultURL((old) => {
        if (old) URL.revokeObjectURL(old);
        return url;
      });
      setMessage({ type: 'success', text: 'Processed via server (direct API)' });
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: err?.message || 'Server processing failed' });
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  // Drag & Drop
  // const [dragOver, setDragOver] = useState(false);
  const dragOver = false;

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-2xl bg-indigo-600"></div>
            <h1 className="text-lg font-semibold tracking-tight">BG Remover</h1>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            {hasWebGPU() ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-emerald-700 ring-1 ring-emerald-200">
                <Dot /> WebGPU detected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-amber-700 ring-1 ring-amber-200">
                <Dot /> WebGPU not available
              </span>
            )}
          </div>
        </div>
      </header>

      { !authenticated ? <div>Access deneid</div>:  

      <section className="mx-auto max-w-6xl px-4 py-8">
        {/* Controls card */}
        <div className="mb-6 grid gap-4 md:grid-cols-[1fr_auto]">
          <div className="rounded-2xl border bg-white p-4 md:p-5 shadow-sm">
            <h2 className="mb-2 text-base font-semibold">Upload an image</h2>
            <p className="mb-4 text-sm text-slate-600"> We’ll downscale to ~1280px for speed.</p>

            <label
              // onDragOver={(e) => {
              //   e.preventDefault();
              //   setDragOver(true);
              // }}
              // onDragLeave={() => setDragOver(false)}
              // onDrop={(e) => {
              //   e.preventDefault();
              //   setDragOver(false);
              //   const f = e.dataTransfer.files?.[0];
              //   if (f) handleIncomingFile(f);
              // }}
              className={[
                'group relative flex aspect-[3/1] w-full cursor-pointer items-center justify-center rounded-xl border-2 border-dashed transition',
                dragOver ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-300 hover:border-slate-400'
              ].join(' ')}
            >
              <input
                type="file"
                accept="image/*"
                onChange={(e) => e.target.files?.[0] && handleIncomingFile(e.target.files[0])}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
              <div className="pointer-events-none flex flex-col items-center text-slate-500">
                <UploadIcon className="mb-2 h-8 w-8" />
                <span className="text-sm">
                  <span className="font-medium text-slate-700">Click to upload</span> or drag and drop
                </span>
                <span className="text-xs">PNG, JPG, or WebP</span>
              </div>
            </label>
          </div>

          {/* <div className="rounded-2xl border bg-white p-4 md:p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-medium text-slate-700">Processing mode</h3>
            <label className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2 hover:bg-slate-50">
              <div className="flex flex-col">
                <span className="text-sm font-medium">Prefer local (WebGPU)</span>
                <span className="text-xs text-slate-500">Faster & private on supported devices. Falls back to server if unavailable.</span>
              </div>
              <Switch checked={useBrowser} onChange={setUseBrowser} />
            </label>

            <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              <div className="flex items-center gap-2">
                <InfoIcon className="h-4 w-4" />
                <span>
                  First run may take longer while the model downloads (local), or when the server cold-starts (API).
                </span>
              </div>
            </div>
          </div> */}
        </div>

        {/* Alerts */}
        {message && (
          <div
            className={[
              'mb-4 flex items-start gap-3 rounded-xl border px-3 py-2 text-sm',
              message.type === 'error'
                ? 'border-rose-200 bg-rose-50 text-rose-700'
                : message.type === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-sky-200 bg-sky-50 text-sky-700'
            ].join(' ')}
          >
            {message.type === 'error' ? <ErrorIcon className="mt-0.5 h-4 w-4" /> : <InfoIcon className="mt-0.5 h-4 w-4" />}
            <div>{message.text}</div>
          </div>
        )}

        {/* Progress */}
        {loading && (
          <div className="mb-4">
            <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
              <span>Processing…</span>
              <span>{progress ?? 0}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full w-1/3 bg-indigo-600 transition-all"
                style={{ width: `${Math.min(progress ?? 0, 95)}%` }}
              />
            </div>
          </div>
        )}

        {/* Preview grid */}
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border bg-white shadow-sm">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-sm font-semibold">Original</h3>
              {previewURL && (
                <a
                  href={previewURL}
                  download
                  className="text-xs text-slate-500 hover:text-slate-700 underline underline-offset-2"
                >
                  Download
                </a>
              )}
            </div>
            <div className="flex items-center justify-center p-4">
              {previewURL ? (
                <img src={previewURL} className="max-h-[60vh] w-auto rounded-lg border object-contain" />
              ) : (
                <div className="text-sm text-slate-400">No image yet</div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border bg-white shadow-sm">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-sm font-semibold">Result (PNG with transparency)</h3>
              {resultURL && (
                <a
                  href={resultURL}
                  download="removed.png"
                  className="text-xs text-slate-500 hover:text-slate-700 underline underline-offset-2"
                >
                  Download
                </a>
              )}
            </div>
            <div className="flex items-center justify-center p-4">
              {resultURL ? (
                <img src={resultURL} className="max-h-[60vh] w-auto rounded-lg border object-contain" />
              ) : loading ? (
                <div className="text-sm text-slate-400">Working…</div>
              ) : (
                <div className="text-sm text-slate-400">No result yet</div>
              )}
            </div>
          </div>
        </div>
      </section>
}

      {/* <footer className="mx-auto max-w-6xl px-4 pb-10 pt-6 text-center text-xs text-slate-500">
        Built with <span className="font-medium text-slate-700">Next.js</span> + <span className="font-medium text-slate-700">Tailwind</span>. Local (WebGPU) or Server (API) paths supported.
      </footer> */}
    </main>
  );
}

/* ---------------- UI bits (no external libs) ---------------- */

// function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
//   return (
//     <button
//       type="button"
//       onClick={() => onChange(!checked)}
//       className={[
//         'relative inline-flex h-6 w-11 items-center rounded-full transition',
//         checked ? 'bg-indigo-600' : 'bg-slate-300'
//       ].join(' ')}
//       aria-pressed={checked}
//     >
//       <span
//         className={[
//           'inline-block h-5 w-5 transform rounded-full bg-white shadow transition',
//           checked ? 'translate-x-5' : 'translate-x-1'
//         ].join(' ')}
//       />
//     </button>
//   );
// }

function UploadIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={props.className}>
      <path d="M12 16V4m0 0l-4 4m4-4l4 4M6 20h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function InfoIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={props.className}>
      <path d="M12 9h.01M11 12h1v6h1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  );
}
function ErrorIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={props.className}>
      <path d="M12 8v5m0 3h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function Dot(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 6 6" className={props.className}>
      <circle cx="3" cy="3" r="3" fill="currentColor" />
    </svg>
  );
}
