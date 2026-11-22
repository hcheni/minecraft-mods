import { world, StructureSaveMode } from "@minecraft/server";
import {
  MAX_DISTANCE, UNDO_LIMIT, add, busy, dims, distanceToBox, facing, floorPos, getState, newBase, posText, saveState,
  sizeOf, sub,
} from "./state.js";
import {
  captureJob, clearArea, deleteSaved, inWorld, isLoaded, placeArea, removeDecor, run, turnedOffset, turnedSize,
} from "./areas.js";
import { hideSelection, showSelection } from "./highlight.js";
import { exitToolMode } from "./hotbar.js";

// Delete, Rotate Right/Left, Copy, Paste and Undo. Before Delete, Rotate and Paste change any blocks,
// the area they'll change is saved, and Undo puts it back exactly as it was. Undo can go back through
// your last 10 changes, newest first. Each one takes the area's cushions, paintings and armor stands
// along with its blocks (see areas.js).

// Clears both coordinates and the selection, and gives the hotbar back if the tools are in it.
export function deselect(player, st) {
  st.c1 = null;
  st.c2 = null;
  st.sel = null;
  saveState(player, st);
  hideSelection(player.id);
  if (st.hotbar) exitToolMode(player, st);
}

function pushUndo(st, entry) {
  st.undo.push(entry);
  while (st.undo.length > UNDO_LIMIT) {
    const old = st.undo.shift();
    if (old.base) deleteSaved(old.base, old.size);
    if (old.prevClip) deleteSaved(old.prevClip.base, old.prevClip.size);
  }
}

// One change at a time. A click that comes in while the last change is still being made (holding the
// button down, or one tap counted twice) is simply ignored.
async function guarded(player, action) {
  if (busy.has(player.id)) return;
  busy.add(player.id);
  try {
    await action(getState(player));
  } catch (e) {
    console.warn(`Building Tool: ${e?.stack ?? e}`);
    if (player.isValid) player.sendMessage(`§cThat didn't work: ${e?.message ?? e}`);
  } finally {
    busy.delete(player.id);
  }
}

const notLoaded = (player) => player.sendMessage("§cPart of that area isn't loaded. Move closer to it and try again.");
const noSelection = (player) => player.sendMessage("§cSelect an area with the wrench first.");

export const deleteArea = (player) =>
  guarded(player, async (st) => {
    const sel = st.sel;
    if (!sel) return noSelection(player);
    const dimension = world.getDimension(sel.dim);
    const size = sizeOf(sel);
    if (!isLoaded(dimension, sel.min, size)) return notLoaded(player);
    const base = newBase(player, st);
    await run(captureJob(base, dimension, sel.min, size));
    pushUndo(st, { type: "delete", dim: sel.dim, base, min: sel.min, size });
    saveState(player, st);
    await clearArea(dimension, sel.min, size);
    deselect(player, st);
    player.sendMessage(`§aDeleted the ${dims(size)} area. §7Undo brings it back.`);
  });

// Turns the selected area a quarter turn around its middle. A long area becomes a wide one, so the
// selection changes shape with it; the middle stays put, so turning back returns it to the same spot.
export const rotateArea = (player, clockwise) =>
  guarded(player, async (st) => {
    const sel = st.sel;
    if (!sel) return noSelection(player);
    const dimension = world.getDimension(sel.dim);
    const size = sizeOf(sel);
    const newSize = turnedSize(size, 1);
    const newMin = { x: Math.floor(sel.cx - newSize.x / 2), y: sel.min.y, z: Math.floor(sel.cz - newSize.z / 2) };
    const newMax = { x: newMin.x + newSize.x - 1, y: sel.max.y, z: newMin.z + newSize.z - 1 };
    // Everything the turn can touch: the area as it is and as it will be.
    const allMin = { x: Math.min(sel.min.x, newMin.x), y: sel.min.y, z: Math.min(sel.min.z, newMin.z) };
    const allMax = { x: Math.max(sel.max.x, newMax.x), y: sel.max.y, z: Math.max(sel.max.z, newMax.z) };
    const allSize = sizeOf({ min: allMin, max: allMax });
    if (!isLoaded(dimension, allMin, allSize)) return notLoaded(player);

    const base = newBase(player, st);
    await run(captureJob(base, dimension, allMin, allSize));
    const entry = { type: "rotate", dim: sel.dim, base, min: allMin, size: allSize, selBefore: { ...sel } };
    pushUndo(st, entry);
    saveState(player, st);

    const temp = `${newBase(player, st)}_turn`;
    await run(captureJob(temp, dimension, sel.min, size, StructureSaveMode.Memory));
    await clearArea(dimension, sel.min, size);
    await placeArea(temp, dimension, newMin, size, clockwise ? 1 : 3);
    deleteSaved(temp, size);

    if (st.sel === sel) {
      st.sel = { ...sel, min: newMin, max: newMax };
      entry.selAfter = st.sel;
      saveState(player, st);
      showSelection(player, st.sel);
    }
    player.sendMessage(`§aTurned the area 90° ${clockwise ? "clockwise" : "counterclockwise"}.`);
  });

