// Draws Building Tool's textures into BuildingTool_RP/textures and the site icon:
//   textures/items/*.png                       – 16x16 item icons (wrench, delete, rotate, copy, paste, undo, hat)
//   textures/entity/buildtool_selection.png    – the light, see-through green of a selected area
//   textures/models/armor/builders_hat.png     – the worn hard hat (64x32, box UV of the hat model)
//   ../../icons/building-tool.svg              – the wrench, for the download site
// Run: node src/BuildingTool/tools/build-textures.js [preview.png]   (optional 8x preview of the icons)

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const RP = path.join(__dirname, "..", "BuildingTool_RP");

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

const hex = (h, a = 255) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a];

// A 16x16 icon is a list of 16 strings; each character is a palette key, "." is transparent.
function fromRows(rows, palette) {
  const img = { width: 16, height: 16, data: Buffer.alloc(16 * 16 * 4) };
  rows.forEach((row, y) => {
    if (row.length !== 16) throw new Error(`row ${y} is ${row.length} wide: ${row}`);
    [...row].forEach((ch, x) => {
      if (ch === ".") return;
      const c = palette[ch];
      if (!c) throw new Error(`no colour for ${ch}`);
      img.data.set(c, (y * 16 + x) * 4);
    });
  });
  return img;
}

const WRENCH = fromRows([
  "................",
  "..........OOO...",
  ".........OLLMO..",
  ".........OLMDO..",
  "..........OMDO.O",
  "...........OMOOL",
  "..........OLMMDO",
  ".........OLMDDO.",
  "........OLMDOO..",
  ".......OLMDO....",
  "......OLMDO.....",
  ".....OLMDO......",
  "....OLMDO.......",
  "...OLMDO........",
  "...OMDO.........",
  "....OO..........",
], { O: hex("#2e3338"), L: hex("#e4e9ee"), M: hex("#a7b0b9"), D: hex("#6b747d") });

const DELETE = fromRows([
  "................",
  "......OOOO......",
  "......O..O......",
  "..OOOOOOOOOOOO..",
  "..OLLRRRRRRRDO..",
  "..OOOOOOOOOOOO..",
  "...OLRrRRrRDO...",
  "...OLRrRRrRDO...",
  "...OLRrRRrRDO...",
  "...OLRrRRrRDO...",
  "...OLRrRRrRDO...",
  "...OLRrRRrRDO...",
  "...OLRrRRrRDO...",
  "...ODDDDDDDDO...",
  "....OOOOOOOO....",
  "................",
], { O: hex("#4a0c0c"), L: hex("#ff7b72"), R: hex("#e03131"), r: hex("#a51d1d"), D: hex("#8a1616") });

// Circle arrows are drawn: a ring with a gap at the top right and an arrowhead at the top end pointing
// into the gap (↻). Rotate Left is the same picture mirrored (↺).
function circleArrow() {
  const img = { width: 16, height: 16, data: Buffer.alloc(16 * 16 * 4) };
  const fill = new Set();
  const cx = 7.5, cy = 8.5;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x - cx, dy = y - cy;
      const r = Math.hypot(dx, dy);
      // Angle clockwise from 12 o'clock, in degrees.
      const a = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
      if (r >= 3.6 && r <= 5.7 && !(a > 2 && a < 95)) fill.add(`${x},${y}`);
    }
  }
  // Arrowhead pointing right, centred on the ring's top.
  const head = [[8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 6], [9, 2], [9, 3], [9, 4], [9, 5], [10, 3], [10, 4]];
  for (const [x, y] of head) fill.add(`${x},${y}`);
  const body = hex("#5ec8ff"), shade = hex("#2a8fd6"), outline = hex("#0d2f4a");
  for (const key of fill) {
    const [x, y] = key.split(",").map(Number);
    const r = Math.hypot(x - cx, y - cy);
    const shaded = r > 4.9 && !head.some(([hx, hy]) => hx === x && hy === y);
    img.data.set(shaded ? shade : body, (y * 16 + x) * 4);
  }
  outlineAround(img, fill, outline);
  return img;
}

function outlineAround(img, fill, colour) {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (fill.has(`${x},${y}`)) continue;
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => fill.has(`${x + dx},${y + dy}`));
      if (near) img.data.set(colour, (y * 16 + x) * 4);
    }
  }
}

function mirror(img) {
  const out = { width: 16, height: 16, data: Buffer.alloc(16 * 16 * 4) };
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) img.data.copy(out.data, (y * 16 + 15 - x) * 4, (y * 16 + x) * 4, (y * 16 + x + 1) * 4);
  return out;
}

const ROTATE_RIGHT = circleArrow();
const ROTATE_LEFT = mirror(ROTATE_RIGHT);

const COPY = fromRows([
  "................",
  ".OOOOOOOO.......",
  ".OGGGGGGO.......",
  ".OGggggGO.......",
  ".OGGGGOOOOOOOO..",
  ".OGgggOWWWWWWO..",
  ".OGGGGOWllllWO..",
  ".OGgggOWWWWWWO..",
  ".OGGGGOWllllWO..",
  ".OGgggOWWWWWWO..",
  ".OGGGGOWlllWWO..",
  ".OOOOOOWWWWWWO..",
  "......OWllllWO..",
  "......OWWWWWWO..",
  "......OOOOOOOO..",
  "................",
], { O: hex("#3c4148"), G: hex("#b9c0c8"), g: hex("#8d959e"), W: hex("#f7f9fb"), l: hex("#b4bcc5") });

