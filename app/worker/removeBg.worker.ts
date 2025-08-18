/// <reference lib="webworker" />

import type {
    BackgroundRemovalPipeline,
    RawImage,
  } from '@huggingface/transformers';
  
  let pipe: BackgroundRemovalPipeline | null = null;
  
  // Message payload we expect from the main thread
  type MsgIn = {
    blob: Blob;            // already downscaled (or original) image blob
    useWebGPU: boolean;    // try WebGPU if available
    dtype?: 'fp16' | 'fp32';
  };
  
  type MsgOut = { buffer: ArrayBuffer; type: string };
  
  self.onmessage = async (e: MessageEvent<MsgIn>) => {
    const { blob, useWebGPU, dtype } = e.data;
  
    // Lazy-load to avoid slowing initial page render
    // const { pipeline:hfPipeline } = await import('@huggingface/transformers');
  
    if (!pipe) {
        const { pipeline: hfPipeline } = await import('@huggingface/transformers');

        const device = useWebGPU && 'gpu' in navigator ? 'webgpu' : undefined;
      
        // Reduce inference: pre-build a simple options object and cast it.
        const opts: any = { device, dtype };
      
        // Cast pipeline to a simple signature, then assert return type.
        const makePipe = hfPipeline as unknown as (
          task: 'background-removal',
          model: string,
          options?: any
        ) => Promise<unknown>;
      
        pipe = (await makePipe('background-removal', 'briaai/RMBG-1.4', opts)) as BackgroundRemovalPipeline;
      }
      const device = useWebGPU && 'gpu' in navigator ? 'webgpu' : undefined;
      // dtype is optional; fp16 helps on many GPUs, harmless elsewhere
    
  
    // Run inference
    const result = await pipe(blob);
    const out = Array.isArray(result) ? result[0] : result; // now definitely RawImage
    const rgba = new Uint8ClampedArray(out.width * out.height * 4);
    rgba.set(out.data as Uint8Array); // copy bytes
  
    // Paint to OffscreenCanvas and export PNG
    const canvas = new OffscreenCanvas(out.width, out.height);
    const ctx = canvas.getContext('2d')!;
    const imageData = new ImageData(rgba, out.width, out.height);
    ctx.putImageData(imageData, 0, 0);
  
    const png = await canvas.convertToBlob({ type: 'image/png' });
    const buffer = await png.arrayBuffer();
  
    // Transfer the buffer (zero-copy)
    (self as any).postMessage({ buffer, type: png.type } as MsgOut, [buffer]);
  };
  