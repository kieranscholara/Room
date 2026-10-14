import { describe, expect, it } from 'vitest';
import { Box3, BoxGeometry, Group, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import { Transform as KonvaTransform } from 'konva/lib/Util';
import { createDemoScene } from '@roomsell/scene-core';
import {
  bounds,
  footprint,
  konvaRotationDegrees,
  modelFloorCentreOffset,
  planToWorld,
  sceneObjectTransform,
  worldToPlan,
} from '@roomsell/geometry';

describe('actual Three and Konva transforms share the canonical scene', () => {
  it.each([0, Math.PI / 2, -Math.PI / 2, Math.PI, 0.713])(
    'projects an asymmetric offset-origin mesh at yaw %s to the canonical footprint',
    (rotation) => {
      const object = {
        ...createDemoScene().objects[1],
        dimensions: { width: 2, depth: 0.7, height: 1.5 },
        transform: { x: 3, y: 0 as const, z: 2, rotation },
      };
      const before = JSON.stringify(object);
      const modelBounds = {
        min: [5, -2, -9] as [number, number, number],
        max: [7, -0.5, -8.3] as [number, number, number],
      };
      const model = new Mesh(new BoxGeometry(2, 1.5, 0.7));
      model.geometry.translate(6, -1.25, -8.65);
      const anchor = new Group();
      const transform = sceneObjectTransform(object);
      anchor.position.set(...transform.position);
      anchor.rotation.y = transform.rotationY;
      anchor.scale.set(...transform.scale);
      model.position.set(...modelFloorCentreOffset(modelBounds));
      anchor.add(model);
      anchor.updateMatrixWorld(true);
      const projected = new Box3().setFromObject(anchor);
      const expected = bounds(footprint(object));
      expect(projected.min.x).toBeCloseTo(expected.minX, 5);
      expect(projected.max.x).toBeCloseTo(expected.maxX, 5);
      expect(projected.min.z).toBeCloseTo(expected.minZ, 5);
      expect(projected.max.z).toBeCloseTo(expected.maxZ, 5);
      expect(projected.min.y).toBeCloseTo(0, 5);
      expect(projected.max.y).toBeCloseTo(object.dimensions.height, 5);

      const screen = new KonvaTransform();
      const viewport = { scale: 47.25, originX: 113.5, originZ: -28.25 };
      const position = worldToPlan(object.transform, viewport);
      screen.translate(position.x, position.y);
      screen.rotate((konvaRotationDegrees(rotation) * Math.PI) / 180);
      screen.scale(viewport.scale, viewport.scale);
      const local = [
        [-1, -0.35],
        [1, -0.35],
        [1, 0.35],
        [-1, 0.35],
      ];
      local.forEach(([x, z], index) => {
        const projectedPoint = planToWorld(screen.point({ x, y: z }), viewport);
        expect(projectedPoint.x).toBeCloseTo(footprint(object)[index].x, 10);
        expect(projectedPoint.z).toBeCloseTo(footprint(object)[index].z, 10);
      });
      expect(JSON.stringify(object)).toBe(before);
      model.geometry.dispose();
    },
  );
  it('matches actual Three +Y rotation for an independently composed transform matrix', () => {
    const matrix = new Matrix4().compose(
      new Vector3(3, 0, 2),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2),
      new Vector3(1, 1, 1),
    );
    const point = new Vector3(1, 0, 0).applyMatrix4(matrix);
    expect(point.x).toBeCloseTo(3);
    expect(point.z).toBeCloseTo(1);
  });
  it('round-trips pan and zoom without storing viewport coordinates in the scene', () => {
    for (const scale of [0.5, 17, 93.4])
      for (const origin of [-300, 0, 725.3]) {
        const viewport = { scale, originX: origin, originZ: -origin / 3 };
        const point = { x: 2.375, z: 7.125 };
        const result = planToWorld(worldToPlan(point, viewport), viewport);
        expect(result.x).toBeCloseTo(point.x, 10);
        expect(result.z).toBeCloseTo(point.z, 10);
      }
  });
});
