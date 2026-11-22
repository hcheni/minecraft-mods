import { world, GameMode, EquipmentSlot } from "@minecraft/server";

export const ITEM = {
  wrench: "buildtool:wrench",
  delete: "buildtool:delete",
  rotateRight: "buildtool:rotate_right",
  rotateLeft: "buildtool:rotate_left",
  copy: "buildtool:copy",
  paste: "buildtool:paste",
  undo: "buildtool:undo",
  hat: "buildtool:builders_hat",
};

// The tools the wrench puts in hotbar slots 0–3. The wrench itself goes in the last slot so you can
// crouch and right-click to get your hotbar back.
export const TOOLS = [ITEM.delete, ITEM.rotateRight, ITEM.rotateLeft, ITEM.copy];
export const WRENCH_SLOT = 8;

export const MAX_DISTANCE = 20;
export const MAX_VOLUME = 2_000_000;
export const UNDO_LIMIT = 10;

// Each player's building state, kept on the player so it survives leaving and rejoining:
//   c1, c2   coordinate 1 ({x, y, z, dim}) and 2
//   sel      the selected area {dim, min, max, cx, cz}; cx/cz is the middle it turns around
//   hotbar   {id} of the structure holding the hotbar the tools replaced
//   clip     the copied area {base, size, offset, facing}: offset is from the starting point to the
//            area's corner, facing the way you looked when copying (0 south, 1 west, 2 north, 3 east)
//   undo     what Undo can take back, newest last
//   n        counter for unique structure names
const KEY = "buildtool:state";
const cache = new Map();

export function getState(player) {
  let st = cache.get(player.id);
  if (!st) {
    let saved = null;
    try {
      saved = JSON.parse(player.getDynamicProperty(KEY) ?? "null");
    } catch {}
    st = { c1: null, c2: null, sel: null, hotbar: null, clip: null, undo: [], n: 0, ...saved };
    cache.set(player.id, st);
  }
  return st;
}

export function saveState(player, st) {
  player.setDynamicProperty(KEY, JSON.stringify(st));
}

world.afterEvents.playerLeave.subscribe(({ playerId }) => cache.delete(playerId));

// Players with a change in progress (deleting, rotating, copying, pasting, undoing).
export const busy = new Set();

export function canBuild(player) {
  if (player.getGameMode() === GameMode.Creative) return true;
  try {
    return player.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Head)?.typeId === ITEM.hat;
  } catch {
    return false;
  }
}

export function deny(player) {
  player.sendMessage("§cYou can only use this in creative mode, or while wearing a Builder's Hat.");
}

export const floorPos = (l) => ({ x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z) });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const sizeOf = (box) => ({ x: box.max.x - box.min.x + 1, y: box.max.y - box.min.y + 1, z: box.max.z - box.min.z + 1 });
export const dims = (s) => `${s.x}×${s.y}×${s.z}`;
export const posText = (p) => `${p.x}, ${p.y}, ${p.z}`;

// How far a point is from the outside of the box of blocks min..max (0 inside it).
export function distanceToBox(loc, min, max) {
  const d = (v, lo, hi) => Math.max(lo - v, 0, v - (hi + 1));
  return Math.hypot(d(loc.x, min.x, max.x), d(loc.y, min.y, max.y), d(loc.z, min.z, max.z));
}

// The way the player looks, in quarter turns clockwise from south.
export function facing(player) {
  const f = Math.round(player.getRotation().y / 90);
  return ((f % 4) + 4) % 4;
}

// A new structure name for this player: "buildtool:p<player>_<n>".
export function newBase(player, st) {
  st.n += 1;
  return `buildtool:p${player.id.replace(/-/g, "m")}_${st.n}`;
}
