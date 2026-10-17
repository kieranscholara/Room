import { photoPointToFloor, type PhotoCamera } from '@roomsell/geometry';
import type { SceneObject } from '@roomsell/scene-core';

/** Project a top-down rug photograph onto its measured floor footprint, using pixels only. */
export function projectFloorImage(
  source: Uint8Array | Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  object: SceneObject,
  camera: PhotoCamera,
  box: { left: number; top: number; width: number; height: number },
  photoWidth: number,
  photoHeight: number,
) {
  const output = new Uint8ClampedArray(box.width * box.height * 4),
    angle = object.transform.rotation,
    c = Math.cos(angle),
    s = Math.sin(angle);
  for (let y = 0; y < box.height; y++)
    for (let x = 0; x < box.width; x++) {
      const point = photoPointToFloor(camera, {
          x: (box.left + x + 0.5) / photoWidth,
          y: (box.top + y + 0.5) / photoHeight,
        }),
        dx = point.x - object.transform.x,
        dz = point.z - object.transform.z;
      const u = (dx * c - dz * s) / object.dimensions.width + 0.5,
        v = (dx * s + dz * c) / object.dimensions.depth + 0.5;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      const sourceOffset =
        (Math.min(sourceHeight - 1, Math.floor(v * sourceHeight)) * sourceWidth +
          Math.min(sourceWidth - 1, Math.floor(u * sourceWidth))) *
        4;
      const target = (y * box.width + x) * 4;
      for (let channel = 0; channel < 4; channel++) output[target + channel] = source[sourceOffset + channel];
    }
  return output;
}
