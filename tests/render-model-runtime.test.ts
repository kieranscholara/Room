import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Texture,
} from 'three';
import { createDemoScene } from '@roomsell/scene-core';
import { bounds, footprint, modelFloorCentreOffset, sceneObjectTransform } from '@roomsell/geometry';
import { ASSET_LIMITS, type ProjectCatalogueAsset } from '@roomsell/catalogue';
import {
  disposeRoomModel,
  inspectSelfContainedModel,
  loadRoomModel,
  measureRenderedModel,
} from '../apps/web/lib/3d-model-runtime';

const projectId = '11111111-1111-4111-8111-111111111111';
const assetId = '22222222-2222-4222-8222-222222222222';
const dimensions = { width: 2, height: 1, depth: 1.2 };
function boxDocument() {
  const geometry = new BoxGeometry(dimensions.width, dimensions.height, dimensions.depth);
  geometry.translate(dimensions.width / 2, dimensions.height / 2, dimensions.depth / 2);
  const position = geometry.getAttribute('position');
  const indices = geometry.index!;
  const buffer = Buffer.alloc(position.count * 12 + indices.count * 2);
  for (let index = 0; index < position.count; index++)
    [position.getX(index), position.getY(index), position.getZ(index)].forEach((value, axis) =>
      buffer.writeFloatLE(value, index * 12 + axis * 4),
    );
  for (let index = 0; index < indices.count; index++)
    buffer.writeUInt16LE(indices.getX(index), position.count * 12 + index * 2);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, translation: [4, -1, 8] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{ byteLength: buffer.length }],
    bufferViews: [
      { buffer: 0, byteLength: position.count * 12 },
      { buffer: 0, byteOffset: position.count * 12, byteLength: indices.count * 2 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        type: 'VEC3',
        count: position.count,
        min: [0, 0, 0],
        max: [dimensions.width, dimensions.height, dimensions.depth],
      },
      { bufferView: 1, componentType: 5123, type: 'SCALAR', count: indices.count },
    ],
  };
  geometry.dispose();
  return { json, buffer };
}
function binaryModel() {
  const { json, buffer } = boxDocument();
  const raw = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 32);
  raw.copy(padded);
  const bin = Buffer.alloc(Math.ceil(buffer.length / 4) * 4);
  buffer.copy(bin);
  const bytes = Buffer.alloc(28 + padded.length + bin.length);
  bytes.writeUInt32LE(0x46546c67, 0);
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(padded.length, 12);
  bytes.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(bytes, 20);
  bytes.writeUInt32LE(bin.length, 20 + padded.length);
  bytes.writeUInt32LE(0x004e4942, 24 + padded.length);
  bin.copy(bytes, 28 + padded.length);
  return Uint8Array.from(bytes).buffer;
}
const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).buffer;
function asset(): ProjectCatalogueAsset {
  return {
    id: assetId,
    productId: '33333333-3333-4333-8333-333333333333',
    variantId: null,
    kind: 'model',
    mimeType: 'model/gltf-binary',
    sizeBytes: binaryModel().byteLength,
    dimensions,
    validation: { units: 'metres', bounds: { min: [4, -1, 8], max: [6, 0, 9.2] } },
    url: `/api/projects/${projectId}/assets/${assetId}`,
    modelRenderable: true,
    proxyReason: null,
  };
}

