import { Box3, BufferGeometry, LoadingManager, Material, Mesh, Object3D, Texture, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  ASSET_LIMITS,
  dimensionsWithinModelTolerance,
  type ProjectCatalogueAsset,
} from '@roomsell/catalogue';
import { modelFloorCentreOffset } from '@roomsell/geometry';
import type { SceneObject } from '@roomsell/scene-core';

type Json = Record<string, unknown>;
export interface RenderedModelMeasurement {
  bounds: { min: [number, number, number]; max: [number, number, number] };
  dimensions: SceneObject['dimensions'];
  triangles: number;
  vertices: number;
}
export interface LoadedRoomModel extends RenderedModelMeasurement {
  scene: Object3D;
  originOffset: [number, number, number];
}

function record(value: unknown, label: string): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Unsupported model ${label}.`);
  return value as Json;
}
function optionalList(value: unknown, label: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`Unsupported model ${label}.`);
  return value;
}
function embeddedUri(value: unknown, label: string, image: boolean) {
  const pattern = image
    ? /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]*={0,2}$/
    : /^data:application\/(?:octet-stream|gltf-buffer);base64,[A-Za-z0-9+/]*={0,2}$/;
  if (typeof value !== 'string' || !pattern.test(value))
    throw new Error(`${label} must be embedded. External model resources are blocked.`);
}

/** A second boundary before GLTFLoader: no uploaded document can cause external fetches. */
export function inspectSelfContainedModel(bytes: ArrayBuffer): Json {
  if (!bytes.byteLength || bytes.byteLength > ASSET_LIMITS.modelBytes)
    throw new Error('Model exceeds the supported byte limit.');
  const view = new DataView(bytes);
  const binary = bytes.byteLength >= 4 && view.getUint32(0, true) === 0x46546c67;
  let jsonBytes = new Uint8Array(bytes);
  let hasBinaryChunk = false;
  if (binary) {
    if (
      bytes.byteLength < 20 ||
      view.getUint32(4, true) !== 2 ||
      view.getUint32(8, true) !== bytes.byteLength
    )
      throw new Error('Invalid GLB v2 header.');
    let offset = 12;
    let chunks = 0;
    while (offset < bytes.byteLength) {
      if (offset + 8 > bytes.byteLength) throw new Error('Truncated GLB chunk.');
      const length = view.getUint32(offset, true);
      const type = view.getUint32(offset + 4, true);
      offset += 8;
      if (length % 4 || offset + length > bytes.byteLength) throw new Error('Invalid GLB chunk.');
      if (chunks === 0 && type === 0x4e4f534a) jsonBytes = new Uint8Array(bytes, offset, length);
      else if (chunks === 1 && type === 0x004e4942) hasBinaryChunk = true;
      else throw new Error('Unsupported GLB chunk sequence.');
      offset += length;
      chunks++;
    }
    if (!chunks) throw new Error('GLB is missing its JSON chunk.');
  }
  const json = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(jsonBytes)), 'document');
  if (record(json.asset, 'asset').version !== '2.0')
    throw new Error('Only static glTF 2.0 models are supported.');
  for (const name of ['extensionsUsed', 'extensionsRequired'])
    for (const extension of optionalList(json[name], name))
      if (!['KHR_materials_unlit', 'KHR_texture_transform'].includes(String(extension)))
        throw new Error('This model extension is unsupported.');
  // GLTFLoader plugins inspect nested extension objects too. An undeclared
  // extension must not evade the supported-format policy.
  const pending: unknown[] = [json];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    const object = value as Json;
    if (object.extensions !== undefined)
      for (const extension of Object.keys(record(object.extensions, 'extensions')))
        if (!['KHR_materials_unlit', 'KHR_texture_transform'].includes(extension))
          throw new Error('This model extension is unsupported.');
    pending.push(...Object.values(object));
  }
  if (optionalList(json.animations, 'animations').length || optionalList(json.skins, 'skins').length)
    throw new Error('Animated and skinned models are unsupported.');
  const nodes = optionalList(json.nodes, 'nodes');
  if (nodes.length > ASSET_LIMITS.nodes) throw new Error('Model exceeds the supported node limit.');
  for (const value of nodes) {
    const node = record(value, 'node');
    if (node.skin !== undefined || node.weights !== undefined)
      throw new Error('Skinned and morph-target models are unsupported.');
  }
  for (const value of optionalList(json.meshes, 'meshes')) {
    const mesh = record(value, 'mesh');
    for (const raw of optionalList(mesh.primitives, 'primitives')) {
      const primitive = record(raw, 'primitive');
      if ((primitive.mode ?? 4) !== 4 || primitive.targets !== undefined)
        throw new Error('Only static triangle models are supported.');
    }
  }
  let decodedBytes = 0;
  for (const [index, raw] of optionalList(json.buffers, 'buffers').entries()) {
    const buffer = record(raw, 'buffer');
    if (buffer.uri !== undefined) {
      embeddedUri(buffer.uri, 'Buffer', false);
      decodedBytes += Math.floor((String(buffer.uri).split(',')[1].length * 3) / 4);
    } else if (!binary || !hasBinaryChunk || index !== 0) throw new Error('Model buffer is not embedded.');
    if (decodedBytes > ASSET_LIMITS.modelBytes)
      throw new Error('Decoded model buffers exceed the supported limit.');
  }
  const images = optionalList(json.images, 'images');
  if (
    images.length > ASSET_LIMITS.textures ||
    optionalList(json.textures, 'textures').length > ASSET_LIMITS.textures
  )
    throw new Error('Model exceeds the supported texture limit.');
  for (const raw of images) {
    const image = record(raw, 'image');
    if (image.uri !== undefined) embeddedUri(image.uri, 'Texture', true);
    else if (!Number.isSafeInteger(image.bufferView)) throw new Error('Model texture is not embedded.');
  }
  return json;
}

/** Uses actual indexed geometry, including hierarchy transforms and repeated mesh instances. */
export function measureRenderedModel(root: Object3D): RenderedModelMeasurement {
  root.updateMatrixWorld(true);
  const box = new Box3();
  const point = new Vector3();
  let triangles = 0;
  let vertices = 0;
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    if ('isSkinnedMesh' in node || Object.keys(node.geometry.morphAttributes).length)
      throw new Error('Animated geometry is unsupported.');
    const position = node.geometry.getAttribute('position');
    const indices = node.geometry.index;
    if (!position || position.itemSize !== 3) throw new Error('Model position geometry is invalid.');
    const count = indices?.count ?? position.count;
    if (count % 3) throw new Error('Model geometry must use triangles.');
    triangles += count / 3;
    vertices += position.count;
    if (triangles > ASSET_LIMITS.triangles || vertices > ASSET_LIMITS.vertices)
      throw new Error('Model exceeds rendered geometry limits.');
    for (let reference = 0; reference < count; reference++) {
      const index = indices ? indices.getX(reference) : reference;
      if (!Number.isSafeInteger(index) || index < 0 || index >= position.count)
        throw new Error('Model index is outside its geometry.');
      point.fromBufferAttribute(position, index).applyMatrix4(node.matrixWorld);
      if (![point.x, point.y, point.z].every((part) => Number.isFinite(part) && Math.abs(part) <= 1000))
        throw new Error('Model geometry is outside supported metre bounds.');
      box.expandByPoint(point);
    }
  });
  const dimensions = {
    width: box.max.x - box.min.x,
    depth: box.max.z - box.min.z,
    height: box.max.y - box.min.y,
  };
  if (!triangles || !Object.values(dimensions).every((part) => Number.isFinite(part) && part > 0))
    throw new Error('Model has no measurable static volume.');
  return {
    dimensions,
    bounds: { min: box.min.toArray(), max: box.max.toArray() },
    triangles,
    vertices,
  };
}

export function disposeRoomModel(root: Object3D) {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    }
  });
  for (const texture of textures) {
    texture.dispose();
    const image: unknown = texture.source.data;
    if (image && typeof image === 'object' && 'close' in image && typeof image.close === 'function')
      image.close();
  }
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

function selectedAssetPath(url: string | undefined, projectId: string, assetId: string): string {
  const expected = `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`;
  if (url !== expected) throw new Error('Only this project’s authenticated model assets can be rendered.');
  return expected;
}
async function fetchModelBytes(path: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(path, {
    signal,
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
  });
  if (!response.ok)
    throw new Error(
      response.status === 401 || response.status === 403
        ? 'Model access is no longer available.'
        : 'This model could not be loaded.',
    );
  const length = response.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > ASSET_LIMITS.modelBytes))
    throw new Error('Model exceeds the supported byte limit.');
  if (!response.body) throw new Error('Model response is empty.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > ASSET_LIMITS.modelBytes) {
        await reader.cancel();
        throw new Error('Model exceeds the supported byte limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes.buffer;
}

/** No shared global cache: asset lifetimes belong to one authorised viewer and project. */
export async function loadRoomModel(
  projectId: string,
  asset: ProjectCatalogueAsset,
  expected: SceneObject['dimensions'],
  signal: AbortSignal,
): Promise<LoadedRoomModel> {
  const path = selectedAssetPath(asset.url, projectId, asset.id);
  const bytes = await fetchModelBytes(path, signal);
  inspectSelfContainedModel(bytes);
  const manager = new LoadingManager();
  manager.setURLModifier((url) => {
    if (
      /^data:(?:application\/(?:octet-stream|gltf-buffer)|image\/(?:png|jpeg|webp));base64,[A-Za-z0-9+/]*={0,2}$/.test(
        url,
      ) ||
      /^blob:/.test(url)
    )
      return url;
    throw new Error('External model resources are blocked.');
  });
  const abortParsing = () => manager.abort();
  signal.addEventListener('abort', abortParsing, { once: true });
  let gltf;
  try {
    if (signal.aborted) throw new DOMException('Model load was superseded.', 'AbortError');
    gltf = await new GLTFLoader(manager).parseAsync(bytes, '');
  } finally {
    signal.removeEventListener('abort', abortParsing);
  }
  try {
    if (signal.aborted) throw new DOMException('Model load was superseded.', 'AbortError');
    const measured = measureRenderedModel(gltf.scene);
    if (!dimensionsWithinModelTolerance(measured.dimensions, expected))
      throw new Error(
        'Decoded model dimensions differ from the saved furniture. A dimension proxy is shown.',
      );
    // Recheck the decoder against the validation record; do not silently change orientation or scale.
    const validationBounds = record(asset.validation.bounds, 'validation bounds');
    const recorded = [validationBounds.min, validationBounds.max];
    const decoded = [measured.bounds.min, measured.bounds.max];
    for (let side = 0; side < 2; side++) {
      const coordinates = recorded[side];
      if (
        !Array.isArray(coordinates) ||
        coordinates.length !== 3 ||
        !coordinates.every(
          (value, axis) =>
            typeof value === 'number' &&
            Number.isFinite(value) &&
            Math.abs(value - decoded[side][axis]) <= 0.001,
        )
      )
        throw new Error('Decoded model bounds differ from the validated asset. A dimension proxy is shown.');
    }
    gltf.scene.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      if (!node.geometry.getAttribute('normal')) node.geometry.computeVertexNormals();
    });
    const textures = new Set<Texture>();
    gltf.scene.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material])
        for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    });
    let texturePixels = 0;
    if (textures.size > ASSET_LIMITS.textures)
      throw new Error('Decoded textures exceed the supported limit.');
    for (const texture of textures) {
      const image = texture.source.data as { width?: unknown; height?: unknown } | undefined;
      const width = image?.width;
      const height = image?.height;
      if (
        typeof width !== 'number' ||
        typeof height !== 'number' ||
        !Number.isSafeInteger(width) ||
        !Number.isSafeInteger(height) ||
        width <= 0 ||
        height <= 0 ||
        width > ASSET_LIMITS.textureSide ||
        height > ASSET_LIMITS.textureSide
      )
        throw new Error('Decoded texture dimensions exceed the supported limit.');
      texturePixels += width * height;
      if (texturePixels > ASSET_LIMITS.texturePixels)
        throw new Error('Decoded texture pixels exceed the supported limit.');
    }
    return { scene: gltf.scene, ...measured, originOffset: modelFloorCentreOffset(measured.bounds) };
  } catch (error) {
    disposeRoomModel(gltf.scene);
    throw error;
  }
}
