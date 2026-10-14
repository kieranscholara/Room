/** Shared byte/complexity limits. Safe to import in browsers; byte validation stays server-only. */
export const ASSET_LIMITS = {
  imageBytes: 10 * 1024 * 1024,
  modelBytes: 50 * 1024 * 1024,
  imageSide: 8192,
  imagePixels: 40_000_000,
  textureSide: 4096,
  texturePixels: 32_000_000,
  triangles: 200_000,
  vertices: 500_000,
  nodes: 1000,
  textures: 32,
} as const;

/** Accepted export precision. Rendering preserves measured mesh size and never applies scale. */
export const MODEL_DIMENSION_TOLERANCE = { metres: 0.02, proportion: 0.02 } as const;
export function modelAxisTolerance(expectedMetres: number) {
  return Math.max(MODEL_DIMENSION_TOLERANCE.metres, expectedMetres * MODEL_DIMENSION_TOLERANCE.proportion);
}

export interface ModelDimensions {
  width: number;
  depth: number;
  height: number;
}
export function dimensionsWithinModelTolerance(measured: ModelDimensions, expected: ModelDimensions) {
  return (['width', 'depth', 'height'] as const).every(
    (axis) =>
      Number.isFinite(measured[axis]) &&
      measured[axis] > 0 &&
      Number.isFinite(expected[axis]) &&
      expected[axis] > 0 &&
      Math.abs(measured[axis] - expected[axis]) <= modelAxisTolerance(expected[axis]),
  );
}
