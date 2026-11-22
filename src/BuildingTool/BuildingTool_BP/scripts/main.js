import { world, system } from "@minecraft/server";
import {
  ITEM, MAX_DISTANCE, MAX_VOLUME, TOOLS, busy, canBuild, deny, dims, distanceToBox, floorPos, getState, posText,
  saveState, sizeOf,
} from "./state.js";
import { copyArea, deleteArea, deselect, pasteArea, rotateArea, undo } from "./actions.js";
import { hideSelection, showSelection, sweepSelections } from "./highlight.js";
import { enforceTools, enterToolMode, sweepStores } from "./hotbar.js";

// Building Tool: all the items work on right-click (or a tap on a block), in creative mode or while
// wearing a Builder's Hat.
//
// Wrench: first right-click saves where you stand as coordinate 1, the second as coordinate 2 and
// selects everything between them (air too), shown as a light blue box. With an area selected, a
// right-click swaps your hotbar for Delete, Rotate Right, Rotate Left and Copy (the wrench stays in the
// last slot). Crouch and right-click to clear the coordinates and selection and get your hotbar back.
// Going more than 20 blocks from the selection clears it as well.

const USABLE = new Set([ITEM.wrench, ...TOOLS, ITEM.paste, ITEM.undo]);
const lastUse = new Map(); // player id -> tick; one tap can fire both events, and holding repeats them

function useWrench(player) {
  const st = getState(player);
  if (player.isSneaking) {
    const had = st.c1 || st.c2 || st.sel || st.hotbar;
    deselect(player, st);
    player.sendMessage(had ? "§eCoordinates and selection cleared." : "§7Nothing to clear.");
    return;
  }
  if (!canBuild(player)) return deny(player);

  if (st.sel) {
    if (st.hotbar) {
      player.sendMessage("§7The building tools are already in your hotbar. Crouch and right-click with the wrench to get your items back.");
    } else {
      enterToolMode(player, st);
      player.sendMessage("§aDelete, Rotate Right, Rotate Left and Copy are in your hotbar. §7Crouch and right-click with the wrench to get your items back.");
    }
    return;
  }

  const dimension = player.dimension;
  const range = dimension.heightRange;
  const pos = floorPos(player.location);
  pos.y = Math.min(Math.max(pos.y, range.min), range.max - 1);

  if (!st.c1 || st.c1.dim !== dimension.id) {
    st.c1 = { ...pos, dim: dimension.id };
    st.c2 = null;
    saveState(player, st);
    player.sendMessage(`§aCoordinate 1 set to ${posText(pos)}.`);
    return;
  }

  const min = { x: Math.min(st.c1.x, pos.x), y: Math.min(st.c1.y, pos.y), z: Math.min(st.c1.z, pos.z) };
  const max = { x: Math.max(st.c1.x, pos.x), y: Math.max(st.c1.y, pos.y), z: Math.max(st.c1.z, pos.z) };
  const size = sizeOf({ min, max });
  if (size.x * size.y * size.z > MAX_VOLUME) {
    player.sendMessage(`§cThat area is ${dims(size)}, too big to select (at most 2,000,000 blocks). Coordinate 1 is still ${posText(st.c1)}.`);
    return;
  }
  st.c2 = pos;
  st.sel = { dim: dimension.id, min, max, cx: min.x + size.x / 2, cz: min.z + size.z / 2 };
  saveState(player, st);
  showSelection(player, st.sel);
  player.sendMessage(`§aCoordinate 2 set to ${posText(pos)}. Selected a ${dims(size)} area. §7Right-click again for the building tools.`);
}

function use(player, typeId) {
  const now = system.currentTick;
  if (now - (lastUse.get(player.id) ?? -100) < 8) return;
  lastUse.set(player.id, now);

  if (typeId === ITEM.wrench) return useWrench(player);
  if (!canBuild(player)) return deny(player);
  switch (typeId) {
    case ITEM.delete:
      return deleteArea(player);
    case ITEM.rotateRight:
      return rotateArea(player, true);
    case ITEM.rotateLeft:
      return rotateArea(player, false);
    case ITEM.copy:
      return copyArea(player);
    case ITEM.paste:
      return pasteArea(player);
    case ITEM.undo:
      return undo(player);
  }
}

world.beforeEvents.itemUse.subscribe((event) => {
  const typeId = event.itemStack?.typeId;
  if (!USABLE.has(typeId)) return;
  event.cancel = true;
  const player = event.source;
  system.run(() => use(player, typeId));
});

// Right-clicking a block with one of the tools uses the tool instead of the block (no chests opening).
world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
  const typeId = event.itemStack?.typeId;
  if (!USABLE.has(typeId)) return;
  event.cancel = true;
  if (!event.isFirstEvent) return;
  const player = event.player;
  system.run(() => use(player, typeId));
});

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    const st = getState(player);
    if (st.sel && !busy.has(player.id)) {
      const away =
        player.dimension.id !== st.sel.dim || distanceToBox(player.location, st.sel.min, st.sel.max) > MAX_DISTANCE;
      if (away) {
        deselect(player, st);
        player.sendMessage(`§eSelection cleared: you went more than ${MAX_DISTANCE} blocks away from it.`);
      } else {
        showSelection(player, st.sel);
      }
    }
    enforceTools(player, st);
  }
}, 10);

system.runInterval(() => {
  sweepSelections();
  sweepStores();
}, 100);

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
  hideSelection(playerId);
  lastUse.delete(playerId);
});
