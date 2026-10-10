// Builds the icon font sheet ArmorHUD_RP/font/glyph_E1.png and the matching
// ArmorHUD_BP/scripts/glyphs.js (icon name -> character).
// Run: node tools/build-glyphs.js <folder of vanilla textures>
// The folder holds files from Mojang's bedrock-samples resource_pack/textures/items and /ui.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const CELL = 16; // 256x256 sheet = 16x16 cells, character U+E100 + index
const LEATHER_TINT = [160, 101, 64];

// --- image decoding (8-bit PNG of any color type, and 24/32-bit TGA) ---

function decodePng(buf) {
  let pos = 8, width, height, bitDepth, colorType, palette, trns;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      if (data[12] !== 0) throw new Error("interlaced PNG not supported");
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bitsPerPixel = channels * bitDepth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel / 8);
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = v & 255;
    }
  }
  const out = Buffer.alloc(width * height * 4);
  const sample = (row, i) => {
    if (bitDepth === 8) return px[row * stride + i];
    if (bitDepth === 16) return px[row * stride + i * 2];
    const perByte = 8 / bitDepth, byte = px[row * stride + Math.floor(i / perByte)];
    const shift = 8 - bitDepth * ((i % perByte) + 1);
    return (byte >> shift) & ((1 << bitDepth) - 1);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (colorType === 3) {
        const idx = sample(y, x);
        out[o] = palette[idx * 3]; out[o + 1] = palette[idx * 3 + 1]; out[o + 2] = palette[idx * 3 + 2];
        out[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
      } else {
        const s = (k) => sample(y, x * channels + k);
        const scale = bitDepth < 8 ? 255 / ((1 << bitDepth) - 1) : 1;
        if (colorType === 0 || colorType === 4) {
          out[o] = out[o + 1] = out[o + 2] = s(0) * scale;
          out[o + 3] = colorType === 4 ? s(1) : 255;
        } else {
          out[o] = s(0); out[o + 1] = s(1); out[o + 2] = s(2);
          out[o + 3] = colorType === 6 ? s(3) : 255;
        }
      }
    }
  }
  return { width, height, data: out };
}

function decodeTga(buf) {
  const idLen = buf[0], type = buf[2], width = buf.readUInt16LE(12), height = buf.readUInt16LE(14);
  const bpp = buf[16] / 8, topDown = (buf[17] & 0x20) !== 0;
  if (type !== 2 && type !== 10) throw new Error("TGA type " + type + " not supported");
  let pos = 18 + idLen;
  const pixels = [];
  const readPixel = () => { const p = [buf[pos + 2], buf[pos + 1], buf[pos], bpp === 4 ? buf[pos + 3] : 255]; pos += bpp; return p; };
  while (pixels.length < width * height) {
    if (type === 2) { pixels.push(readPixel()); continue; }
    const header = buf[pos++], count = (header & 0x7f) + 1;
    if (header & 0x80) { const p = readPixel(); for (let i = 0; i < count; i++) pixels.push(p); }
    else for (let i = 0; i < count; i++) pixels.push(readPixel());
  }
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const row = Math.floor(i / width), col = i % width;
    const y = topDown ? row : height - 1 - row;
    out.set(pixels[i], (y * width + col) * 4);
  }
  return { width, height, data: out };
}

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

// --- icon list: name -> source file and tweaks ---

const ICONS = [];
const add = (name, file, opts = {}) => ICONS.push({ name, file, ...opts });

for (const piece of ["helmet", "chestplate", "leggings", "boots"]) {
  add(`leather_${piece}`, `leather_${piece}`, { tint: LEATHER_TINT });
  for (const m of ["chainmail", "iron", "gold", "diamond", "netherite", "copper"]) add(`${m}_${piece}`, `${m}_${piece}`);
  add(`empty_${piece}`, `empty_armor_slot_${piece}`, { alpha: 0.5 });
}
add("turtle_helmet", "turtle_helmet");
add("elytra", "elytra");
// Bedrock draws the shield icon from its 3D model, so cut the front face out of the model texture.
add("shield", "shield_entity", { region: { x: 1, y: 1, w: 12, h: 22 } });
add("empty_offhand", "empty_armor_slot_shield", { alpha: 0.5 });
for (const f of ["totem", "arrow", "fireworks", "map_filled", "nautilus"]) add(f, f);