export const copyArea = (player) =>
  guarded(player, async (st) => {
    const sel = st.sel;
    if (!sel) return noSelection(player);
    if (player.dimension.id !== sel.dim || distanceToBox(player.location, sel.min, sel.max) > MAX_DISTANCE) {
      return player.sendMessage(`§cStand within ${MAX_DISTANCE} blocks of the selected area to copy it.`);
    }
    const dimension = world.getDimension(sel.dim);
    const size = sizeOf(sel);
    if (!isLoaded(dimension, sel.min, size)) return notLoaded(player);
    const start = floorPos(player.location);
    const base = newBase(player, st);
    await run(captureJob(base, dimension, sel.min, size));
    pushUndo(st, { type: "copy", prevClip: st.clip });
    st.clip = { base, size, offset: sub(sel.min, start), facing: facing(player) };
    saveState(player, st);
    player.sendMessage(`§aCopied the ${dims(size)} area. §7Starting point: ${posText(start)}.`);
  });

// Builds the copy with you standing on the starting point. It sits as far from you as it did when you
// copied it, turned to match: if you now look a quarter turn to the right of how you looked then, the
// build turns a quarter turn to the right around you.
export const pasteArea = (player) =>
  guarded(player, async (st) => {
    const clip = st.clip;
    if (!clip) return player.sendMessage("§cYou do not have anything copied.");
    const dimension = player.dimension;
    const k = (facing(player) - clip.facing + 4) % 4;
    const start = floorPos(player.location);
    const min = add(start, turnedOffset(clip.offset, clip.size, k));
    const size = turnedSize(clip.size, k);
    if (!inWorld(dimension, min, size)) return player.sendMessage("§cThat would go outside the world. Move up or down and try again.");
    if (!isLoaded(dimension, min, size)) return notLoaded(player);
    if (!world.structureManager.get(`${clip.base}_0_0_0`)) {
      return player.sendMessage("§cYour copy couldn't be found. Copy the area again.");
    }
    const base = newBase(player, st);
    await run(captureJob(base, dimension, min, size));
    pushUndo(st, { type: "paste", dim: dimension.id, base, min, size });
    saveState(player, st);
    removeDecor(dimension, min, size);
    await placeArea(clip.base, dimension, min, clip.size, k);
    player.sendMessage(`§aPasted the ${dims(size)} copy.`);
  });

const LABEL = { delete: "delete", rotate: "rotation", paste: "paste", copy: "copy" };

export const undo = (player) =>
  guarded(player, async (st) => {
    const entry = st.undo.at(-1);
    if (!entry) return player.sendMessage("§cThere's nothing to undo.");

    if (entry.type === "copy") {
      st.undo.pop();
      if (st.clip) deleteSaved(st.clip.base, st.clip.size);
      st.clip = entry.prevClip ?? null;
      saveState(player, st);
      return player.sendMessage(`§aUndid your last copy.${st.clip ? " §7Your copy from before is back." : ""}`);
    }

    const dimension = world.getDimension(entry.dim);
    if (!isLoaded(dimension, entry.min, entry.size)) {
      return player.sendMessage("§cGo back to where you made that change to undo it.");
    }
    st.undo.pop();
    saveState(player, st);
    removeDecor(dimension, entry.min, entry.size);
    await placeArea(entry.base, dimension, entry.min, entry.size);
    deleteSaved(entry.base, entry.size);
    // Undoing a turn turns the selection back too, if it's still the turned area.
    if (entry.type === "rotate" && st.sel && entry.selAfter && JSON.stringify(st.sel) === JSON.stringify(entry.selAfter)) {
      st.sel = entry.selBefore;
      saveState(player, st);
      showSelection(player, st.sel);
    }
    player.sendMessage(`§aUndid your last ${LABEL[entry.type]}.`);
  });
