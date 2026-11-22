import { world } from "@minecraft/server";
import { sizeOf } from "./state.js";

// The light blue box over a selected area: one buildtool:selection entity sitting on top of the area,
// whose model is stretched to the area's size (the buildtool:sx/sy/sz properties) and hangs down over it.
// It is a hair bigger than the blocks so its faces don't flicker against theirs. Its walls show from
// both sides, so you see it from inside the area too.
//
// Showing the box never throws: if the game won't show it, the action you took still counts, and you
// get one gray note in chat saying why (once per player per session).

const SELECTION = "buildtool:selection";
const PAD = 0.04;
const MAX_SIZE = 4096; // the properties' range in the entity file
const shown = new Map(); // player id -> { entity, key }
const warned = new Set(); // player ids told the box couldn't be shown

const remove = (entity) => {
  try {
    if (entity?.isValid) entity.remove();
  } catch {}
};

function spawnBox(sel, size) {
  const dimension = world.getDimension(sel.dim);
  const location = { x: sel.min.x + size.x / 2, y: sel.max.y + 1 + PAD / 2, z: sel.min.z + size.z / 2 };
  if (!dimension.isChunkLoaded(location)) return undefined;
  const entity = dimension.spawnEntity(SELECTION, location, { initialRotation: 0 });
  try {
    for (const axis of ["x", "y", "z"]) {
      entity.setProperty(`buildtool:s${axis}`, Math.min(size[axis] + PAD, MAX_SIZE));
    }
  } catch (e) {
    remove(entity);
    throw e;
  }
  return entity;
}

export function showSelection(player, sel) {
  const key = JSON.stringify([sel.dim, sel.min, sel.max]);
  const rec = shown.get(player.id);
  if (rec?.entity?.isValid && rec.key === key) return;
  // A different area (or the box went away): a fresh box, rather than moving and resizing the old one.
  remove(rec?.entity);
  shown.delete(player.id);
  try {
    const entity = spawnBox(sel, sizeOf(sel));
    if (entity) shown.set(player.id, { entity, key });
  } catch (e) {
    console.warn(`Building Tool: couldn't show the selection box: ${e?.stack ?? e}`);
    if (!warned.has(player.id) && player.isValid) {
      warned.add(player.id);
      player.sendMessage(`§7(The blue box couldn't be shown: ${e?.message ?? e}. The selection still works.)`);
    }
  }
}

export function hideSelection(playerId) {
  const rec = shown.get(playerId);
  shown.delete(playerId);
  remove(rec?.entity);
}

// Removes boxes nobody owns any more (left over from a previous session, or a player who left).
export function sweepSelections() {
  const keep = new Set([...shown.values()].filter((r) => r.entity.isValid).map((r) => r.entity.id));
  for (const id of ["overworld", "nether", "the_end"]) {
    try {
      for (const entity of world.getDimension(id).getEntities({ type: SELECTION })) {
        if (!keep.has(entity.id)) remove(entity);
      }
    } catch {}
  }
}