afterEach(() => vi.unstubAllGlobals());
describe('actual Three.js rendering geometry', () => {
  it('projects asymmetric boxes to the exact canonical footprint for positive/negative and oblique yaw', () => {
    const object = structuredClone(createDemoScene().objects[1]);
    object.dimensions = dimensions;
    for (const yaw of [0, Math.PI / 2, -Math.PI / 2, 0.37, -2.1, 2 * Math.PI]) {
      object.transform = { x: 3.15, y: 0, z: 2.25, rotation: yaw };
      const transform = sceneObjectTransform(object);
      const root = new Group();
      root.position.fromArray(transform.position);
      root.rotation.y = transform.rotationY;
      const mesh = new Mesh(new BoxGeometry(dimensions.width, dimensions.height, dimensions.depth));
      mesh.position.y = dimensions.height / 2;
      root.add(mesh);
      root.updateMatrixWorld(true);
      const rendered = new Box3().setFromObject(root);
      const planar = bounds(footprint(object));
      expect(rendered.min.x).toBeCloseTo(planar.minX, 7);
      expect(rendered.max.x).toBeCloseTo(planar.maxX, 7);
      expect(rendered.min.z).toBeCloseTo(planar.minZ, 7);
      expect(rendered.max.z).toBeCloseTo(planar.maxZ, 7);
      expect(rendered.min.y).toBe(0);
      expect(rendered.max.y).toBe(dimensions.height);
      expect(transform.scale).toEqual([1, 1, 1]);
      disposeRoomModel(root);
    }
  });
  it('measures rendered indexed vertices rather than an unused outlier or accessor bounding box', () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([0, 0, 0, 2, 0, 0, 0, 1, 1.2, 100, 100, 100]), 3),
    );
    geometry.setIndex([0, 1, 2]);
    const root = new Group();
    const mesh = new Mesh(geometry);
    mesh.position.set(4, -1, 8);
    root.add(mesh);
    const result = measureRenderedModel(root);
    expect(result.bounds.min).toEqual([4, -1, 8]);
    expect(result.dimensions.width).toBe(2);
    expect(result.dimensions.height).toBe(1);
    expect(result.dimensions.depth).toBeCloseTo(1.2);
    expect(result.triangles).toBe(1);
    expect(new Box3().setFromObject(root).max.x).toBe(104);
    const offset = modelFloorCentreOffset(result.bounds);
    const pivot = new Group();
    pivot.position.fromArray(offset);
    pivot.add(root);
    const centred = measureRenderedModel(pivot);
    expect(centred.bounds.min[0]).toBe(-1);
    expect(centred.bounds.max[0]).toBe(1);
    expect(centred.bounds.min[1]).toBe(0);
    expect(centred.bounds.min[2]).toBeCloseTo(-0.6);
    disposeRoomModel(pivot);
  });
  it('counts repeated mesh instances and rejects invalid indices or nonfinite transformed coordinates', () => {
    const geometry = new BoxGeometry(1, 1, 1);
    const root = new Group();
    root.add(new Mesh(geometry), new Mesh(geometry));
    expect(measureRenderedModel(root).triangles).toBe(24);
    geometry.index!.setX(0, 9999);
    expect(() => measureRenderedModel(root)).toThrow('outside');
    geometry.index!.setX(0, 0);
    root.position.x = Infinity;
    expect(() => measureRenderedModel(root)).toThrow('metre bounds');
    disposeRoomModel(root);
  });
  it('disposes owned shared geometry, material, texture and decoded image once', () => {
    const image = { close: vi.fn() };
    const texture = new Texture(image);
    const material = new MeshStandardMaterial({ map: texture });
    const geometry = new BoxGeometry(1, 1, 1);
    const root = new Group();
    root.add(new Mesh(geometry, material), new Mesh(geometry, material));
    const geometryDispose = vi.spyOn(geometry, 'dispose');
    const materialDispose = vi.spyOn(material, 'dispose');
    const textureDispose = vi.spyOn(texture, 'dispose');
    disposeRoomModel(root);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).toHaveBeenCalledTimes(1);
    expect(image.close).toHaveBeenCalledTimes(1);
  });
});

