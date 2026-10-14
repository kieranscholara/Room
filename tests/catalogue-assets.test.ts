import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { ASSET_LIMITS, validateProductAsset } from '@roomsell/catalogue/assets';

const dimensions = { width: 2, depth: 2.1, height: 0.8 };
const options = { fileName: 'retailer.glb', expectedDimensions: dimensions };
function boxModel(size = dimensions) {
  const vertices = [
    0,
    0,
    0,
    size.width,
    0,
    0,
    size.width,
    size.height,
    0,
    0,
    size.height,
    0,
    0,
    0,
    size.depth,
    size.width,
    0,
    size.depth,
    size.width,
    size.height,
    size.depth,
    0,
    size.height,
    size.depth,
  ];
  const indices = [
    0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 1, 5, 6, 1, 6, 2, 0, 3, 7, 0, 7,
    4,
  ];
  const buffer = Buffer.alloc(vertices.length * 4 + indices.length * 2);
  vertices.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  indices.forEach((value, index) => buffer.writeUInt16LE(value, vertices.length * 4 + index * 2));
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [
      { byteLength: buffer.length, uri: `data:application/octet-stream;base64,${buffer.toString('base64')}` },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: vertices.length * 4, target: 34962 },
      { buffer: 0, byteOffset: vertices.length * 4, byteLength: indices.length * 2, target: 34963 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 8,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [size.width, size.height, size.depth],
      },
      { bufferView: 1, componentType: 5123, count: indices.length, type: 'SCALAR' },
    ],
  };
  return { json, buffer };
}
function glb(model: ReturnType<typeof boxModel>) {
  const source = { ...model.json, buffers: [{ byteLength: model.buffer.length }] };
  const raw = Buffer.from(JSON.stringify(source));
  const json = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 32);
  raw.copy(json);
  const bin = Buffer.alloc(Math.ceil(model.buffer.length / 4) * 4);
  model.buffer.copy(bin);
  const output = Buffer.alloc(12 + 8 + json.length + 8 + bin.length);
  output.writeUInt32LE(0x46546c67, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(json.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  json.copy(output, 20);
  output.writeUInt32LE(bin.length, 20 + json.length);
  output.writeUInt32LE(0x004e4942, 24 + json.length);
  bin.copy(output, 28 + json.length);
  return output;
}
const gltf = (json: unknown) => Buffer.from(JSON.stringify(json));

describe('private catalogue image validation', () => {
  it('fully decodes valid PNG, JPEG and WebP bytes independently of uploaded MIME or filename', async () => {
    for (const format of ['png', 'jpeg', 'webp'] as const) {
      const bytes = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#123456' } })
        .toFormat(format)
        .toBuffer();
      const result = await validateProductAsset(bytes, { fileName: 'untrusted.exe' });
      expect(result).toMatchObject({
        kind: 'image',
        mimeType: `image/${format}`,
        validation: { width: 4, height: 3 },
      });
    }
  });
  it('rejects empty, forged and truncated images', async () => {
    await expect(validateProductAsset(Buffer.alloc(0), { fileName: 'fake.png' })).rejects.toThrow('empty');
    await expect(validateProductAsset(Buffer.from('<svg/>'), { fileName: 'fake.png' })).rejects.toThrow(
      'supported',
    );
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#aabbcc' } })
      .png()
      .toBuffer();
    await expect(
      validateProductAsset(png.subarray(0, png.length - 25), { fileName: 'truncated.png' }),
    ).rejects.toThrow('corrupt');
  });
  it('enforces image byte and decoded dimension limits', async () => {
    const large = Buffer.alloc(ASSET_LIMITS.imageBytes + 1);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(large);
    await expect(validateProductAsset(large, { fileName: 'large.png' })).rejects.toThrow('10 MiB');
    const wide = await sharp({ create: { width: 8193, height: 1, channels: 3, background: '#123456' } })
      .png()
      .toBuffer();
    await expect(validateProductAsset(wide, { fileName: 'wide.png' })).rejects.toThrow('8192px');
  });
});

describe('static retailer model geometry and performance validation', () => {
  it('validates GLB v2 and self-contained glTF, calculating actual triangle bounds in metres', async () => {
    const model = boxModel();
    const binary = await validateProductAsset(glb(model), options);
    expect(binary).toMatchObject({
      kind: 'model',
      mimeType: 'model/gltf-binary',
      dimensions: { width: 2, height: expect.closeTo(0.8), depth: expect.closeTo(2.1) },
      validation: { triangles: 12, vertices: 8, units: 'metres' },
    });
    const json = await validateProductAsset(gltf(model.json), { ...options, fileName: 'retailer.gltf' });
    expect(json.mimeType).toBe('model/gltf+json');
    expect(json.validation).toMatchObject({ axes: { width: 'x', depth: 'z', height: 'y' } });
  });
  it('rejects models without authoritative dimensions and metre/orientation mismatches', async () => {
    await expect(validateProductAsset(glb(boxModel()), { fileName: 'retailer.glb' })).rejects.toThrow(
      'authoritative',
    );
    await expect(
      validateProductAsset(glb(boxModel()), { ...options, expectedDimensions: { ...dimensions, width: 1 } }),
    ).rejects.toThrow('width');
    await expect(
      validateProductAsset(glb(boxModel()), { ...options, expectedDimensions: { ...dimensions, height: 3 } }),
    ).rejects.toThrow('height');
    // Two percent tolerance permits normal export precision, not arbitrary resizing.
    await expect(
      validateProductAsset(glb(boxModel()), {
        ...options,
        expectedDimensions: { ...dimensions, width: 2.02 },
      }),
    ).resolves.toHaveProperty('kind', 'model');
  });
  it('accounts for world transforms and mesh instances before checking dimensions', async () => {
    const model = boxModel({ width: 1, height: 0.4, depth: 1.05 });
    Object.assign(model.json.nodes[0], { scale: [2, 2, 2], translation: [0.5, 0, -0.5] });
    const result = await validateProductAsset(gltf(model.json), { ...options, fileName: 'scaled.gltf' });
    expect(result.dimensions?.width).toBe(2);
    expect(result.validation).toMatchObject({ bounds: { min: [0.5, 0, -0.5] } });
    const rotated = boxModel();
    Object.assign(rotated.json.nodes[0], { rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] });
    const rotationResult = await validateProductAsset(gltf(rotated.json), {
      fileName: 'rotated.gltf',
      expectedDimensions: { width: 2.1, depth: 2, height: 0.8 },
    });
    expect(rotationResult.dimensions?.depth).toBeCloseTo(2);
  });
  it('measures only rendered indexed vertices rather than trusting declared accessor bounds', async () => {
    const model = boxModel();
    const buffer = Buffer.alloc(model.buffer.length + 12);
    model.buffer.subarray(0, 96).copy(buffer);
    [100, 100, 100].forEach((value, axis) => buffer.writeFloatLE(value, 96 + axis * 4));
    model.buffer.subarray(96).copy(buffer, 108);
    model.json.buffers[0] = {
      byteLength: buffer.length,
      uri: `data:application/octet-stream;base64,${buffer.toString('base64')}`,
    };
    model.json.bufferViews[0].byteLength = 108;
    model.json.bufferViews[1].byteOffset = 108;
    model.json.accessors[0].count = 9;
    model.json.accessors[0].max = [100, 100, 100];
    const result = await validateProductAsset(gltf(model.json), { ...options, fileName: 'rendered.gltf' });
    expect(result.dimensions?.width).toBe(2);
  });
  it('rejects external buffers and textures without fetching resources', async () => {
    const externalBuffer = boxModel();
    externalBuffer.json.buffers[0].uri = 'https://example.test/file.bin';
    await expect(
      validateProductAsset(gltf(externalBuffer.json), { ...options, fileName: 'external.gltf' }),
    ).rejects.toThrow('external');
    const externalTexture = boxModel();
    Object.assign(externalTexture.json, { images: [{ uri: 'https://example.test/photo.png' }] });
    await expect(
      validateProductAsset(gltf(externalTexture.json), { ...options, fileName: 'texture.gltf' }),
    ).rejects.toThrow('external');
  });
  it('rejects unsupported compression, animated geometry and nontriangle primitives', async () => {
    const compressed = boxModel();
    Object.assign(compressed.json, { extensionsUsed: ['KHR_draco_mesh_compression'] });
    await expect(
      validateProductAsset(gltf(compressed.json), { ...options, fileName: 'compressed.gltf' }),
    ).rejects.toThrow('Unsupported');
    const animated = boxModel();
    Object.assign(animated.json, { animations: [{}] });
    await expect(
      validateProductAsset(gltf(animated.json), { ...options, fileName: 'animated.gltf' }),
    ).rejects.toThrow('Animated');
    const lines = boxModel();
    Object.assign(lines.json.meshes[0].primitives[0], { mode: 1 });
    await expect(
      validateProductAsset(gltf(lines.json), { ...options, fileName: 'lines.gltf' }),
    ).rejects.toThrow('triangle');
  });
  it('enforces model size, node count and embedded texture decoding limits', async () => {
    await expect(
      validateProductAsset(Buffer.alloc(ASSET_LIMITS.modelBytes + 1), { ...options, fileName: 'large.gltf' }),
    ).rejects.toThrow('50 MiB');
    const huge = boxModel();
    huge.json.nodes = Array.from({ length: 1001 }, () => ({ mesh: 0 }));
    await expect(
      validateProductAsset(gltf(huge.json), { ...options, fileName: 'nodes.gltf' }),
    ).rejects.toThrow('1000-node');
    const corrupt = boxModel();
    Object.assign(corrupt.json, { images: [{ uri: 'data:image/png;base64,AAAA' }] });
    await expect(
      validateProductAsset(gltf(corrupt.json), { ...options, fileName: 'corrupt.gltf' }),
    ).rejects.toThrow('images');
  });
  it('counts repeated mesh instances towards rendered triangle limits', async () => {
    const repeated = boxModel();
    repeated.json.nodes = Array.from({ length: 1000 }, () => ({ mesh: 0 }));
    repeated.json.scenes[0].nodes = Array.from({ length: 1000 }, (_, index) => index);
    repeated.json.meshes[0].primitives = Array.from({ length: 17 }, () => ({
      attributes: { POSITION: 0 },
      indices: 1,
    }));
    await expect(
      validateProductAsset(gltf(repeated.json), { ...options, fileName: 'repeated.gltf' }),
    ).rejects.toThrow('200000-triangle');
  });
  it('rejects malformed GLB lengths and out-of-range geometry indices', async () => {
    const badLength = glb(boxModel());
    badLength.writeUInt32LE(badLength.length - 4, 8);
    await expect(validateProductAsset(badLength, options)).rejects.toThrow('header');
    const model = boxModel();
    model.buffer.writeUInt16LE(9, 96);
    model.json.buffers[0].uri = `data:application/octet-stream;base64,${model.buffer.toString('base64')}`;
    await expect(
      validateProductAsset(gltf(model.json), { ...options, fileName: 'index.gltf' }),
    ).rejects.toThrow(/structural|outside/);
  });
});
