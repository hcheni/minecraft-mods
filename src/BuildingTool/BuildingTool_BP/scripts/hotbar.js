import { world, system, ItemStack, ItemLockMode, StructureSaveMode } from "@minecraft/server";
import { ITEM, TOOLS, WRENCH_SLOT, newBase, saveState } from "./state.js";

// While you have the building tools, the hotbar they replaced is kept in the world, not in memory, so
// it isn't lost if the game closes: the items go into a hidden buildtool:storage entity at the top of
// the world above you, which is saved as a structure and removed. Getting them back places the
// structure, moves the items back into your hotbar and removes both. A structure keeps the items
// exactly (enchantments, names, shulker box contents and all).
//
// The tools are locked in their slots: they can't be dropped, moved, or put in a container, and they
// stay with you if you die.

const STORAGE = "buildtool:storage";
const STORE_TAG = "buildtool_store:";
const busyStores = new Set(); // structure ids whose storage entity is out in the world right now
const restoring = new Set(); // player ids

const inventory = (player) => player.getComponent("minecraft:inventory").container;
const storeSpot = (player) => ({
  x: Math.floor(player.location.x),
  y: player.dimension.heightRange.max - 1,
  z: Math.floor(player.location.z),
});
const middle = (b) => ({ x: b.x + 0.5, y: b.y, z: b.z + 0.5 });

function lockedItem(id) {
  const item = new ItemStack(id);
  item.lockMode = ItemLockMode.slot;
  item.keepOnDeath = true;
  return item;
}

export function isToolModeItem(item) {
  return !!item && (TOOLS.includes(item.typeId) || (item.typeId === ITEM.wrench && item.lockMode === ItemLockMode.slot));
}

// Puts an item in the first free slot (the main inventory before the hotbar), or drops it at your feet.
function give(player, inv, item) {
  for (let slot = 9; slot < inv.size; slot++) {
    if (!inv.getItem(slot)) return inv.setItem(slot, item);
  }
  for (let slot = 0; slot < 9; slot++) {
    if (!inv.getItem(slot)) return inv.setItem(slot, item);
  }
  player.dimension.spawnItem(item, player.location);
}

// Moves the saved hotbar from a storage entity back into the player's hotbar slots. If something is
// already in a slot, the saved item goes into the inventory instead.
function takeBack(player, inv, entity) {
  const box = entity.getComponent("minecraft:inventory").container;
  for (let slot = 0; slot < 9; slot++) {
    const item = box.getItem(slot);
    if (!item) continue;
    if (!inv.getItem(slot)) {
      box.moveItem(slot, slot, inv);
    } else {
      box.setItem(slot, undefined);
      give(player, inv, item);
    }
  }
  entity.remove();
}

export async function enterToolMode(player, st) {
  if (st.hotbar) return;
  const inv = inventory(player);
  const dimension = player.dimension;
  const spot = storeSpot(player);
  const id = `${newBase(player, st)}_hotbar`;
  busyStores.add(id);
  try {
    const entity = dimension.spawnEntity(STORAGE, middle(spot), { initialRotation: 0 });
    entity.addTag(STORE_TAG + id);
    const box = entity.getComponent("minecraft:inventory").container;
    for (let slot = 0; slot < 9; slot++) {
      if (inv.getItem(slot)) inv.moveItem(slot, slot, box);
    }
    TOOLS.forEach((tool, slot) => inv.setItem(slot, lockedItem(tool)));
    inv.setItem(WRENCH_SLOT, lockedItem(ITEM.wrench));
    player.selectedSlotIndex = 0;
    st.hotbar = { id };
    saveState(player, st);

    await system.waitTicks(1);
    try {
      world.structureManager.createFromWorld(id, dimension, spot, spot, {
        includeBlocks: false,
        includeEntities: true,
        saveMode: StructureSaveMode.World,
      });
      entity.remove();
    } catch (e) {
      console.warn(`Building Tool: couldn't save hotbar: ${e}`);
      if (player.isValid) {
        clearTools(inv);
        takeBack(player, inv, entity);
        st.hotbar = null;
        saveState(player, st);
        player.sendMessage("§cCouldn't put the building tools in your hotbar here. Try again somewhere else.");
      }
    }
  } finally {
    busyStores.delete(id);
  }
}