describe('browser model asset boundary', () => {
  it('accepts embedded GLB and self-contained JSON, rejecting external buffers and textures', () => {
    expect(inspectSelfContainedModel(binaryModel()).asset).toEqual({ version: '2.0' });
    const { json, buffer } = boxDocument();
    Object.assign(json.buffers[0], {
      uri: `data:application/octet-stream;base64,${buffer.toString('base64')}`,
    });
    expect(inspectSelfContainedModel(jsonBytes(json)).asset).toEqual({ version: '2.0' });
    Object.assign(json.buffers[0], { uri: 'https://external.example.test/geometry.bin' });
    expect(() => inspectSelfContainedModel(jsonBytes(json))).toThrow('External');
    Object.assign(json.buffers[0], {
      uri: `data:application/octet-stream;base64,${buffer.toString('base64')}`,
    });
    Object.assign(json, { images: [{ uri: 'https://external.example.test/photo.png' }] });
    expect(() => inspectSelfContainedModel(jsonBytes(json))).toThrow('External');
  });
  it('rejects malformed GLB, animations, excessive nodes and undeclared nested compression extensions', () => {
    const broken = binaryModel();
    new DataView(broken).setUint32(8, 1, true);
    expect(() => inspectSelfContainedModel(broken)).toThrow('header');
    const { json } = boxDocument();
    Object.assign(json, { animations: [{}] });
    expect(() => inspectSelfContainedModel(jsonBytes(json))).toThrow('Animated');
    Object.assign(json, {
      animations: [],
      nodes: Array.from({ length: ASSET_LIMITS.nodes + 1 }, () => ({})),
    });
    expect(() => inspectSelfContainedModel(jsonBytes(json))).toThrow('node limit');
    Object.assign(json, { nodes: [{ mesh: 0 }] });
    Object.assign(json.meshes[0].primitives[0], { extensions: { KHR_draco_mesh_compression: {} } });
    expect(() => inspectSelfContainedModel(jsonBytes(json))).toThrow('extension');
  });
  it('decodes a real GLB through GLTFLoader and centres its actual mesh at the floor without scaling', async () => {
    const fetchMock = vi.fn(async () => new Response(binaryModel(), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const loaded = await loadRoomModel(projectId, asset(), dimensions, new AbortController().signal);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      asset().url,
      expect.objectContaining({ credentials: 'same-origin', redirect: 'error' }),
    );
    expect(loaded.dimensions.depth).toBeCloseTo(1.2);
    expect(loaded.originOffset).toEqual([expect.closeTo(-5), 1, expect.closeTo(-8.6)]);
    const floor = new Group();
    floor.position.fromArray(loaded.originOffset);
    floor.add(loaded.scene);
    expect(measureRenderedModel(floor).bounds.min[1]).toBe(0);
    expect(loaded.scene.scale.toArray()).toEqual([1, 1, 1]);
    disposeRoomModel(floor);
  });
  it('refuses an asset URL from another project before any request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      loadRoomModel(
        projectId,
        { ...asset(), url: `/api/projects/foreign/assets/${assetId}` },
        dimensions,
        new AbortController().signal,
      ),
    ).rejects.toThrow('authenticated');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects changed decoder dimensions or validation bounds instead of rescaling the mesh', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(binaryModel(), { status: 200 })),
    );
    await expect(
      loadRoomModel(projectId, asset(), { ...dimensions, width: 3 }, new AbortController().signal),
    ).rejects.toThrow('dimensions');
    const changed = { ...asset(), validation: { bounds: { min: [4, -1, 8], max: [6.01, 0, 9.2] } } };
    await expect(loadRoomModel(projectId, changed, dimensions, new AbortController().signal)).rejects.toThrow(
      'bounds',
    );
  });
  it('rejects unauthorised, oversized and aborted responses without exposing stale models', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('denied', { status: 403 })),
    );
    await expect(loadRoomModel(projectId, asset(), dimensions, new AbortController().signal)).rejects.toThrow(
      'access',
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(binaryModel(), { headers: { 'Content-Length': String(ASSET_LIMITS.modelBytes + 1) } }),
      ),
    );
    await expect(loadRoomModel(projectId, asset(), dimensions, new AbortController().signal)).rejects.toThrow(
      'byte limit',
    );
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        controller.abort();
        return new Response(binaryModel());
      }),
    );
    await expect(loadRoomModel(projectId, asset(), dimensions, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
  it('blocks hostile external-resource documents before GLTFLoader can request them', async () => {
    const { json } = boxDocument();
    Object.assign(json.buffers[0], { uri: 'https://external.example.test/geometry.bin' });
    const fetchMock = vi.fn(async () => new Response(jsonBytes(json)));
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadRoomModel(projectId, asset(), dimensions, new AbortController().signal)).rejects.toThrow(
      'External',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
