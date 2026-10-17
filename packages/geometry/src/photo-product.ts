import { projectPhotoPoint, type PhotoCamera } from './photo-calibration';
import type { SceneObject } from '@roomsell/scene-core';

/** A measured screen envelope for a catalogue image, not a reconstructed product view. */
export function photoProductRect(camera: PhotoCamera, object: SceneObject) {
  const { x, z, rotation } = object.transform,
    { width, depth, height } = object.dimensions;
  const corners = [-1, 1].flatMap((a) =>
    [-1, 1].map((b) => {
      const dx = (a * width) / 2,
        dz = (b * depth) / 2;
      return projectPhotoPoint(camera, {
        x: x + dx * Math.cos(rotation) + dz * Math.sin(rotation),
        y: 0,
        z: z - dx * Math.sin(rotation) + dz * Math.cos(rotation),
      });
    }),
  );
  const anchor = projectPhotoPoint(camera, { x, y: 0, z });
  const top = projectPhotoPoint(camera, { x, y: height, z });
  const left = Math.min(...corners.map((p) => p.x)),
    right = Math.max(...corners.map((p) => p.x));
  const bottom = Math.max(...corners.map((p) => p.y));
  const rect = {
    x: left,
    y: Math.min(top.y, ...corners.map((p) => p.y)),
    width: right - left,
    height: bottom - Math.min(top.y, ...corners.map((p) => p.y)),
    anchor,
  };
  if (
    ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.width > 4 ||
    rect.height > 4
  )
    throw new Error('Product is outside the usable photographic perspective.');
  return rect;
}
