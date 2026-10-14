import sharp from 'sharp';
import { validateBytes, validateString } from 'gltf-validator';
import { dimensionsSchema, type Dimensions } from './index';

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

export class AssetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetValidationError';
  }
}
export interface AssetValidationResult {
  kind: 'image' | 'model';
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'model/gltf-binary' | 'model/gltf+json';
  sizeBytes: number;
  dimensions?: Dimensions;
  validation: Record<string, unknown>;
}
export interface AssetValidationOptions {
  fileName: string;
  expectedDimensions?: Dimensions;
}
type Json = Record<string, unknown>;
type Vec3 = [number, number, number];
type Matrix = number[];
const error = (message: string): never => {
  throw new AssetValidationError(message);
};
function record(value: unknown, label: string): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return error(`Invalid ${label}`);
  return value as Json;
}
function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) return error(`Invalid ${label}`);
  return value;
}
function integer(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum)
    return error(`Invalid ${label}`);
  return value;
}
function imageMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | undefined {
  const data = Buffer.from(bytes);
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg';
  if (
    data.length >= 12 &&
    data.toString('ascii', 0, 4) === 'RIFF' &&
    data.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp';
}
async function decodeImage(bytes: Uint8Array, texture = false) {
  const mimeType = imageMime(bytes);
  if (!mimeType) return error('Only PNG, JPEG and WebP images are supported');
  if (bytes.byteLength > ASSET_LIMITS.imageBytes) return error('Image exceeds the 10 MiB limit');
  try {
    const decoder = sharp(Buffer.from(bytes), {
      limitInputPixels: ASSET_LIMITS.imagePixels,
      failOn: 'warning',
      animated: true,
    });
    const metadata = await decoder.metadata();
    const expectedFormat = mimeType === 'image/jpeg' ? 'jpeg' : mimeType.slice(6);
    if (metadata.format !== expectedFormat) return error('Image format does not match its bytes');
    const width = metadata.width ?? 0,
      height = metadata.height ?? 0;
    const maxSide = texture ? ASSET_LIMITS.textureSide : ASSET_LIMITS.imageSide;
    if (!width || !height || width > maxSide || height > maxSide || width * height > ASSET_LIMITS.imagePixels)
      return error(`Image dimensions exceed ${maxSide}px per side or the pixel limit`);
    if ((metadata.pages ?? 1) !== 1) return error('Animated and multipage images are unsupported');
    // Full decoding catches truncated/corrupt data that a header-only metadata check can miss.
    await decoder.raw().toBuffer();
    return { mimeType, width, height, pixels: width * height };
  } catch (cause) {
    if (cause instanceof AssetValidationError) throw cause;
    return error('Image data is corrupt, truncated or exceeds decoding limits');
  }
}
function dataUri(uri: unknown, label: string): Uint8Array {
  if (typeof uri !== 'string') return error(`Invalid ${label} URI`);
  const match =
    /^data:(application\/(?:octet-stream|gltf-buffer)|image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(
      uri,
    );
  if (!match || match[2].length % 4 !== 0)
    return error(`${label} must use an embedded base64 data URI; external resources are unsupported`);
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.toString('base64') !== match[2]) return error(`Invalid ${label} base64 encoding`);
  return bytes;
}
function parseModel(bytes: Uint8Array, binary: boolean): { json: Json; text: string; bin?: Uint8Array } {
  let jsonBytes: Uint8Array = bytes;
  let bin: Uint8Array | undefined;
  if (binary) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (
      bytes.byteLength < 20 ||
      view.getUint32(0, true) !== 0x46546c67 ||
      view.getUint32(4, true) !== 2 ||
      view.getUint32(8, true) !== bytes.byteLength
    )
      return error('Invalid GLB v2 header or declared length');
    let offset = 12,
      chunks = 0;
    while (offset < bytes.byteLength) {
      if (offset + 8 > bytes.byteLength) return error('Truncated GLB chunk');
      const length = view.getUint32(offset, true),
        type = view.getUint32(offset + 4, true);
      offset += 8;
      if (length % 4 !== 0 || offset + length > bytes.byteLength) return error('Invalid GLB chunk length');
      if (chunks === 0 && type === 0x4e4f534a) jsonBytes = bytes.subarray(offset, offset + length);
      else if (chunks === 1 && type === 0x004e4942) bin = bytes.subarray(offset, offset + length);
      else return error('GLB must contain JSON followed by at most one binary chunk');
      offset += length;
      chunks++;
    }
    if (chunks === 0) return error('GLB is missing its JSON chunk');
  }
  let text: string, json: Json;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(jsonBytes);
    json = record(JSON.parse(text), 'glTF JSON');
  } catch (cause) {
    if (cause instanceof AssetValidationError) throw cause;
    return error('Model must contain valid UTF-8 glTF JSON');
  }
  return { json, text, bin };
}
function bufferSlice(json: Json, buffers: Uint8Array[], index: unknown, label: string): Uint8Array {
  const views = list(json.bufferViews, 'bufferViews');
  const view = record(views[integer(index, `${label} bufferView`)], `${label} bufferView`);
  const buffer = buffers[integer(view.buffer, `${label} buffer`)];
  if (!buffer) return error(`Missing ${label} buffer`);
  const offset = integer(view.byteOffset ?? 0, `${label} offset`),
    length = integer(view.byteLength, `${label} byteLength`, 1);
  if (offset + length > buffer.byteLength) return error(`${label} bufferView exceeds its buffer`);
  return buffer.subarray(offset, offset + length);
}
function finiteVector(value: unknown, length: number, label: string, fallback: number[]): number[] {
  if (value === undefined) return fallback;
  if (
    !Array.isArray(value) ||
    value.length !== length ||
    !value.every((part) => typeof part === 'number' && Number.isFinite(part))
  )
    return error(`Invalid ${label}`);
  return value as number[];
}
const identity = (): Matrix => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function multiply(a: Matrix, b: Matrix): Matrix {
  const result = Array<number>(16).fill(0);
  for (let column = 0; column < 4; column++)
    for (let row = 0; row < 4; row++)
      for (let inner = 0; inner < 4; inner++)
        result[column * 4 + row] += a[inner * 4 + row] * b[column * 4 + inner];
  if (!result.every(Number.isFinite)) return error('Model transform exceeds finite numeric limits');
  return result;
}
function localMatrix(node: Json): Matrix {
  if (node.matrix !== undefined) return finiteVector(node.matrix, 16, 'node matrix', identity());
  const translation = finiteVector(node.translation, 3, 'node translation', [0, 0, 0]);
  const scale = finiteVector(node.scale, 3, 'node scale', [1, 1, 1]);
  const [x, y, z, w] = finiteVector(node.rotation, 4, 'node rotation', [0, 0, 0, 1]);
  if (Math.abs(x * x + y * y + z * z + w * w - 1) > 0.001)
    return error('Node rotation quaternion must be normalised');
  return [
    (1 - 2 * (y * y + z * z)) * scale[0],
    2 * (x * y + z * w) * scale[0],
    2 * (x * z - y * w) * scale[0],
    0,
    2 * (x * y - z * w) * scale[1],
    (1 - 2 * (x * x + z * z)) * scale[1],
    2 * (y * z + x * w) * scale[1],
    0,
    2 * (x * z + y * w) * scale[2],
    2 * (y * z - x * w) * scale[2],
    (1 - 2 * (x * x + y * y)) * scale[2],
    0,
    translation[0],
    translation[1],
    translation[2],
    1,
  ];
}
function accessor(json: Json, buffers: Uint8Array[], index: unknown, position: boolean) {
  const item = record(list(json.accessors, 'accessors')[integer(index, 'accessor index')], 'accessor');
  if (item.sparse !== undefined) return error('Sparse geometry accessors are unsupported');
  if (item.normalized === true) return error('Normalised geometry accessors are unsupported');
  const component = integer(item.componentType, 'accessor componentType');
  if (
    position
      ? component !== 5126 || item.type !== 'VEC3'
      : ![5121, 5123, 5125].includes(component) || item.type !== 'SCALAR'
  )
    return error(
      position
        ? 'Positions must use float32 VEC3 accessors in metres'
        : 'Indices must use unsigned SCALAR accessors',
    );
  const count = integer(item.count, 'accessor count', 1);
  if (count > (position ? ASSET_LIMITS.vertices : ASSET_LIMITS.triangles * 3))
    return error('Geometry exceeds vertex or triangle limits');
  const buffer = bufferSlice(json, buffers, item.bufferView, 'geometry');
  const viewDescription = record(
    list(json.bufferViews, 'bufferViews')[integer(item.bufferView, 'accessor bufferView')],
    'accessor bufferView',
  );
  const size = component === 5121 ? 1 : component === 5123 ? 2 : 4;
  const components = position ? 3 : 1;
  const stride = integer(
    viewDescription.byteStride ?? size * components,
    'accessor stride',
    size * components,
  );
  const offset = integer(item.byteOffset ?? 0, 'accessor offset');
  if (offset + (count - 1) * stride + size * components > buffer.byteLength)
    return error('Geometry accessor exceeds its bufferView');
  const data = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return {
    count,
    read(vertex: number): number[] {
      if (vertex >= count) return error('Mesh index is outside its position accessor');
      const values: number[] = [];
      for (let channel = 0; channel < components; channel++) {
        const location = offset + vertex * stride + channel * size;
        const value = position
          ? data.getFloat32(location, true)
          : size === 1
            ? data.getUint8(location)
            : size === 2
              ? data.getUint16(location, true)
              : data.getUint32(location, true);
        if (!Number.isFinite(value)) return error('Geometry contains non-finite coordinates');
        values.push(value);
      }
      return values;
    },
  };
}
function measureModel(json: Json, buffers: Uint8Array[]) {
  const nodes = list(json.nodes, 'nodes'),
    meshes = list(json.meshes, 'meshes');
  if (nodes.length > ASSET_LIMITS.nodes) return error('Model exceeds the 1000-node limit');
  const scenes = list(json.scenes, 'scenes');
  const scene = record(scenes[integer(json.scene ?? 0, 'default scene')], 'default scene');
  let vertices = 0,
    triangles = 0;
  const min: Vec3 = [Infinity, Infinity, Infinity],
    max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const visited = new Set<number>();
  const traverse = (index: number, parent: Matrix, ancestors: Set<number>) => {
    if (ancestors.has(index) || visited.has(index))
      return error('Node hierarchy contains a cycle or repeated node');
    visited.add(index);
    const node = record(nodes[index], 'scene node');
    if (node.skin !== undefined || node.weights !== undefined)
      return error('Skinned and morph-target models are unsupported');
    const world = multiply(parent, localMatrix(node));
    if (node.mesh !== undefined) {
      const mesh = record(meshes[integer(node.mesh, 'node mesh')], 'mesh');
      for (const raw of list(mesh.primitives, 'mesh primitives')) {
        const primitive = record(raw, 'mesh primitive');
        if ((primitive.mode ?? 4) !== 4) return error('Only triangle mesh primitives are supported');
        if (primitive.targets !== undefined) return error('Morph-target models are unsupported');
        const position = accessor(
          json,
          buffers,
          record(primitive.attributes, 'primitive attributes').POSITION,
          true,
        );
        const indices =
          primitive.indices === undefined ? undefined : accessor(json, buffers, primitive.indices, false);
        const count = indices?.count ?? position.count;
        if (count % 3 !== 0) return error('Triangle index/vertex count must be divisible by three');
        triangles += count / 3;
        vertices += position.count;
        if (triangles > ASSET_LIMITS.triangles || vertices > ASSET_LIMITS.vertices)
          return error('Model exceeds the 200000-triangle or 500000-vertex limit');
        for (let reference = 0; reference < count; reference++) {
          const values = position.read(indices ? indices.read(reference)[0] : reference);
          for (let axis = 0; axis < 3; axis++) {
            const coordinate =
              world[axis] * values[0] +
              world[4 + axis] * values[1] +
              world[8 + axis] * values[2] +
              world[12 + axis];
            if (!Number.isFinite(coordinate) || Math.abs(coordinate) > 1000)
              return error('Model coordinates exceed supported metre bounds');
            min[axis] = Math.min(min[axis], coordinate);
            max[axis] = Math.max(max[axis], coordinate);
          }
        }
      }
    }
    const next = new Set(ancestors);
    next.add(index);
    for (const child of node.children === undefined ? [] : list(node.children, 'node children'))
      traverse(integer(child, 'child node'), world, next);
  };
  for (const root of list(scene.nodes, 'scene nodes'))
    traverse(integer(root, 'root node'), identity(), new Set());
  if (!triangles) return error('Model scene must contain triangle geometry');
  const dimensions = { width: max[0] - min[0], depth: max[2] - min[2], height: max[1] - min[1] };
  const parsed = dimensionsSchema.safeParse(dimensions);
  if (!parsed.success)
    return error('Model bounds must have positive width, depth and height within product limits');
  return { dimensions: parsed.data, bounds: { min, max }, vertices, triangles, nodes: visited.size };
}