const EFFECTS = [
  "speed", "slowness", "haste", "mining_fatigue", "strength", "jump_boost", "nausea", "regeneration",
  "resistance", "fire_resistance", "water_breathing", "invisibility", "blindness", "night_vision",
  "hunger", "weakness", "poison", "wither", "health_boost", "absorption", "levitation", "conduit_power",
  "slow_falling", "bad_omen", "village_hero", "darkness", "trial_omen", "raid_omen", "wind_charged",
  "weaving", "oozing", "infested", "breath_of_the_nautilus",
];
for (const e of EFFECTS) add(`effect_${e}`, `${e}_effect`);

// Enchanted copies of everything that can be enchanted, with a still frame of the purple glint.
// Added last so the characters above never move.
const ENCHANTABLE = ICONS.filter((i) => !i.name.startsWith("empty_") && !i.name.startsWith("effect_") &&
  /_(helmet|chestplate|leggings|boots)$|^(elytra|shield)$/.test(i.name));
for (const icon of ENCHANTABLE) ICONS.push({ ...icon, name: `${icon.name}_enchanted`, glint: true });

// Purple sheen like the enchantment glint: a light wash everywhere plus brighter diagonal bands.
const GLINT = [168, 92, 255];
function glint(r, g, b, x, y) {
  const band = (x + y) % 8;
  const strength = band === 2 || band === 3 ? 0.55 : band === 1 || band === 4 ? 0.4 : 0.22;
  // Screen-style blend so dark pixels pick up the colour and light ones stay bright.
  const mix = (c, t) => Math.round(c + (255 - (255 - c) * (255 - t) / 255 - c) * strength);
  return [mix(r, GLINT[0]), mix(g, GLINT[1]), mix(b, GLINT[2])];
}

// --- build ---

const srcDir = process.argv[2];
if (!srcDir) throw new Error("usage: node tools/build-glyphs.js <vanilla texture folder>");

function load(file) {
  for (const ext of [".png", ".tga"]) {
    const p = path.join(srcDir, file + ext);
    if (fs.existsSync(p)) return ext === ".png" ? decodePng(fs.readFileSync(p)) : decodeTga(fs.readFileSync(p));
  }
  throw new Error("missing texture " + file);
}

const SHEET = CELL * 16;
const sheet = { width: SHEET, height: SHEET, data: Buffer.alloc(SHEET * SHEET * 4) };
const map = {};

ICONS.forEach((icon, index) => {
  const img = load(icon.file);
  const cx = (index % 16) * CELL, cy = Math.floor(index / 16) * CELL;
  // Source area: a region of a larger texture, an 18x18 effect icon minus its border, or the whole image.
  const border = img.width - CELL > 0 && img.width - CELL <= 4 ? (img.width - CELL) / 2 : 0;
  const src = icon.region ?? { x: border, y: border, w: img.width - 2 * border, h: img.height - 2 * border };
  // Fit inside the cell keeping the shape, centred; sample pixel centres so edge rows survive scaling.
  const scale = Math.min(CELL / src.w, CELL / src.h);
  const w = Math.round(src.w * scale), h = Math.round(src.h * scale);
  const ox = Math.floor((CELL - w) / 2), oy = Math.floor((CELL - h) / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = src.x + Math.floor(((x + 0.5) * src.w) / w);
      const sy = src.y + Math.floor(((y + 0.5) * src.h) / h);
      const s = (sy * img.width + sx) * 4, d = ((cy + oy + y) * SHEET + cx + ox + x) * 4;
      let [r, g, b, a] = img.data.subarray(s, s + 4);
      if (icon.tint) { r = (r * icon.tint[0]) / 255; g = (g * icon.tint[1]) / 255; b = (b * icon.tint[2]) / 255; }
      if (icon.alpha) a *= icon.alpha;
      if (icon.glint && a > 0) [r, g, b] = glint(r, g, b, x, y);
      sheet.data.set([r, g, b, a], d);
    }
  }
  map[icon.name] = String.fromCharCode(0xe100 + index);
  if (index === 0 || img.width !== 16) console.log(`  ${icon.file}: ${img.width}x${img.height}`);
});

const root = path.join(__dirname, "..");
fs.mkdirSync(path.join(root, "ArmorHUD_RP", "font"), { recursive: true });
fs.writeFileSync(path.join(root, "ArmorHUD_RP", "font", "glyph_E1.png"), encodePng(sheet));

const js =
  "// Generated by tools/build-glyphs.js. Icon name -> character in ArmorHUD_RP/font/glyph_E1.png.\n" +
  "export const GLYPHS = {\n" +
  Object.entries(map).map(([k, v]) => `  ${k}: "\\u${v.charCodeAt(0).toString(16).toUpperCase()}",`).join("\n") +
  "\n};\n";
fs.writeFileSync(path.join(root, "ArmorHUD_BP", "scripts", "glyphs.js"), js);
console.log(`wrote ${ICONS.length} icons`);
