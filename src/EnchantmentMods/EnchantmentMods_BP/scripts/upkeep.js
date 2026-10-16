import { world, system, EquipmentSlot } from "@minecraft/server";
import { ENCHANTMENTS, enchantLabel } from "./enchantments.js";
import { getEnchants, getVanilla, isBook, itemName, loreOutdated, setEnchants, vanillaName } from "./items.js";
import { resolveLootMarker } from "./rolls.js";

// Once a second, every item a player carries or wears is checked for:
//   - loot markers on books from jungle temples, strongholds and fishing (see rolls.js)
//   - vanilla enchantments added on top of a conflicting one of ours (vanilla anvil or enchanting
//     table). The newer vanilla one wins and ours comes off, except a curse, which stays and pushes
//     the vanilla one off instead.
//   - lore lines still showing an old enchantment name
// Chests and barrels are checked a moment after a player opens them, so loot books are finished
// when they look inside.

const CHECK_TICKS = 20;
const CONTAINERS = new Set(["minecraft:chest", "minecraft:trapped_chest", "minecraft:barrel"]);
const WORN = [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet, EquipmentSlot.Offhand];

// Returns a message for the player when a conflict was settled, or undefined.
function settleConflicts(item) {
  if (isBook(item)) return undefined;
  const enchants = getEnchants(item);
  const vanilla = getVanilla(item);
  for (const [id, level] of Object.entries(enchants)) {
    for (const other of ENCHANTMENTS[id]?.vanillaConflicts ?? []) {
      if (!vanilla[other]) continue;
      if (ENCHANTMENTS[id].curse) {
        item.getComponent("minecraft:enchantable").removeEnchantment(other);
        return `§c${enchantLabel(id, level)} is a curse, so ${vanillaName(other)} came off your ${itemName(item)}.`;
      }
      delete enchants[id];
      setEnchants(item, enchants);
      return `§e${vanillaName(other)} replaced ${enchantLabel(id, level)} on your ${itemName(item)}. They can't be combined.`;
    }
  }
  return undefined;
}

// Checks one item; returns { item, changed, message } where item may be a new one.
function checkItem(item) {
  if (!item || item.maxAmount > 1) return { item, changed: false };
  const resolved = resolveLootMarker(item);
  if (resolved) return { item: resolved, changed: true };
  const message = settleConflicts(item);
  if (message) return { item, changed: true, message };
  if (Object.keys(getEnchants(item)).length && loreOutdated(item)) {
    setEnchants(item, getEnchants(item));
    return { item, changed: true };
  }
  return { item, changed: false };
}

function checkPlayer(player) {
  const inventory = player.getComponent("minecraft:inventory")?.container;
  if (inventory) {
    for (let slot = 0; slot < inventory.size; slot++) {
      const { item, changed, message } = checkItem(inventory.getItem(slot));
      if (changed) inventory.setItem(slot, item);
      if (message) player.sendMessage(message);
    }
  }
  const equippable = player.getComponent("minecraft:equippable");
  for (const slot of WORN) {
    const { item, changed, message } = checkItem(equippable?.getEquipment(slot));
    if (changed) equippable.setEquipment(slot, item);
    if (message) player.sendMessage(message);
  }
}

function checkContainer(block) {
  try {
    const container = block.getComponent("minecraft:inventory")?.container;
    if (!container) return;
    for (let slot = 0; slot < container.size; slot++) {
      const { item, changed } = checkItem(container.getItem(slot));
      if (changed) container.setItem(slot, item);
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
