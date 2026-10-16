// Reproducible fictional model and calibrated synthetic-image test assets. No real supplier assets.
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { BoxGeometry, PerspectiveCamera, Vector3, Color } from 'three';
import sharp from 'sharp';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'fixtures/boreal-living');
const catalogue = JSON.parse(await readFile(path.join(fixture, 'catalogue.json'), 'utf8'));
await mkdir(path.join(fixture, 'models'), { recursive: true });
await mkdir(path.join(fixture, 'photo-demo'), { recursive: true });
function glb(product) {
  const geometry = new BoxGeometry(1, 1, 1);
  const arrays = [geometry.attributes.position.array, geometry.attributes.normal.array, geometry.index.array];
  const buffers = arrays.map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  let offset = 0;
  const views = buffers.map((b) => {
    const v = { buffer: 0, byteOffset: offset, byteLength: b.length };
    offset += Math.ceil(b.length / 4) * 4;
    return v;
  });
  const bin = Buffer.alloc(offset);
  buffers.forEach((b, i) => b.copy(bin, views[i].byteOffset));
  const { width: w, depth: d, height: h } = product.dimensions,
    nodes = [];
  const box = (name, x, y, z, a, b, c, material = 0) =>
    nodes.push({ name, mesh: material, translation: [x, y, z], scale: [a, b, c] });
  const leg = 0.055;
  if (product.category === 'bed') {
    box('Frame', 0, 0.22, 0, w, 0.24, d);
    box('Mattress', 0, 0.44, 0.04, w - 0.08, 0.2, d - 0.16, 1);
    box('Headboard', 0, h / 2, -d / 2 + 0.04, w, h, 0.08);
    box('Duvet', 0, 0.57, 0.24, w - 0.1, 0.06, d - 0.65, 2);
    for (const x of [-w / 4, w / 4]) box('Pillow', x, 0.58, -d / 2 + 0.34, w / 2 - 0.09, 0.08, 0.37, 1);
  } else if (product.category === 'wardrobe') {
    box('Cabinet', 0, h / 2, -0.0125, w, h, d - 0.025);
    for (const x of [-w / 4, w / 4])
      box('Door', x, h / 2, d / 2 - 0.0125, w / 2 - 0.008, h - 0.016, 0.025, 2);
    for (const x of [-0.035, 0.035]) box('Handle', x, h * 0.52, d / 2 - 0.006, 0.014, 0.16, 0.012, 3);
  } else if (product.category === 'rug') box('Woven rug', 0, h / 2, 0, w, h, d, 2);
  else {
    box('Top', 0, h - 0.025, 0, w, 0.05, d);
    for (const x of [-w / 2 + leg / 2, w / 2 - leg / 2])
      for (const z of [-d / 2 + leg / 2, d / 2 - leg / 2])
        box('Leg', x, (h - 0.05) / 2, z, leg, h - 0.05, leg, 3);
    if (product.category === 'bedside') {
      box('Body', 0, h * 0.57, 0, w - 0.05, h * 0.6, d - 0.04);
      box('Drawer', 0, h * 0.65, d / 2 - 0.013, w - 0.065, h * 0.27, 0.026, 2);
      box('Pull', 0, h * 0.65, d / 2 - 0.003, 0.09, 0.012, 0.006, 3);
    }
  }
  const wood = new Color(product.color),
    color = [wood.r, wood.g, wood.b, 1];
  const doc = {
    asset: { version: '2.0', generator: 'RoomSell fictional dimensioned fixtures' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    buffers: [{ byteLength: bin.length }],
    bufferViews: views,
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 24,
        type: 'VEC3',
        min: [-0.5, -0.5, -0.5],
        max: [0.5, 0.5, 0.5],
      },
      { bufferView: 1, componentType: 5126, count: 24, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: 36, type: 'SCALAR' },
    ],
    materials: [
      color,
      [0.91, 0.88, 0.8, 1],
      [Math.min(1, wood.r + 0.12), Math.min(1, wood.g + 0.12), Math.min(1, wood.b + 0.12), 1],
      [0.14, 0.13, 0.11, 1],
    ].map((baseColorFactor) => ({
      pbrMetallicRoughness: { baseColorFactor, metallicFactor: 0, roughnessFactor: 0.85 },
    })),
    meshes: [0, 1, 2, 3].map((material) => ({
      primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material }],
    })),
  };
  const json = Buffer.from(JSON.stringify(doc)),
    jsonPad = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
  json.copy(jsonPad);
  const out = Buffer.alloc(12 + 8 + jsonPad.length + 8 + bin.length);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(jsonPad.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonPad.copy(out, 20);
  const b = 20 + jsonPad.length;
  out.writeUInt32LE(bin.length, b);
  out.writeUInt32LE(0x004e4942, b + 4);
  bin.copy(out, b + 8);
  geometry.dispose();
  return out;
}
for (const product of catalogue.products)
  await writeFile(path.join(fixture, 'models', product.sku + '.glb'), glb(product));