/** Validate bytes before storage. Models use glTF metres, X width / Z depth / Y height. */
export async function validateProductAsset(
  bytes: Uint8Array,
  options: AssetValidationOptions,
): Promise<AssetValidationResult> {
  if (!bytes.byteLength) return error('Asset is empty');
  const mimeType = imageMime(bytes);
  if (mimeType) {
    const decoded = await decodeImage(bytes);
    return {
      kind: 'image',
      mimeType,
      sizeBytes: bytes.byteLength,
      validation: { validator: 'sharp-full-decode', ...decoded },
    };
  }
  if (bytes.byteLength > ASSET_LIMITS.modelBytes) return error('Model exceeds the 50 MiB limit');
  const binary = bytes.length >= 4 && Buffer.from(bytes).toString('ascii', 0, 4) === 'glTF';
  if (!binary && !options.fileName.toLowerCase().endsWith('.gltf'))
    return error('Only PNG, JPEG, WebP, GLB and self-contained glTF assets are supported');
  const expectedResult = dimensionsSchema.safeParse(options.expectedDimensions);
  if (!expectedResult.success)
    return error('A model must be validated against authoritative variant dimensions');
  const expected = expectedResult.data;
  const { json, text, bin } = parseModel(bytes, binary);
  const asset = record(json.asset, 'glTF asset');
  if (asset.version !== '2.0') return error('Only glTF 2.0 models are supported');
  for (const name of ['extensionsUsed', 'extensionsRequired'])
    if (json[name] !== undefined)
      for (const extension of list(json[name], name))
        if (!['KHR_materials_unlit', 'KHR_texture_transform'].includes(String(extension)))
          return error(`Unsupported glTF extension: ${String(extension)}`);
  if (
    (json.animations !== undefined && list(json.animations, 'animations').length) ||
    (json.skins !== undefined && list(json.skins, 'skins').length)
  )
    return error('Animated and skinned models are unsupported');
  const rawBuffers = list(json.buffers, 'buffers');
  const buffers = rawBuffers.map((raw, index) => {
    const description = record(raw, 'buffer');
    const data =
      description.uri === undefined && binary && index === 0 && bin
        ? bin
        : dataUri(description.uri, 'Buffer');
    const length = integer(description.byteLength, 'buffer byteLength', 1);
    if (data.byteLength < length || data.byteLength - length > (description.uri === undefined ? 3 : 0))
      return error('Embedded buffer length does not match its declared length');
    return data.subarray(0, length);
  });
  if (buffers.reduce((total, buffer) => total + buffer.byteLength, 0) > ASSET_LIMITS.modelBytes)
    return error('Decoded model buffers exceed the 50 MiB limit');
  const rawImages = json.images === undefined ? [] : list(json.images, 'images');
  if (
    rawImages.length > ASSET_LIMITS.textures ||
    (json.textures !== undefined && list(json.textures, 'textures').length > ASSET_LIMITS.textures)
  )
    return error('Model exceeds the 32-texture limit');
  let texturePixels = 0;
  for (const raw of rawImages) {
    const image = record(raw, 'texture image');
    const data =
      image.uri === undefined
        ? bufferSlice(json, buffers, image.bufferView, 'texture')
        : dataUri(image.uri, 'Texture');
    const decoded = await decodeImage(data, true);
    if (image.mimeType !== undefined && image.mimeType !== decoded.mimeType)
      return error('Texture MIME type does not match its bytes');
    texturePixels += decoded.pixels;
    if (texturePixels > ASSET_LIMITS.texturePixels)
      return error('Model textures exceed the 32-million-pixel limit');
  }
  let report;
  try {
    const validatorOptions = {
      maxIssues: 30,
      externalResourceFunction: async (_uri: string): Promise<Uint8Array> =>
        error('External model resources are unsupported'),
    };
    report = binary
      ? await validateBytes(bytes, validatorOptions)
      : await validateString(text, validatorOptions);
  } catch (cause) {
    if (cause instanceof AssetValidationError) throw cause;
    return error('Model failed glTF structural validation');
  }
  if (report.issues.numErrors)
    return error(`Model failed glTF structural validation (${report.issues.numErrors} errors)`);
  const measured = measureModel(json, buffers);
  for (const axis of ['width', 'depth', 'height'] as const)
    if (Math.abs(measured.dimensions[axis] - expected[axis]) > Math.max(0.02, expected[axis] * 0.02))
      return error(`Model ${axis} does not match catalogue dimensions within 2 cm or 2%`);
  return {
    kind: 'model',
    mimeType: binary ? 'model/gltf-binary' : 'model/gltf+json',
    sizeBytes: bytes.byteLength,
    dimensions: measured.dimensions,
    validation: {
      validator: 'khronos-gltf-validator',
      warnings: report.issues.numWarnings,
      units: 'metres',
      axes: { width: 'x', depth: 'z', height: 'y' },
      tolerance: { metres: 0.02, proportion: 0.02 },
      ...measured,
      texturePixels,
      textures: rawImages.length,
    },
  };
}
