import { world } from "@minecraft/server";
import { sizeOf } from "./state.js";

// The light green box over a selected area: one buildtool:selection entity sitting on top of the area,
// whose model is stretched to the area's size (the buildtool:sx/sy/sz properties) and hangs down over it.
// It is a hair bigger than the blocks so its faces don't flicker against theirs.

const SELECTION = "buildtool:selection";
const shown = new Map(); // player id -> { entity, key }

export function showSelection(player, sel) {
  const dimension = world.getDimension(sel.dim);
  const size = sizeOf(sel);
  const location = { x: sel.min.x + size.x / 2, y: sel.max.y + 1.02, z: sel.min.z + size.z / 2 };
  const key = JSON.stringify([sel.dim, sel.min, sel.max]);
  let rec = shown.get(player.id);
  if (rec?.entity.isValid && rec.key === key) return;
  if (rec?.entity.isValid) {
    rec.entity.teleport(location, { dimension, rotation: { x: 0, y: 0 } });
  } else {
    if (!dimension.isChunkLoaded(location)) return;
    rec = { entity: dimension.spawnEntity(SELECTION, location, { initialRotation: 0 }), key: "" };
    shown.set(player.id, rec);
  }
  rec.entity.setProperty("buildtool:sx", size.x + 0.04);
  rec.entity.setProperty("buildtool:sy", size.y + 0.04);
  rec.entity.setProperty("buildtool:sz", size.z + 0.04);
  rec.key = key;
}

export function hideSelection(playerId) {
  const rec = shown.get(playerId);
  shown.delete(playerId);
  try {
    if (rec?.entity.isValid) rec.entity.remove();
  } catch {}
}

// Removes boxes nobody owns any more (left over from a previous session, or a player who left).
export function sweepSelections() {
  const keep = new Set([...shown.values()].filter((r) => r.entity.isValid).map((r) => r.entity.id));
  for (const id of ["overworld", "nether", "the_end"]) {
    for (const entity of world.getDimension(id).getEntities({ type: SELECTION })) {
      if (!keep.has(entity.id)) entity.remove();
    }
  }
}
