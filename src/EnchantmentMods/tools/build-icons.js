// Draws the status effect icons into EnchantmentMods_RP/font/glyph_E5.png: a 256x256 glyph page of
// 16x16 cells, so cell n is the character U+E500 + n. scripts/status.js uses these characters.
//   U+E500  Sticking – a small honey block with a drip
//   U+E501  Target   – a target: red rings with gaps and a dot in the middle, no white
// Run: node src/EnchantmentMods/tools/build-icons.js [preview.png]   (optional 8x preview of the icons)

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const CELL = 16;
const SIZE = 256;

function encodePng({ width, height, data }) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type, "ascii"), body]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(tb));
    return Buffer.concat([len, tb, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) data.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];

// Honey block, about two thirds of the cell, with a drip hanging off the bottom.
const HONEY_PALETTE = { O: hex("#8f520b"), L: hex("#ffd56e"), Y: hex("#f5a623"), D: hex("#d4800f") };
const HONEY = [
  "................",
  "................",
  "...OOOOOOOOOO...",
  "...OLLLLLLLLO...",
  "...OLYYYYYYDO...",
  "...OLYDDDDYDO...",
  "...OLYDLLDYDO...",
  "...OLYDLLDYDO...",
  "...OLYDDDDYDO...",
  "...OLYYYYYYDO...",
  "...ODDDDDDDDO...",
  "...OOOOOOYDOO...",
  ".........OYDO...",
  ".........OYDO...",
  "..........OO....",
  "................",
];

function drawRows(data, cell, rows, palette) {
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const color = palette[ch];
      if (color) setPixel(data, cell, x, y, color);
    });
  });
}

// Target: two rings and a dot, measured from the cell's center so they come out round.
function drawTarget(data, cell) {
  const red = hex("#d42a2a");
  const dark = hex("#8e1515");
  const rings = [
    [5.9, 7.4],
    [2.9, 4.3],
    [0, 1.45],
  ];
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const d = Math.hypot(x + 0.5 - CELL / 2, y + 0.5 - CELL / 2);
      for (const [inner, outer] of rings) {
        if (d < inner || d > outer) continue;
        // Shade the lower right edge of each ring for a little depth.
        const shade = d > outer - 0.9 && x + y > CELL - 1;
        setPixel(data, cell, x, y, shade ? dark : red);
      }
    }
  }
}

function setPixel(data, cell, x, y, [r, g, b, a]) {
  const px = (cell % (SIZE / CELL)) * CELL + x;
  const py = Math.floor(cell / (SIZE / CELL)) * CELL + y;
  const i = (py * SIZE + px) * 4;
  data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
}

const data = Buffer.alloc(SIZE * SIZE * 4);
drawRows(data, 0, HONEY, HONEY_PALETTE);
drawTarget(data, 1);

const out = path.join(__dirname, "..", "EnchantmentMods_RP", "font", "glyph_E5.png");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, encodePng({ width: SIZE, height: SIZE, data }));
console.log(`Wrote ${out}`);

// Optional: the two icons side by side, 8x, on a dark background, to look at.
if (process.argv[2]) {
  const scale = 8;
  const w = CELL * 2 * scale + 3 * scale;
  const h = CELL * scale + 2 * scale;
  const preview = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) preview.set([40, 40, 46, 255], i * 4);
  for (let cell = 0; cell < 2; cell++) {
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const src = (y * SIZE + cell * CELL + x) * 4;
        if (!data[src + 3]) continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const px = scale + cell * (CELL + 1) * scale + x * scale + dx;
            const py = scale + y * scale + dy;
            preview.set(data.subarray(src, src + 4), (py * w + px) * 4);
          }
        }
      }
    }
  }
  fs.writeFileSync(process.argv[2], encodePng({ width: w, height: h, data: preview }));
  console.log(`Wrote ${process.argv[2]}`);
}
