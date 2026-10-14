import type { SceneObject } from '@roomsell/scene-core';

export type Vector3Tuple = [number, number, number];
export interface ModelBounds {
  min: Vector3Tuple;
  max: Vector3Tuple;
}
/** Canonical floor anchor, right-handed +Y yaw. Renderer scale is always one. */
export function sceneObjectTransform(object: Pick<SceneObject, 'transform'>) {
  return {
    position: [object.transform.x, object.transform.y, object.transform.z] as Vector3Tuple,
    rotationY: object.transform.rotation,
    scale: [1, 1, 1] as Vector3Tuple,
  };
}
/** Applied to a model root inside the object's yaw/translation group; never rescales it. */
export function modelFloorCentreOffset(bounds: ModelBounds): Vector3Tuple {
  return [-(bounds.min[0] + bounds.max[0]) / 2, -bounds.min[1], -(bounds.min[2] + bounds.max[2]) / 2];
}
export function konvaRotationDegrees(rotationY: number) {
  return (-rotationY * 180) / Math.PI;
}
export interface PlanViewport {
  scale: number;
  originX: number;
  originZ: number;
}
export function worldToPlan(point: { x: number; z: number }, viewport: PlanViewport) {
  return { x: point.x * viewport.scale + viewport.originX, y: point.z * viewport.scale + viewport.originZ };
}
export function planToWorld(point: { x: number; y: number }, viewport: PlanViewport) {
  return {
    x: (point.x - viewport.originX) / viewport.scale,
    z: (point.y - viewport.originZ) / viewport.scale,
  };
}
