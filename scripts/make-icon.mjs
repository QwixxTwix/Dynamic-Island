// Генератор иконки Island: рисует знак (тёмный скруглённый квадрат + акцентная
// «пилюля») в RGBA, кодирует PNG вручную (zlib из Node) и собирает Windows .ico.
// Запуск: node scripts/make-icon.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256];

// Палитра — системные цвета Apple (тёмная тема): systemPurple и графит.
const ACCENT = [191, 90, 242]; // #bf5af2 — systemPurple, акцент темы по умолчанию
const ACCENT_DEEP = [124, 58, 237]; // #7c3aed — глубокий фиолетовый для градиента пилюли
const BG_TOP = [28, 28, 30]; // #1c1c1e — secondarySystemGroupedBackground
const BG_BOTTOM = [10, 10, 12]; // #0a0a0c
const WHITE = [255, 255, 255];

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Расстояние со знаком до скруглённого прямоугольника (нормированные координаты). */
function sdRoundRect(px, py, cx, cy, hw, hh, radius) {
  const qx = Math.abs(px - cx) - (hw - radius);
  const qy = Math.abs(py - cy) - (hh - radius);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - radius;
}

/** Цвет одного субпикселя: [r, g, b, alpha] в диапазоне 0…255 / 0…1. */
function shade(x, y, pixelStep) {
  const edge = (distance) => clamp01(0.5 - distance / pixelStep);

  let color = mix(BG_TOP, BG_BOTTOM, y);

  const glow = Math.pow(clamp01(1 - Math.hypot(x - 0.5, y + 0.08) / 0.95), 2) * 0.36;
  color = mix(color, ACCENT, glow);

  const dShape = sdRoundRect(x, y, 0.5, 0.5, 0.5, 0.5, 0.225);
  const alpha = edge(dShape);
  if (alpha <= 0) return [0, 0, 0, 0];

  const innerRing = Math.abs(dShape + 0.008) < 0.008 ? 0.14 : 0;
  color = mix(color, WHITE, innerRing * alpha);

  const dPill = sdRoundRect(x, y, 0.5, 0.46, 0.335, 0.104, 0.104);
  const pillHalo = Math.exp(-Math.max(dPill, 0) * 26) * 0.55;
  color = mix(color, ACCENT, pillHalo);

  const pillAlpha = edge(dPill);
  if (pillAlpha > 0) {
    const t = clamp01((x - 0.165) / 0.67);
    color = mix(color, mix(ACCENT, ACCENT_DEEP, t), pillAlpha);
  }

  const dotAlpha = edge(Math.hypot(x - 0.378, y - 0.46) - 0.028);
  if (dotAlpha > 0) color = mix(color, WHITE, dotAlpha * 0.95);

  const barAlpha = edge(sdRoundRect(x, y, 0.625, 0.46, 0.093, 0.019, 0.019));
  if (barAlpha > 0) color = mix(color, WHITE, barAlpha * 0.9);

  return [color[0], color[1], color[2], alpha];
}

/** Рендерит квадрат RGBA заданного размера с суперсэмплингом 4×4. */
function renderIcon(size) {
  const SS = 4;
  const total = size * SS;
  const step = 1 / total;
  const pixels = Buffer.alloc(size * size * 4);

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const x = (px * SS + sx + 0.5) * step;
          const y = (py * SS + sy + 0.5) * step;
          const [sr, sg, sb, sa] = shade(x, y, step);
          r += sr * sa;
          g += sg * sa;
          b += sb * sa;
          a += sa;
        }
      }

      const offset = (py * size + px) * 4;
      if (a > 0) {
        pixels[offset] = Math.round(r / a);
        pixels[offset + 1] = Math.round(g / a);
        pixels[offset + 2] = Math.round(b / a);
      }
      pixels[offset + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }

  return pixels;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** Кодирует RGBA-пиксели в PNG без внешних зависимостей. */
function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // бит на канал
  header[9] = 6; // RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // фильтр None
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Собирает .ico из 32-битных BMP-записей (совместимо с Vista…Windows 11). */
function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  const directories = [];
  const images = [];
  let offset = 6 + entries.length * 16;

  for (const { size, pixels } of entries) {
    const maskStride = Math.ceil(size / 32) * 4;
    const bitmap = Buffer.alloc(40);
    bitmap.writeUInt32LE(40, 0);
    bitmap.writeInt32LE(size, 4);
    bitmap.writeInt32LE(size * 2, 8); // XOR + AND маска
    bitmap.writeUInt16LE(1, 12);
    bitmap.writeUInt16LE(32, 14);
    bitmap.writeUInt32LE(0, 16);
    bitmap.writeUInt32LE(size * size * 4 + maskStride * size, 20);

    const xor = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      const sourceRow = (size - 1 - y) * size * 4;
      for (let x = 0; x < size; x += 1) {
        const source = sourceRow + x * 4;
        const target = (y * size + x) * 4;
        xor[target] = pixels[source + 2];
        xor[target + 1] = pixels[source + 1];
        xor[target + 2] = pixels[source];
        xor[target + 3] = pixels[source + 3];
      }
    }

    const mask = Buffer.alloc(maskStride * size);
    const image = Buffer.concat([bitmap, xor, mask]);

    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.length, 8);
    entry.writeUInt32LE(offset, 12);

    directories.push(entry);
    images.push(image);
    offset += image.length;
  }

  return Buffer.concat([header, ...directories, ...images]);
}

const rendered = ICON_SIZES.map((size) => ({ size, pixels: renderIcon(size) }));
const bySize = new Map(rendered.map((entry) => [entry.size, entry.pixels]));

mkdirSync("src-tauri/icons", { recursive: true });
mkdirSync("public", { recursive: true });

for (const size of [32, 128, 256]) {
  writeFileSync(`src-tauri/icons/${size}x${size}.png`, encodePng(size, bySize.get(size)));
}
writeFileSync("src-tauri/icons/128x128@2x.png", encodePng(256, bySize.get(256)));
writeFileSync("src-tauri/icons/icon.png", encodePng(256, bySize.get(256)));
writeFileSync("src-tauri/icons/icon.ico", encodeIco(rendered));
writeFileSync("public/icon.png", encodePng(256, bySize.get(256)));

process.stdout.write("icons: записаны PNG-набор, .ico и public/icon.png\n");
