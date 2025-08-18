// app/api/remove-bg-clipdrop/route.ts
import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    const password = form.get('password');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    if (password !== process.env.APP_PASSWORD) {
        return NextResponse.json({ error: 'Unathorized' }, { status: 401 });
      }



    const API_KEY = (process.env.CLIPDROP_API_KEY || '').trim();
    if (!API_KEY) return NextResponse.json({ error: 'Server not configured' }, { status: 500 });

    // Build multipart form for Clipdrop (field name must be image_file)
    const fd = new FormData();
    // preserve original name if you want:
    fd.append('image_file', file, (file as File).name || 'input.jpg');

    const r = await fetch('https://clipdrop-api.co/remove-background/v1', {
      method: 'POST',
      headers: { 'x-api-key': API_KEY },
      body: fd,
    });

    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return NextResponse.json({ error: `Clipdrop ${r.status}: ${text.slice(0, 300)}` }, { status: 502 });
    }

    const buf = await r.arrayBuffer();
    const ct = r.headers.get('content-type') || 'image/png';
    return new NextResponse(buf, {
      headers: {
        'Content-Type': ct,
        'Cache-Control': 'no-store',
        'Content-Disposition': 'inline; filename="removed.png"',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 502 });
  }
}