function clearTools(inv) {
  for (let slot = 0; slot < inv.size; slot++) {
    if (isToolModeItem(inv.getItem(slot))) inv.setItem(slot, undefined);
  }
}

// Places the saved hotbar's structure above the player and waits for its storage entity to show up.
async function fetchStore(player, id) {
  if (!world.structureManager.get(id)) return undefined;
  const dimension = player.dimension;
  const spot = storeSpot(player);
  world.structureManager.place(id, dimension, spot, { includeBlocks: false, includeEntities: true });
  for (let tries = 0; tries < 20; tries++) {
    const found = dimension.getEntities({ type: STORAGE, tags: [STORE_TAG + id] });
    if (found.length) return found[0];
    await system.waitTicks(1);
  }
  return undefined;
}

export async function exitToolMode(player, st) {
  const rec = st.hotbar;
  if (!rec || restoring.has(player.id)) return;
  restoring.add(player.id);
  try {
    // Still being saved (the wrench was used a moment ago): let that finish first. If saving failed,
    // the items have already been handed back.
    while (busyStores.has(rec.id)) await system.waitTicks(1);
    if (st.hotbar !== rec || !player.isValid) return;
    busyStores.add(rec.id);
    const inv = inventory(player);
    // Take the tools out. Anything else put in the hotbar meanwhile moves to the inventory afterwards.
    const extras = [];
    for (let slot = 0; slot < 9; slot++) {
      const item = inv.getItem(slot);
      if (!item) continue;
      inv.setItem(slot, undefined);
      if (!isToolModeItem(item)) extras.push(item);
    }
    clearTools(inv);
    const entity = await fetchStore(player, rec.id);
    if (!player.isValid) return;
    if (entity) {
      takeBack(player, inv, entity);
      world.structureManager.delete(rec.id);
    } else {
      player.sendMessage("§cYour saved hotbar couldn't be found.");
    }
    for (const item of extras) give(player, inv, item);
    if (st.hotbar === rec) st.hotbar = null;
    saveState(player, st);
  } finally {
    busyStores.delete(rec.id);
    restoring.delete(player.id);
  }
}

// Keeps the tools where they belong: in slots 0–3 and the wrench in the last slot while you have them,
// and nowhere at all otherwise (they only come from the wrench).
export function enforceTools(player, st) {
  if (restoring.has(player.id) || (st.hotbar && busyStores.has(st.hotbar.id))) return;
  const inv = inventory(player);
  const expected = st.hotbar ? { 0: TOOLS[0], 1: TOOLS[1], 2: TOOLS[2], 3: TOOLS[3], [WRENCH_SLOT]: ITEM.wrench } : {};
  for (let slot = 0; slot < inv.size; slot++) {
    const item = inv.getItem(slot);
    const want = expected[slot];
    if (want) {
      if (item?.typeId === want && item.lockMode === ItemLockMode.slot) continue;
      inv.setItem(slot, lockedItem(want));
      if (item && !isToolModeItem(item)) give(player, inv, item);
    } else if (isToolModeItem(item)) {
      inv.setItem(slot, undefined);
    }
  }
}

// Storage entities left in the world (the game closed halfway through saving or restoring a hotbar).
// If the structure still has the items, the entity is just a copy and goes; otherwise its items are
// dropped where it is so they aren't lost.
export function sweepStores() {
  for (const dimId of ["overworld", "nether", "the_end"]) {
    for (const entity of world.getDimension(dimId).getEntities({ type: STORAGE })) {
      const tag = entity.getTags().find((t) => t.startsWith(STORE_TAG));
      const id = tag?.slice(STORE_TAG.length);
      if (id && busyStores.has(id)) continue;
      if (!id || !world.structureManager.get(id)) {
        const box = entity.getComponent("minecraft:inventory")?.container;
        for (let slot = 0; box && slot < box.size; slot++) {
          const item = box.getItem(slot);
          if (item) entity.dimension.spawnItem(item, entity.location);
        }
      }
      entity.remove();
    }
  }
}
