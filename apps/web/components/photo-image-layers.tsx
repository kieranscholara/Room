'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { photoProductRect, type PhotoCamera } from '@roomsell/geometry';
import type { Scene, SceneObject } from '@roomsell/scene-core';
import type { PhotoImageLayer } from '../lib/photo-image-contract';
import { applyImageMask } from '../lib/image-mask';
import type { PhotoRegion } from '../lib/photo-contract';
import { projectFloorImage } from '../lib/photo-floor-image';

function ProductPixels({
  projectId,
  layer,
  object,
  pose,
  onStart,
  onReady,
  selected,
  sourceUrl,
  interactive,
}: {
  projectId: string;
  layer: PhotoImageLayer;
  object: SceneObject;
  pose: PhotoCamera;
  onStart: (o: SceneObject, event: PointerEvent, height: number) => void;
  onReady: (id: string, ready: boolean) => void;
  selected: boolean;
  sourceUrl?: string;
  interactive: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    [raw, setRaw] = useState<ImageData | null>(null),
    [error, setError] = useState('');
  const maskKey = JSON.stringify(layer.mask);
  useEffect(() => {
    let active = true;
    setRaw(null);
    setError('');
    onReady(object.id, false);
    const image = new Image();
    image.onload = () => {
      if (!active) return;
      try {
        const scale = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight)),
          work = document.createElement('canvas');
        work.width = Math.round(image.naturalWidth * scale);
        work.height = Math.round(image.naturalHeight * scale);
        const context = work.getContext('2d', { willReadFrequently: true })!;
        context.drawImage(image, 0, 0, work.width, work.height);
        setRaw(context.getImageData(0, 0, work.width, work.height));
      } catch {
        setError('The product image could not be decoded.');
      }
    };
    image.onerror = () => {
      if (active) setError('Product photograph unavailable. Choose another catalogue view.');
    };
    image.src = sourceUrl ?? `/api/projects/${projectId}/assets/${layer.assetId}`;
    return () => {
      active = false;
      onReady(object.id, false);
    };
  }, [projectId, layer.assetId, object.id, sourceUrl, onReady]);
  const prepared = useMemo(() => {
    if (!raw) return null;
    const pixels = new Uint8ClampedArray(raw.data);
    applyImageMask(pixels, raw.width, raw.height, JSON.parse(maskKey));
    let left = raw.width,
      top = raw.height,
      right = -1,
      bottom = -1;
    for (let y = 0; y < raw.height; y++)
      for (let x = 0; x < raw.width; x++)
        if (pixels[(y * raw.width + x) * 4 + 3] > 8) {
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
    if (right < left) return null;
    const width = right - left + 1,
      height = bottom - top + 1,
      output = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++)
      output.set(
        pixels.subarray(((top + y) * raw.width + left) * 4, ((top + y) * raw.width + right + 1) * 4),
        y * width * 4,
      );
    return { pixels: output, width, height };
  }, [raw, maskKey]);
  useEffect(() => {
    const target = canvas.current;
    if (!target || !prepared) {
      onReady(object.id, false);
      if (raw && !prepared) {
        target?.getContext('2d')?.clearRect(0, 0, target.width, target.height);
        setError('The cutout is empty. Restore product pixels.');
      }
      return;
    }
    try {
      setError('');
      if (object.category === 'rug') {
        const rect = photoProductRect(pose, object),
          box = {
            left: Math.round(rect.x * pose.width),
            top: Math.round(rect.y * pose.height),
            width: Math.max(1, Math.round(rect.width * pose.width)),
            height: Math.max(1, Math.round(rect.height * pose.height)),
          };
        target.width = box.width;
        target.height = box.height;
        const pixels = projectFloorImage(
          prepared.pixels,
          prepared.width,
          prepared.height,
          object,
          pose,
          box,
          pose.width,
          pose.height,
        );
        target
          .getContext('2d')!
          .putImageData(new ImageData(new Uint8ClampedArray(pixels), box.width, box.height), 0, 0);
      } else {
        target.width = prepared.width;
        target.height = prepared.height;
        target
          .getContext('2d')!
          .putImageData(new ImageData(prepared.pixels, prepared.width, prepared.height), 0, 0);
      }
      onReady(object.id, true);
    } catch {
      setError('The product lies outside the usable photograph.');
      onReady(object.id, false);
    }
  }, [
    prepared,
    raw,
    object.id,
    object.category,
    object.transform.x,
    object.transform.z,
    object.transform.rotation,
    object.dimensions.width,
    object.dimensions.depth,
    object.dimensions.height,
    pose,
    onReady,
  ]);
  let rect;
  try {
    rect = photoProductRect(pose, object);
  } catch {
    return <p role="alert">This product is outside the usable photograph.</p>;
  }
  return (
    <div
      className={`photo-product-layer${selected ? ' selected' : ''}`}
      data-testid={`photo-image-${object.id}`}
      data-asset-id={layer.assetId}
      style={{
        left: `${rect.x * 100}%`,
        top: `${rect.y * 100}%`,
        width: `${rect.width * 100}%`,
        height: `${rect.height * 100}%`,
      }}
    >
      {error && <p role="alert">{error}</p>}
      {
        <canvas
          ref={canvas}
          aria-label={`Move ${object.name} in photograph`}
          onPointerDown={(event) => {
            if (!interactive) return;
            const c = canvas.current;
            if (!c) return;
            const b = c.getBoundingClientRect(),
              scale = Math.min(b.width / c.width, b.height / c.height),
              left = b.left + (b.width - c.width * scale) / 2,
              top = b.top + (b.height - c.height * scale) / 2,
              x = Math.floor((event.clientX - left) / scale),
              y = Math.floor((event.clientY - top) / scale);
            if (
              x < 0 ||
              y < 0 ||
              x >= c.width ||
              y >= c.height ||
              !c.getContext('2d')!.getImageData(x, y, 1, 1).data[3]
            )
              return;
            event.stopPropagation();
            onStart(object, event.nativeEvent, 0);
          }}
        />
      }
    </div>
  );
}
export function PhotoImageLayers({
  projectId,
  scene,
  pose,
  layers,
  onStart,
  onReady,
  selectedId,
  assetUrls,
  interactive = true,
}: {
  projectId: string;
  scene: Scene;
  pose: PhotoCamera;
  layers: PhotoImageLayer[];
  onStart: (o: SceneObject, e: PointerEvent, height: number) => void;
  onReady: (id: string, ready: boolean) => void;
  selectedId: string | null;
  assetUrls?: Record<string, string>;
  interactive?: boolean;
}) {
  const sorted = [...scene.objects].sort(
    (a, b) =>
      Math.hypot(b.transform.x - pose.position[0], b.transform.z - pose.position[2]) -
      Math.hypot(a.transform.x - pose.position[0], a.transform.z - pose.position[2]),
  );
  return (
    <>
      {sorted.map((object) => {
        const layer = layers.find((l) => l.objectId === object.id);
        return layer ? (
          <ProductPixels
            key={object.id}
            {...{
              projectId,
              layer,
              object,
              pose,
              onStart,
              onReady,
              selected: selectedId === object.id,
              sourceUrl: assetUrls?.[layer.assetId],
              interactive,
            }}
          />
        ) : (
          <div key={object.id} className="photo-missing-image">
            {object.name}: add a catalogue photograph to place this product.
          </div>
        );
      })}
    </>
  );
}

