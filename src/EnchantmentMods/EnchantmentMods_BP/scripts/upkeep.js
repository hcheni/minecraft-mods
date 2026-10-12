import { world, system, EquipmentSlot } from "@minecraft/server";
import { ENCHANTMENTS, enchantLabel } from "./enchantments.js";
import { getEnchants, hasVanilla, itemName, setEnchants, vanillaName } from "./items.js";
import { resolveLootMarker, rollBookExtras } from "./rolls.js";

// Once a second, every item a player carries or wears is checked for:
//   - loot markers from vaults and End cities, swapped for a random enchantment
//   - Breaking books that haven't rolled their extra vanilla enchantments yet
//   - vanilla enchantments added on top of a conflicting one of ours (vanilla anvil or enchanting
//     table). The newer vanilla one wins and ours comes off, except a curse, which stays and pushes
//     the vanilla one off instead.
// Chests and barrels are checked a moment after a player opens them, so marked loot is already
// enchanted when they look inside.

const CHECK_TICKS = 20;
const CONTAINERS = new Set(["minecraft:chest", "minecraft:trapped_chest", "minecraft:barrel"]);
const WORN = [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet, EquipmentSlot.Offhand];

// Returns a message for the player when a conflict was settled, or undefined.
function settleConflicts(item) {
  const enchants = getEnchants(item);
  for (const [id, level] of Object.entries(enchants)) {
    for (const vanilla of ENCHANTMENTS[id]?.vanillaConflicts ?? []) {
      if (!hasVanilla(item, vanilla)) continue;
      if (ENCHANTMENTS[id].curse) {
        item.getComponent("minecraft:enchantable").removeEnchantment(vanilla);
        return `§c${enchantLabel(id, level)} is a curse, so ${vanillaName(vanilla)} came off your ${itemName(item)}.`;
      }
      delete enchants[id];
      setEnchants(item, enchants);
      return `§e${vanillaName(vanilla)} replaced ${enchantLabel(id, level)} on your ${itemName(item)}. They can't be combined.`;
    }
  }
  return undefined;
}

// Checks one item; returns { changed, message }.
function checkItem(item) {
  if (!item || item.maxAmount > 1) return { changed: false };
  let changed = resolveLootMarker(item);
  changed = rollBookExtras(item) || changed;
  const message = settleConflicts(item);
  return { changed: changed || !!message, message };
}

function checkPlayer(player) {
  const inventory = player.getComponent("minecraft:inventory")?.container;
  if (inventory) {
    for (let slot = 0; slot < inventory.size; slot++) {
      const item = inventory.getItem(slot);
      const { changed, message } = checkItem(item);
      if (changed) inventory.setItem(slot, item);
      if (message) player.sendMessage(message);
    }
  }
  const equippable = player.getComponent("minecraft:equippable");
  for (const slot of WORN) {
    const item = equippable?.getEquipment(slot);
    const { changed, message } = checkItem(item);
    if (changed) equippable.setEquipment(slot, item);
    if (message) player.sendMessage(message);
  }
}

function checkContainer(block) {
  try {
    const container = block.getComponent("minecraft:inventory")?.container;
    if (!container) return;
    for (let slot = 0; slot < container.size; slot++) {
      const item = container.getItem(slot);
      if (checkItem(item).changed) container.setItem(slot, item);
    }
  } catch {
    // The block was broken or unloaded.
  }
}

world.afterEvents.playerInteractWithBlock.subscribe(({ block }) => {
  if (!CONTAINERS.has(block.typeId)) return;
  // The loot is filled in as the chest opens; look right after, and once more in case it was late.
  system.run(() => checkContainer(block));
  system.runTimeout(() => checkContainer(block), 5);
});

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    try {
      checkPlayer(player);
    } catch {
      // The player left mid-check.
    }
  }
}, CHECK_TICKS);