const PASTE = fromRows([
  "..*.........*...",
  ".......OO.......",
  "......ORRO....*.",
  ".....ORRRRO.....",
  "....ORRRRRRO....",
  "...ORRRRRRRRO...",
  "...OOOOOOOOOO...",
  "....OPPPPPPO....",
  "....OPwPPddO....",
  "....OPPPPddO....",
  "....OPPPPddO....",
  "..OOOOOOOOOOOO..",
  "..OgGgGGgGgGgO..",
  "..ODdDDdDDdDdO..",
  "..ODDdDDdDdDDO..",
  "..OOOOOOOOOOOO..",
], {
  O: hex("#2b1d12"), R: hex("#c0392b"), P: hex("#d8a868"), w: hex("#9fd8ff"), d: hex("#7a4a22"),
  G: hex("#5fb03a"), g: hex("#3f8a25"), D: hex("#8b5a33"), "*": hex("#fff3a0"),
});

const UNDO = fromRows([
  "................",
  "................",
  "................",
  ".....OO.........",
  "....OYO.........",
  "...OYYOOOOOOOO..",
  "..OYYYYYYYYYYYO.",
  ".OYLLLLLLLLLLYO.",
  ".OYYYYYYYYYYYYO.",
  "..OYYDDDDDDDDDO.",
  "...OYDOOOOOOOO..",
  "....ODO.........",
  ".....OO.........",
  "................",
  "................",
  "................",
], { O: hex("#5a3d00"), Y: hex("#ffd23a"), L: hex("#fff08a"), D: hex("#d99a00") });

const HAT = fromRows([
  "................",
  "................",
  "................",
  "......OOOO......",
  "....OOLYYYOO....",
  "...OLYYLYYYYO...",
  "...OLYYLYYYDO...",
  "..OLYYYLYYYYDO..",
  "..OYYYYLYYYYDO..",
  "..OYYYYLYYYDDO..",
  ".OOOOOOOOOOOOOO.",
  "OYYYYYYYYYYYYYDO",
  "ODDDDDDDDDDDDDDO",
  ".OOOOOOOOOOOOOO.",
  "................",
  "................",
], { O: hex("#4d3800"), Y: hex("#f5c518"), L: hex("#fff07a"), D: hex("#c99a05") });

// Light green, about half see-through. Each wall of the box shows from both sides, so from outside you
// look through two walls at open air and one at blocks inside the area.
function selection() {
  const img = { width: 16, height: 16, data: Buffer.alloc(16 * 16 * 4) };
  for (let i = 0; i < 256; i++) img.data.set([140, 255, 140, 115], i * 4);
  return img;
}

// Worn hat texture: the hat model uses box UV, so any spot it samples is hat yellow. A little speckle
// keeps it from looking flat, the brim's rows are a shade darker, and the ridge rows lighter.
function hatModel() {
  const w = 64, h = 32;
  const img = { width: w, height: h, data: Buffer.alloc(w * h * 4) };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const brim = y >= 14 && y < 27 && x < 46;
      const ridge = y >= 14 && x >= 46;
      let c = brim ? hex("#e0ae10") : ridge ? hex("#ffe066") : hex("#f5c518");
      if ((x * 7 + y * 13) % 11 === 0) c = c.map((v, i) => (i < 3 ? Math.max(0, v - 18) : v));
      img.data.set(c, (y * w + x) * 4);
    }
  }
  return img;
}

function write(rel, img) {
  const file = path.join(RP, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodePng(img));
}

const ICONS = {
  wrench: WRENCH, delete: DELETE, rotate_right: ROTATE_RIGHT, rotate_left: ROTATE_LEFT,
  copy: COPY, paste: PASTE, undo: UNDO, builders_hat: HAT,
};
for (const [name, img] of Object.entries(ICONS)) write(`textures/items/buildtool_${name}.png`, img);
write("textures/entity/buildtool_selection.png", selection());
write("textures/models/armor/builders_hat.png", hatModel());

// Site icon: the wrench as crisp SVG squares.
{
  const rects = [];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const o = (y * 16 + x) * 4;
      if (WRENCH.data[o + 3] === 0) continue;
      const c = "#" + [0, 1, 2].map((i) => WRENCH.data[o + i].toString(16).padStart(2, "0")).join("");
      rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 16 16" shape-rendering="crispEdges">${rects.join("")}</svg>\n`;
  fs.writeFileSync(path.join(__dirname, "..", "..", "..", "icons", "building-tool.svg"), svg);
}

// Optional preview: every icon at 8x on a mid-gray background, in one row.
const previewFile = process.argv[2];
if (previewFile) {
  const list = Object.values(ICONS);
  const S = 8, pad = 8, cell = 16 * S;
  const w = list.length * (cell + pad) + pad, h = cell + pad * 2;
  const img = { width: w, height: h, data: Buffer.alloc(w * h * 4) };
  for (let i = 0; i < w * h; i++) img.data.set([120, 120, 128, 255], i * 4);
  list.forEach((icon, n) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const o = (y * 16 + x) * 4;
      const a = icon.data[o + 3] / 255;
      if (!a) continue;
      for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) {
        const px = pad + n * (cell + pad) + x * S + dx, py = pad + y * S + dy;
        const p = (py * w + px) * 4;
        for (let c = 0; c < 3; c++) img.data[p + c] = Math.round(icon.data[o + c] * a + img.data[p + c] * (1 - a));
      }
    }
  });
  fs.writeFileSync(previewFile, encodePng(img));
}
