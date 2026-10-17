'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@roomsell/ui';
import type { ImageMask } from '../lib/photo-image-contract';
import { applyImageMask } from '../lib/image-mask';

export function PixelMaskEditor({
  sourceUrl,
  mask,
  onChange,
  disabled = false,
  label,
  bounds,
}: {
  sourceUrl: string;
  mask: ImageMask;
  onChange: (mask: ImageMask) => void;
  disabled?: boolean;
  label: string;
  bounds?: { x: number; y: number; width: number; height: number };
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    source = useRef<ImageData | null>(null),
    drawing = useRef(false);
  const [mode, setMode] = useState<'erase' | 'restore'>('erase'),
    [radius, setRadius] = useState(0.03),
    [error, setError] = useState('');
  const draw = () => {
    const c = canvas.current,
      s = source.current;
    if (!c || !s) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const pixels = new Uint8ClampedArray(s.data);
    if (bounds)
      for (let y = 0; y < s.height; y++)
        for (let x = 0; x < s.width; x++)
          if (
            x / s.width < bounds.x ||
            x / s.width > bounds.x + bounds.width ||
            y / s.height < bounds.y ||
            y / s.height > bounds.y + bounds.height
          )
            pixels[(y * s.width + x) * 4 + 3] = 0;
    applyImageMask(pixels, s.width, s.height, mask);
    ctx.clearRect(0, 0, s.width, s.height);
    ctx.putImageData(new ImageData(pixels, s.width, s.height), 0, 0);
  };
  const latestDraw = useRef(draw);
  latestDraw.current = draw;
  useEffect(() => {
    let active = true;
    const image = new Image();
    image.onload = () => {
      if (!active || !canvas.current) return;
      const scale = Math.min(1, 900 / Math.max(image.naturalWidth, image.naturalHeight)),
        c = canvas.current;
      c.width = Math.round(image.naturalWidth * scale);
      c.height = Math.round(image.naturalHeight * scale);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(image, 0, 0, c.width, c.height);
      source.current = ctx.getImageData(0, 0, c.width, c.height);
      latestDraw.current();
    };
    image.onerror = () => setError('The source image could not be opened.');
    image.src = sourceUrl;
    return () => {
      active = false;
    };
  }, [sourceUrl]);
  useEffect(draw, [mask, bounds]);
  return (
    <details className="photo-mask-editor">
      <summary>{label}</summary>
      <p>
        Brush away background or restore original pixels. The checkerboard is transparent. Review the outline
        before using it.
      </p>
      {!bounds && (
        <label>
          <input
            type="checkbox"
            checked={mask.automatic}
            disabled={disabled}
            onChange={(e) => onChange({ ...mask, automatic: e.target.checked })}
          />{' '}
          Remove connected background automatically
        </label>
      )}
      <div className="photo-actions">
        <Button disabled={disabled} aria-pressed={mode === 'erase'} onClick={() => setMode('erase')}>
          Erase pixels
        </Button>
        <Button disabled={disabled} aria-pressed={mode === 'restore'} onClick={() => setMode('restore')}>
          Restore pixels
        </Button>
        <label>
          Brush size{' '}
          <input
            aria-label={`${label} brush size`}
            type="range"
            min=".005"
            max=".12"
            step=".005"
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
          />
        </label>
        <Button
          disabled={disabled || !mask.strokes.length}
          onClick={() => onChange({ ...mask, strokes: mask.strokes.slice(0, -1) })}
        >
          Undo brush stroke
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      <canvas
        ref={canvas}
        aria-label={`${label} canvas`}
        className="photo-mask-canvas"
        onPointerDown={(e) => {
          if (disabled || mask.strokes.length >= 60) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          const b = e.currentTarget.getBoundingClientRect();
          onChange({
            ...mask,
            strokes: [
              ...mask.strokes,
              {
                mode,
                radius,
                points: [
                  {
                    x: Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)),
                    y: Math.max(0, Math.min(1, (e.clientY - b.top) / b.height)),
                  },
                ],
              },
            ],
          });
        }}
        onPointerMove={(e) => {
          if (!drawing.current || disabled) return;
          const b = e.currentTarget.getBoundingClientRect(),
            strokes = [...mask.strokes],
            last = strokes.at(-1);
          if (!last || last.points.length >= 100) return;
          strokes[strokes.length - 1] = {
            ...last,
            points: [
              ...last.points,
              {
                x: Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)),
                y: Math.max(0, Math.min(1, (e.clientY - b.top) / b.height)),
              },
            ],
          };
          onChange({ ...mask, strokes });
        }}
        onPointerUp={() => {
          drawing.current = false;
        }}
        onPointerCancel={() => {
          drawing.current = false;
        }}
      />
      {mask.strokes.length >= 60 && <p>Mask limit reached. Undo a stroke to continue.</p>}
    </details>
  );
}
