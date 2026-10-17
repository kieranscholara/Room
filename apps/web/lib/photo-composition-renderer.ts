import 'server-only';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { calibratePhoto, photoProductRect } from '@roomsell/geometry';
import type { Scene } from '@roomsell/scene-core';
import type { PhotoWorkspace } from './photo-contract';
import type { PhotoImageLayer } from './photo-image-contract';
import { applyImageMask } from './image-mask';
import { ServiceError } from './editor-service';
import { regionPixelMask } from './photo-provider';
import { projectFloorImage } from './photo-floor-image';

export async function catalogueCutout(bytes: Buffer, layer: PhotoImageLayer) {
  const decoded = await sharp(bytes, { limitInputPixels: 40000000 })
    .rotate()
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  applyImageMask(decoded.data, decoded.info.width, decoded.info.height, layer.mask);
  let left = decoded.info.width,
    top = decoded.info.height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < decoded.info.height; y++)
    for (let x = 0; x < decoded.info.width; x++)
      if (decoded.data[(y * decoded.info.width + x) * 4 + 3] > 8) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  if (right < left)
    throw new ServiceError(422, 'The product cutout is empty. Restore its pixels in Refine product cutout.');
  return sharp(decoded.data, { raw: { width: decoded.info.width, height: decoded.info.height, channels: 4 } })
    .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
    .png()
    .toBuffer();
}
export async function composeCataloguePhoto(
  background: Buffer,
  scene: Scene,
  workspace: PhotoWorkspace,
  layers: PhotoImageLayer[],
  images: Map<string, Buffer>,
  shadows = true,
) {
  if (!workspace.calibration) throw new ServiceError(409, 'Calibrate the selected photograph first.');
  const source = await sharp(background, { limitInputPixels: 40000000 })
    .rotate()
    .png()
    .toBuffer({ resolveWithObject: true });
  if (source.info.width * source.info.height > 16000000)
    throw new ServiceError(422, 'Use a photograph of up to 16 megapixels for a composed image.');
  const width = source.info.width,
    height = source.info.height,
    camera = calibratePhoto(workspace.calibration);
  const sorted = [...layers].sort((a, b) => {
    const x = scene.objects.find((o) => o.id === a.objectId)!,
      y = scene.objects.find((o) => o.id === b.objectId)!;
    return (
      Math.hypot(y.transform.x - camera.position[0], y.transform.z - camera.position[2]) -
      Math.hypot(x.transform.x - camera.position[0], x.transform.z - camera.position[2])
    );
  });
  let result = source.data;
  for (const layer of sorted) {
    const object = scene.objects.find((o) => o.id === layer.objectId),
      image = images.get(layer.assetId);
    if (!object || !image) throw new ServiceError(409, 'A selected product image is no longer available.');
    const rect = photoProductRect(camera, object),
      box = {
        left: Math.round(rect.x * width),
        top: Math.round(rect.y * height),
        width: Math.max(1, Math.round(rect.width * width)),
        height: Math.max(1, Math.round(rect.height * height)),
      };
    if (box.left < 0 || box.top < 0 || box.left + box.width > width || box.top + box.height > height)
      throw new ServiceError(422, 'Keep the complete product image inside the photograph.');
    if (shadows && object.category !== 'rug') {
      const svg = `<svg width="${width}" height="${height}"><defs><filter id="s"><feGaussianBlur stdDeviation="${Math.max(1, box.width * 0.025)}"/></filter></defs><ellipse cx="${rect.anchor.x * width}" cy="${rect.anchor.y * height}" rx="${box.width * 0.43}" ry="${Math.max(2, box.height * 0.045)}" fill="black" opacity=".2" filter="url(#s)"/></svg>`;
      result = await sharp(result)
        .composite([{ input: Buffer.from(svg) }])
        .png()
        .toBuffer();
    }
    const cutout = await catalogueCutout(image, layer);
    let product: Buffer;
    if (object.category === 'rug') {
      const decoded = await sharp(cutout).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const pixels = projectFloorImage(
        decoded.data,
        decoded.info.width,
        decoded.info.height,
        object,
        camera,
        box,
        width,
        height,
      );
      product = await sharp(pixels, { raw: { width: box.width, height: box.height, channels: 4 } })
        .png()
        .toBuffer();
    } else
      product = await sharp(cutout)
        .resize(box.width, box.height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
    result = await sharp(result)
      .composite([{ input: product, left: box.left, top: box.top }])
      .png()
      .toBuffer();
  }
  for (const region of workspace.regions.filter((r) => r.disposition === 'keep' && r.foreground)) {
    const mask = await sharp(regionPixelMask(region, width, height), { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer();
    const foreground = await sharp(source.data)
      .ensureAlpha()
      .composite([{ input: mask, blend: 'dest-in' }])
      .png()
      .toBuffer();
    result = await sharp(result)
      .composite([{ input: foreground }])
      .png()
      .toBuffer();
  }
  return { bytes: result, imageSha256: createHash('sha256').update(result).digest('hex') };
}
