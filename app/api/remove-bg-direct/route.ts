import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Adjust if you want larger uploads
const MAX_BYTES = 16 * 1024 * 1024; // 16 MB

export async function POST(req: NextRequest) {
  try {
    // 1) Parse incoming form
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: `File too large (> ${MAX_BYTES} bytes)` }, { status: 413 });
    }

    // 2) Prepare request to the inference API
    const API_URL = process.env.RMBG_API_URL!;
    const API_TOKEN = process.env.RMBG_API_TOKEN!;
    console.log(API_TOKEN, API_URL)
    if (!API_URL || !API_TOKEN) {
      return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
    }

    // Read bytes once (avoid multiple reads)
    const bodyArrayBuffer = await file.arrayBuffer();
    const contentType = file.type || 'image/png';

console.log('contentType', contentType)

    type UpstreamResult = { buf: ArrayBuffer; ct: string };

    // 3) Retry logic for cold starts (503) & transient failures
    const controller = new AbortController();
    const TIMEOUT_MS = 40_000; // tune for your provider and Vercel limits
    const doFetch = (attempt: number): Promise<UpstreamResult> =>
      fetch(API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
          'Content-Type': contentType,
        },
        body: bodyArrayBuffer,
        signal: controller.signal,
      }).then(async (r) => {
        if (!r.ok) {
          const text = await r.text().catch(() => '');
          // Hugging Face (and others) often return 503 while spinning up the model
          if ((r.status === 503 || r.status >= 500) && attempt < 3) {
            const backoff = 500 * Math.pow(2, attempt); // 500, 1000, 2000ms
            await new Promise((res) => setTimeout(res, backoff));
            return doFetch(attempt + 1);
          }
          throw new Error(`Upstream error ${r.status}: ${text.slice(0, 500)}`);
        }
        // Expect an image (binary). Some providers return application/octet-stream.
        const ct = r.headers.get('content-type') || 'image/png';
        const buf = await r.arrayBuffer();
        return { buf, ct };
      });

    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let upstream;
    try {
      upstream = await doFetch(0);
    } finally {
      clearTimeout(timeout);
    }

    // 4) Return the image to the client
    return new NextResponse(upstream.buf, {
      headers: {
        'Content-Type': upstream.ct,
        'Cache-Control': 'no-store',
        // Use inline or attachment depending on your UX
        'Content-Disposition': 'inline; filename="removed.png"',
      },
    });
  } catch (err: any) {
    const msg =
      err?.name === 'AbortError'
        ? 'Upstream timed out'
        : err?.message || 'Unexpected server error';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
