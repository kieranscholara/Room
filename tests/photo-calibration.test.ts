import { describe, it, expect } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import {
  calibratePhoto,
  photoPointToFloor,
  photoPointToPlane,
  projectPhotoPoint,
  type PhotoCalibration,
} from '@roomsell/geometry';

export function calibrationFixture(position = [7, 2.5, 8], width = 1536, height = 1024): PhotoCalibration {
  const camera = new PerspectiveCamera(50, width / height, 0.01, 100);
  camera.position.set(...(position as [number, number, number]));
  camera.lookAt(3, 0.4, 2.5);
  camera.updateMatrixWorld();
  const points = [
    [1, 1],
    [4, 1],
    [4, 3],
    [1, 3],
  ].map(([x, z]) => {
    const p = new Vector3(x, 0, z).project(camera);
    return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
  }) as PhotoCalibration['points'];
  return {
    version: 1,
    imageWidth: width,
    imageHeight: height,
    roomWidth: 6,
    roomDepth: 5,
    floor: { x: 1, z: 1, width: 3, depth: 2 },
    points,
  };
}
describe('measured photograph camera calibration', () => {
  it.each([
    [7, 2.5, 8],
    [3, 2, 8],
    [8, 3, 7],
    [6, 1.5, 9],
  ])('recovers metric scale, camera pose and height from a floor rectangle %j', (...position) => {
    const input = calibrationFixture(position),
      actual = calibratePhoto(input);
    for (let i = 0; i < 3; i++) expect(actual.position[i]).toBeCloseTo(position[i], 6);
    const reference = new PerspectiveCamera(50, 1.5, 0.01, 100);
    reference.position.set(...(position as [number, number, number]));
    reference.lookAt(3, 0.4, 2.5);
    reference.updateMatrixWorld();
    for (const point of [
      { x: 2, y: 0, z: 2 },
      { x: 3, y: 1.8, z: 1 },
      { x: 4, y: 0.7, z: 3 },
    ]) {
      const expected = new Vector3(point.x, point.y, point.z).project(reference),
        projected = projectPhotoPoint(actual, point);
      expect(projected.x).toBeCloseTo((expected.x + 1) / 2, 6);
      expect(projected.y).toBeCloseTo((1 - expected.y) / 2, 6);
    }
    const pixel = projectPhotoPoint(actual, { x: 2.4, y: 0, z: 2.2 });
    expect(photoPointToFloor(actual, pixel).x).toBeCloseTo(2.4, 8);
    expect(photoPointToFloor(actual, pixel).z).toBeCloseTo(2.2, 8);
  });
  it('keeps a grabbed mesh point under the pointer on its horizontal plane', () => {
    const camera = calibratePhoto(calibrationFixture()),
      p = { x: 3, y: 0.8, z: 2 },
      pixel = projectPhotoPoint(camera, p);
    expect(photoPointToPlane(camera, pixel, p.y)).toEqual({
      x: expect.closeTo(p.x, 8),
      z: expect.closeTo(p.z, 8),
    });
    expect(() => photoPointToPlane(camera, pixel, 3)).toThrow();
  });
  it('keeps projection identical across proportional image resolutions', () => {
    const a = calibratePhoto(calibrationFixture()),
      b = calibratePhoto(calibrationFixture([7, 2.5, 8], 768, 512));
    const point = { x: 3, y: 1, z: 2 };
    expect(projectPhotoPoint(a, point)).toEqual(
      expect.objectContaining({
        x: expect.closeTo(projectPhotoPoint(b, point).x, 8),
        y: expect.closeTo(projectPhotoPoint(b, point).y, 8),
      }),
    );
  });
  it('rejects crossed, reversed, duplicate and unmeasured points', () => {
    const base = calibrationFixture();
    for (const points of [
      [base.points[0], base.points[2], base.points[1], base.points[3]],
      [...base.points].reverse(),
      base.points.map(() => base.points[0]),
    ])
      expect(() => calibratePhoto({ ...base, points: points as PhotoCalibration['points'] })).toThrow();
    expect(() => calibratePhoto({ ...base, floor: { ...base.floor, width: 30 } })).toThrow();
  });
  it('rejects inconsistent camera and rectangle dimensions instead of stretching products', () => {
    const base = calibrationFixture();
    expect(() => calibratePhoto({ ...base, floor: { ...base.floor, width: 0.3 } })).toThrow();
  });
  it('uses the same camera for rendering and pointer inversion after noisy manual marks', () => {
    const input = calibrationFixture();
    input.points[1].y += 0.001;
    input.points[3].x -= 0.001;
    const camera = calibratePhoto(input),
      p = { x: 3.2, y: 0, z: 2.1 };
    expect(camera.reprojectionError).toBeGreaterThan(0);
    const actual = photoPointToFloor(camera, projectPhotoPoint(camera, p));
    expect(actual.x).toBeCloseTo(p.x, 8);
    expect(actual.z).toBeCloseTo(p.z, 8);
    expect(() => calibratePhoto({ ...input, floor: { ...input.floor, x: NaN } })).toThrow();
  });
});
