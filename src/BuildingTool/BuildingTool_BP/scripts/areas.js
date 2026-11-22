import { world, system, BlockVolume, StructureRotation, StructureSaveMode } from "@minecraft/server";

// Areas are saved and placed as structures, which keep every block exactly: which way it faces,
// what's inside chests and furnaces, sign text and so on. Placing one turned (StructureRotation)
// turns the blocks too, so stairs, furnaces and doors face the new way.
//
// Big areas are split into tiles of up to 64 blocks a side, named "<base>_<i>_<j>_<k>", and handled
// one tile per tick so the game doesn't freeze.

const TILE = 64;
const FILL = 32; // fillBlocks does at most 32768 blocks at a time
const ROTATIONS = [StructureRotation.None, StructureRotation.Rotate90, StructureRotation.Rotate180, StructureRotation.Rotate270];

function* tiles(size, step = TILE) {
  for (let x = 0; x < size.x; x += step) {
    for (let y = 0; y < size.y; y += step) {
      for (let z = 0; z < size.z; z += step) {
        yield {
          i: x / step, j: y / step, k: z / step,
          off: { x, y, z },
          size: { x: Math.min(step, size.x - x), y: Math.min(step, size.y - y), z: Math.min(step, size.z - z) },
        };
      }
    }
  }
}

const tileId = (base, t) => `${base}_${t.i}_${t.j}_${t.k}`;
const corner = (min, t) => ({ x: min.x + t.off.x, y: min.y + t.off.y, z: min.z + t.off.z });
const farCorner = (from, t) => ({ x: from.x + t.size.x - 1, y: from.y + t.size.y - 1, z: from.z + t.size.z - 1 });

// Size of an area after k quarter turns.
export const turnedSize = (size, k) => (k % 2 ? { x: size.z, y: size.y, z: size.x } : { ...size });

// Where a tile ends up inside its area after the area is turned k quarter turns clockwise (seen from
// above). One turn takes the north edge to the east: x' = depth - z - tileDepth, z' = x.
function turnedTileOffset(t, box, k) {
  let o = { x: t.off.x, z: t.off.z };
  let s = { x: t.size.x, z: t.size.z };
  let b = { x: box.x, z: box.z };
  for (let n = 0; n < k; n++) {
    o = { x: b.z - o.z - s.z, z: o.x };
    s = { x: s.z, z: s.x };
    b = { x: b.z, z: b.x };
  }
  return { x: o.x, y: t.off.y, z: o.z };
}

// An area at `offset` from a block, turned k quarter turns clockwise around that block: the new
// offset of its corner. One turn: (x, z) -> (-z, x).
export function turnedOffset(offset, size, k) {
  let o = { ...offset };
  let s = { ...size };
  for (let n = 0; n < k; n++) {
    o = { x: -(o.z + s.z - 1), y: o.y, z: o.x };
    s = { x: s.z, y: s.y, z: s.x };
  }
  return o;
}

export function* captureJob(base, dimension, min, size, saveMode = StructureSaveMode.World) {
  for (const t of tiles(size)) {
    const id = tileId(base, t);
    if (world.structureManager.get(id)) world.structureManager.delete(id);
    const from = corner(min, t);
    world.structureManager.createFromWorld(id, dimension, from, farCorner(from, t), {
      includeBlocks: true,
      includeEntities: false,
      saveMode,
    });
    yield;
  }
}

// Places an area saved by captureJob (`size` is its size when saved) with its corner at `min`,
// turned k quarter turns clockwise.
export function* placeJob(base, dimension, min, size, k = 0) {
  for (const t of tiles(size)) {
    const o = turnedTileOffset(t, size, k);
    world.structureManager.place(tileId(base, t), dimension, { x: min.x + o.x, y: min.y + o.y, z: min.z + o.z }, {
      rotation: ROTATIONS[k],
      includeEntities: false,
    });
    yield;
  }
}

export function* clearJob(dimension, min, size) {
  for (const t of tiles(size, FILL)) {
    const from = corner(min, t);
    dimension.fillBlocks(new BlockVolume(from, farCorner(from, t)), "minecraft:air");
    yield;
  }
}

export function deleteSaved(base, size) {
  for (const t of tiles(size)) {
    try {
      world.structureManager.delete(tileId(base, t));
    } catch {}
  }
}

// Runs a job over the next ticks; resolves when it's done.
export function run(job) {
  return new Promise((resolve, reject) => {
    system.runJob(
      (function* () {
        try {
          yield* job;
          resolve();
        } catch (e) {
          reject(e);
        }
      })()
    );
  });
}

export function isLoaded(dimension, min, size) {
  const steps = (from, n) => {
    const list = [];
    for (let v = from; v < from + n; v += 16) list.push(v);
    list.push(from + n - 1);
    return list;
  };
  const zs = steps(min.z, size.z);
  return steps(min.x, size.x).every((x) => zs.every((z) => dimension.isChunkLoaded({ x, y: min.y, z })));
}

export function inWorld(dimension, min, size) {
  const range = dimension.heightRange;
  return min.y >= range.min && min.y + size.y - 1 < range.max;
}
