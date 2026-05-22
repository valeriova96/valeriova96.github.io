// Generates the favicon set from a single SVG source.
// Run: node scripts/build-favicon.mjs
// Outputs: public/favicon.svg, favicon-16.png, favicon-32.png, apple-touch-icon.png, favicon.ico
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = (f) => resolve(__dirname, '..', 'public', f);

function oklchToHex(L, C, H) {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const r =  4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  const hex = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return '#' + hex(toSrgb(r)) + hex(toSrgb(g)) + hex(toSrgb(bl));
}

const PAPER = oklchToHex(0.965, 0.012, 80);
const INK = oklchToHex(0.22, 0.015, 65);
const TERRACOTTA = oklchToHex(0.5, 0.15, 33);

console.log('Colors  paper=%s  ink=%s  terracotta=%s', PAPER, INK, TERRACOTTA);

// 32x32 viewBox. V is a single thick stroke; terracotta period sits to its right.
// Stroke width 5 means ~2.5px stroke at 16px display - readable in a browser tab.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="${PAPER}"/>
  <path d="M 4 9 L 12 25 L 20 9" fill="none" stroke="${INK}" stroke-width="5" stroke-linejoin="miter" stroke-linecap="butt"/>
  <circle cx="25" cy="23" r="2.5" fill="${TERRACOTTA}"/>
</svg>
`;

await writeFile(out('favicon.svg'), svg);

const svgBuf = Buffer.from(svg);

async function rasterize(size) {
  return sharp(svgBuf, { density: Math.round((size / 32) * 96) })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const png16 = await rasterize(16);
const png32 = await rasterize(32);
const png180 = await rasterize(180);

await writeFile(out('favicon-32.png'), png32);
await writeFile(out('apple-touch-icon.png'), png180);

// Assemble favicon.ico with embedded PNGs (16x16 + 32x32).
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const dirSize = 16 * images.length;
  let offset = 6 + dirSize;
  const dir = Buffer.alloc(dirSize);
  images.forEach((img, i) => {
    const base = i * 16;
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, base + 0);
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, base + 1);
    dir.writeUInt8(0, base + 2);
    dir.writeUInt8(0, base + 3);
    dir.writeUInt16LE(1, base + 4);
    dir.writeUInt16LE(32, base + 6);
    dir.writeUInt32LE(img.data.length, base + 8);
    dir.writeUInt32LE(offset, base + 12);
    offset += img.data.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.data)]);
}

const ico = buildIco([
  { size: 16, data: png16 },
  { size: 32, data: png32 },
]);

await writeFile(out('favicon.ico'), ico);

console.log('Wrote favicon.svg, favicon-32.png, apple-touch-icon.png, favicon.ico');
