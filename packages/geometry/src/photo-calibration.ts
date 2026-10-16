/** Perspective calibration of a measured floor rectangle. No framework/rendering dependencies. */
export interface PhotoPoint {
  x: number;
  y: number;
}
export interface PhotoCalibration {
  version: 1;
  imageWidth: number;
  imageHeight: number;
  roomWidth: number;
  roomDepth: number;
  floor: { x: number; z: number; width: number; depth: number };
  points: [PhotoPoint, PhotoPoint, PhotoPoint, PhotoPoint];
}
type V3 = [number, number, number];
export interface PhotoCamera {
  focal: number;
  width: number;
  height: number;
  axes: [V3, V3, V3];
  translation: V3;
  position: V3;
  floorToImage: number[];
  imageToFloor: number[];
  reprojectionError: number;
}
const dot = (a: V3, b: V3) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const scale = (a: V3, s: number): V3 => a.map((v) => v * s) as V3;
const norm = (a: V3) => Math.sqrt(dot(a, a));
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
function solve(rows: number[][]): number[] {
  const n = rows.length,
    a = rows.map((row) => [...row]);
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++)
      if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    if (Math.abs(a[pivot][column]) < 1e-10)
      throw new Error('Floor points are degenerate. Mark a visible measured rectangle.');
    [a[column], a[pivot]] = [a[pivot], a[column]];
    const divisor = a[column][column];
    for (let i = column; i <= n; i++) a[column][i] /= divisor;
    for (let row = 0; row < n; row++)
      if (row !== column) {
        const factor = a[row][column];
        for (let i = column; i <= n; i++) a[row][i] -= factor * a[column][i];
      }
  }
  return a.map((row) => row[n]);
}
function inverse(m: number[]) {
  const [a, b, c, d, e, f, g, h, i] = m,
    det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-10) throw new Error('The floor rectangle cannot be calibrated.');
  return [
    e * i - f * h,
    c * h - b * i,
    b * f - c * e,
    f * g - d * i,
    a * i - c * g,
    c * d - a * f,
    d * h - e * g,
    b * g - a * h,
    a * e - b * d,
  ].map((v) => v / det);
}
function map(m: number[], x: number, y: number) {
  const w = m[6] * x + m[7] * y + m[8];
  if (Math.abs(w) < 1e-8) throw new Error('This point is on the photo horizon.');
  return { x: (m[0] * x + m[1] * y + m[2]) / w, y: (m[3] * x + m[4] * y + m[5]) / w };
}
export function calibratePhoto(input: PhotoCalibration): PhotoCamera {
  const { imageWidth: w, imageHeight: h, floor, points } = input;
  if (
    input.version !== 1 ||
    ![w, h, input.roomWidth, input.roomDepth, floor.width, floor.depth].every(
      (v) => Number.isFinite(v) && v > 0,
    ) ||
    w > 12000 ||
    h > 12000 ||
    floor.width < 0.2 ||
    floor.depth < 0.2 ||
    !Number.isFinite(floor.x) ||
    !Number.isFinite(floor.z) ||
    floor.x < 0 ||
    floor.z < 0 ||
    floor.x + floor.width > input.roomWidth + 1e-8 ||
    floor.z + floor.depth > input.roomDepth + 1e-8 ||
    points.length !== 4 ||
    points.some((p) => ![p.x, p.y].every((v) => Number.isFinite(v) && v >= 0 && v <= 1))
  )
    throw new Error('Confirm the room and measured floor rectangle first.');
  const turns = points.map((p, i) => {
    const b = points[(i + 1) % 4],
      c = points[(i + 2) % 4];
    return (b.x - p.x) * (c.y - b.y) - (b.y - p.y) * (c.x - b.x);
  });
  if (turns.some((v) => v <= 0.00001))
    throw new Error('Mark the four floor points clockwise: origin, width, opposite, depth.');
  const world = [
    [floor.x, floor.z],
    [floor.x + floor.width, floor.z],
    [floor.x + floor.width, floor.z + floor.depth],
    [floor.x, floor.z + floor.depth],
  ];
  const rows = world.flatMap(([x, z], i) => {
    const u = points[i].x * w,
      v = points[i].y * h;
    return [
      [x, z, 1, 0, 0, 0, -u * x, -u * z, u],
      [0, 0, 0, x, z, 1, -v * x, -v * z, v],
    ];
  });
  const H = [...solve(rows), 1],
    cx = w / 2,
    cy = h / 2;
  const a: V3 = [H[0] - cx * H[6], H[3] - cy * H[6], H[6]],
    b: V3 = [H[1] - cx * H[7], H[4] - cy * H[7], H[7]];
  const A = [a[0] * b[0] + a[1] * b[1], a[0] ** 2 + a[1] ** 2 - b[0] ** 2 - b[1] ** 2],
    B = [a[2] * b[2], a[2] ** 2 - b[2] ** 2];
  const denominator = A[0] ** 2 + A[1] ** 2,
    invFocalSquared = -(A[0] * B[0] + A[1] * B[1]) / denominator;
  const focal = Math.sqrt(1 / invFocalSquared);
  if (!Number.isFinite(focal) || focal < Math.max(w, h) * 0.15 || focal > Math.max(w, h) * 10)
    throw new Error(
      'The points do not establish a usable camera. Use an oblique photo and a measured floor rectangle.',
    );
  const c1: V3 = [a[0] / focal, a[1] / focal, a[2]],
    c2: V3 = [b[0] / focal, b[1] / focal, b[2]];
  if (Math.abs(dot(c1, c2) / (norm(c1) * norm(c2))) > 0.08 || Math.abs(norm(c1) / norm(c2) - 1) > 0.08)
    throw new Error(
      'The rectangle dimensions and photo perspective disagree. Check the marked points and measurements.',
    );
  const k = 2 / (norm(c1) + norm(c2)),
    rx = scale(c1, 1 / norm(c1));
  const perpendicular = c2.map((v, i) => v - dot(c2, rx) * rx[i]) as V3,
    rz = scale(perpendicular, 1 / norm(perpendicular)),
    ry = cross(rz, rx);
  const translation = scale([(H[2] - cx) / focal, (H[5] - cy) / focal, 1], k);
  const axes: [V3, V3, V3] = [rx, ry, rz],
    position = axes.map((axis) => -dot(axis, translation)) as V3;
  if (position[1] < 0.2 || position[1] > 6)
    throw new Error('The camera must be above the floor. Check point order and rectangle measurements.');
  const camera: PhotoCamera = {
    focal,
    width: w,
    height: h,
    axes,
    translation,
    position,
    floorToImage: H,
    imageToFloor: inverse(H),
    reprojectionError: 0,
  };
  // Pointer projection must use exactly the recovered metric camera, including
  // when noisy manual marks were orthonormalised. The raw fitted homography
  // would disagree with the rendered model after that correction.
  const [tx, ty, tz] = translation;
  camera.floorToImage = [
    focal * rx[0] + cx * rx[2],
    focal * rz[0] + cx * rz[2],
    focal * tx + cx * tz,
    focal * rx[1] + cy * rx[2],
    focal * rz[1] + cy * rz[2],
    focal * ty + cy * tz,
    rx[2],
    rz[2],
    tz,
  ];
  camera.imageToFloor = inverse(camera.floorToImage);
  const errors = world.map(([x, z], i) => {
    const p = projectPhotoPoint(camera, { x, y: 0, z });
    return Math.hypot((p.x - points[i].x) * w, (p.y - points[i].y) * h);
  });
  camera.reprojectionError = Math.max(...errors) / Math.hypot(w, h);
  if (camera.reprojectionError > 0.02)
    throw new Error('Calibration error is too large. Recheck the floor points before placing furniture.');
  return camera;
}
export function projectPhotoPoint(camera: PhotoCamera, point: { x: number; y: number; z: number }) {
  const {
    axes: [rx, ry, rz],
    translation: t,
  } = camera;
  const cv = t.map((v, i) => v + rx[i] * point.x + ry[i] * point.y + rz[i] * point.z) as V3;
  if (cv[2] <= 0.01) throw new Error('This position is behind the photograph camera.');
  return {
    x: ((camera.focal * cv[0]) / cv[2] + camera.width / 2) / camera.width,
    y: ((camera.focal * cv[1]) / cv[2] + camera.height / 2) / camera.height,
    depth: cv[2],
  };
}
export function photoPointToFloor(camera: PhotoCamera, point: PhotoPoint) {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Invalid photograph point.');
  const result = map(camera.imageToFloor, point.x * camera.width, point.y * camera.height);
  projectPhotoPoint(camera, { x: result.x, y: 0, z: result.y });
  return { x: result.x, z: result.y };
}
export function photoPointToPlane(camera: PhotoCamera, point: PhotoPoint, height: number) {
  if (!Number.isFinite(height) || height < 0 || height >= camera.position[1] - 0.01)
    throw new Error('Drag furniture below the camera height.');
  const floor = photoPointToFloor(camera, point),
    ratio = (camera.position[1] - height) / camera.position[1];
  return {
    x: camera.position[0] + ratio * (floor.x - camera.position[0]),
    z: camera.position[2] + ratio * (floor.z - camera.position[2]),
  };
}
