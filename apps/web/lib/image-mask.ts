import type { ImageMask } from './photo-image-contract';

/** Changes alpha only. Catalogue RGB pixels are never generated or repainted. */
export function applyImageMask(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  mask: ImageMask,
) {
  const original = new Uint8Array(pixels);
  if (mask.automatic) {
    // Transparent catalogue images already have an authored silhouette.
    let transparent = false;
    for (let p = 3; p < pixels.length; p += 4)
      if (pixels[p] < 250) {
        transparent = true;
        break;
      }
    if (!transparent) {
      const visited = new Uint8Array(width * height),
        queue = new Int32Array(width * height);
      const corners = [0, width - 1, (height - 1) * width, width * height - 1];
      const backgrounds = corners.map((p) => [original[p * 4], original[p * 4 + 1], original[p * 4 + 2]]);
      let head = 0,
        tail = 0;
      const add = (p: number) => {
        if (visited[p]) return;
        visited[p] = 1;
        if (backgrounds.some((c) => c.every((v, i) => Math.abs(v - original[p * 4 + i]) <= 18)))
          queue[tail++] = p;
      };
      for (let x = 0; x < width; x++) {
        add(x);
        add((height - 1) * width + x);
      }
      for (let y = 0; y < height; y++) {
        add(y * width);
        add(y * width + width - 1);
      }
      while (head < tail) {
        const p = queue[head++],
          x = p % width,
          y = Math.floor(p / width);
        pixels[p * 4 + 3] = 0;
        if (x) add(p - 1);
        if (x + 1 < width) add(p + 1);
        if (y) add(p - width);
        if (y + 1 < height) add(p + width);
      }
    }
  }
  if (mask.outline) {
    const polygon = mask.outline;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const px = (x + 0.5) / width,
          py = (y + 0.5) / height;
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
          const a = polygon[i],
            b = polygon[j];
          if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
        }
        if (!inside) pixels[(y * width + x) * 4 + 3] = 0;
      }
  }
  for (const stroke of mask.strokes) {
    const radius = Math.max(1, stroke.radius * Math.min(width, height));
    const stamp = (x: number, y: number) => {
      for (let py = Math.max(0, Math.floor(y - radius)); py <= Math.min(height - 1, y + radius); py++)
        for (let px = Math.max(0, Math.floor(x - radius)); px <= Math.min(width - 1, x + radius); px++)
          if ((px - x) ** 2 + (py - y) ** 2 <= radius ** 2) {
            const p = (py * width + px) * 4 + 3;
            pixels[p] = stroke.mode === 'erase' ? 0 : original[p];
          }
    };
    stroke.points.forEach((point, index) => {
      const a = stroke.points[Math.max(0, index - 1)],
        b = point;
      const count = Math.max(
        1,
        Math.ceil(Math.hypot((b.x - a.x) * width, (b.y - a.y) * height) / Math.max(1, radius / 2)),
      );
      for (let step = 0; step <= count; step++)
        stamp((a.x + ((b.x - a.x) * step) / count) * width, (a.y + ((b.y - a.y) * step) / count) * height);
    });
  }
  return pixels;
}