export function PhotoForeground({ sourceUrl, region }: { sourceUrl: string; region: PhotoRegion }) {
  const canvas = useRef<HTMLCanvasElement>(null),
    key = JSON.stringify(region);
  useEffect(() => {
    let active = true;
    const image = new Image();
    image.onload = () => {
      if (!active || !canvas.current) return;
      const c = canvas.current,
        scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
      c.width = Math.round(image.naturalWidth * scale);
      c.height = Math.round(image.naturalHeight * scale);
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(image, 0, 0, c.width, c.height);
      const data = ctx.getImageData(0, 0, c.width, c.height),
        r = JSON.parse(key) as PhotoRegion;
      for (let y = 0; y < c.height; y++)
        for (let x = 0; x < c.width; x++)
          if (
            x / c.width < r.bounds.x ||
            x / c.width > r.bounds.x + r.bounds.width ||
            y / c.height < r.bounds.y ||
            y / c.height > r.bounds.y + r.bounds.height
          )
            data.data[(y * c.width + x) * 4 + 3] = 0;
      applyImageMask(data.data, c.width, c.height, {
        automatic: false,
        strokes: r.maskStrokes ?? [],
        outline: r.outline,
      });
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.putImageData(data, 0, 0);
    };
    image.src = sourceUrl;
    return () => {
      active = false;
    };
  }, [sourceUrl, key]);
  return <canvas ref={canvas} className="photo-foreground" aria-label={`Foreground area: ${region.label}`} />;
}