const width = 1536,
  height = 1024,
  camera = new PerspectiveCamera(50, width / height, 0.01, 100);
camera.position.set(7, 2.5, 8);
camera.lookAt(3, 0.4, 2.5);
camera.updateMatrixWorld();
const project = ([x, y, z]) => {
  const v = new Vector3(x, y, z).project(camera);
  return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
};
const polygon = (points, fill, stroke = '#c5baac') =>
  `<polygon points="${points
    .map((p) => {
      const v = project(p);
      return `${v.x * width},${v.y * height}`;
    })
    .join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
let room = `<rect width="1536" height="1024" fill="#f1eee7"/>`;
room += polygon(
  [
    [0, 0, 0],
    [6, 0, 0],
    [6, 2.7, 0],
    [0, 2.7, 0],
  ],
  '#e4ddd1',
);
room += polygon(
  [
    [0, 0, 0],
    [0, 0, 5],
    [0, 2.7, 5],
    [0, 2.7, 0],
  ],
  '#d6cfc3',
);
room += polygon(
  [
    [0, 0, 0],
    [6, 0, 0],
    [6, 0, 5],
    [0, 0, 5],
  ],
  '#cbb294',
);
for (let x = 0; x <= 6; x++) {
  const a = project([x, 0, 0]),
    b = project([x, 0, 5]);
  room += `<path d="M${a.x * width} ${a.y * height}L${b.x * width} ${b.y * height}" stroke="#ab9479" fill="none"/>`;
}
for (let z = 0; z <= 5; z++) {
  const a = project([0, 0, z]),
    b = project([6, 0, z]);
  room += `<path d="M${a.x * width} ${a.y * height}L${b.x * width} ${b.y * height}" stroke="#ab9479" fill="none"/>`;
}
const corners = [
  [1, 0, 1],
  [4, 0, 1],
  [4, 0, 3],
  [1, 0, 3],
].map(project);
const labels = corners
  .map(
    (p, i) =>
      `<circle cx="${p.x * width}" cy="${p.y * height}" r="10" fill="#e4ad29" stroke="white"/><text x="${p.x * width + 14}" y="${p.y * height - 12}" font-family="sans-serif" font-size="22" fill="#243a30">${i + 1}</text>`,
  )
  .join('');
const header = `<rect x="20" y="20" width="865" height="75" rx="8" fill="#f9faf4"/><text x="38" y="50" font-family="sans-serif" font-size="24" fill="#243a30">BOREAL LIVING · SYNTHETIC MEASUREMENT DEMO</text><text x="38" y="78" font-family="sans-serif" font-size="18" fill="#526455">Known camera · 6 × 5 m room · marked floor rectangle 3 × 2 m</text>`;
let object = '';
const box = [
  [0.8, 0, 2.6],
  [1.6, 0, 2.6],
  [1.6, 0, 3.2],
  [0.8, 0, 3.2],
  [0.8, 0.7, 2.6],
  [1.6, 0.7, 2.6],
  [1.6, 0.7, 3.2],
  [0.8, 0.7, 3.2],
];
object += polygon([box[0], box[1], box[5], box[4]], '#7b5042');
object += polygon([box[1], box[2], box[6], box[5]], '#986751');
object += polygon([box[3], box[2], box[6], box[7]], '#aa755f');
object += polygon([box[4], box[5], box[6], box[7]], '#bd917a');
const svg = (body) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024">${body}</svg>`);
await writeFile(
  path.join(fixture, 'photo-demo', 'empty.png'),
  await sharp(svg(room + labels + header))
    .png()
    .toBuffer(),
);
await writeFile(
  path.join(fixture, 'photo-demo', 'room.png'),
  await sharp(svg(room + object + labels + header))
    .png()
    .toBuffer(),
);
const points = box.map(project),
  x = Math.max(0, Math.min(...points.map((p) => p.x)) - 0.007),
  y = Math.max(0, Math.min(...points.map((p) => p.y)) - 0.007);
await writeFile(
  path.join(fixture, 'photo-demo', 'analysis.json'),
  JSON.stringify(
    {
      summary: 'Recorded synthetic fixture selection: one existing chest. This is not live AI analysis.',
      objects: [
        {
          label: 'Synthetic existing chest',
          bounds: {
            x,
            y,
            width: Math.min(1 - x, Math.max(...points.map((p) => p.x)) - x + 0.007),
            height: Math.min(1 - y, Math.max(...points.map((p) => p.y)) - y + 0.007),
          },
        },
      ],
    },
    null,
    2,
  ) + '\n',
);
await writeFile(
  path.join(fixture, 'photo-demo', 'calibration.json'),
  JSON.stringify(
    {
      version: 1,
      imageWidth: width,
      imageHeight: height,
      roomWidth: 6,
      roomDepth: 5,
      floor: { x: 1, z: 1, width: 3, depth: 2 },
      points: corners,
    },
    null,
    2,
  ) + '\n',
);
process.stdout.write('Built seven fictional dimensioned models and the calibrated synthetic room fixture.\n');
