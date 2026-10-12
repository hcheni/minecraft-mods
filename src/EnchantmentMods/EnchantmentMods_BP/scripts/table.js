import { world, system } from "@minecraft/server";
import { ENCHANTMENTS, canGoOn } from "./enchantments.js";
import { addRandomEnchant } from "./rolls.js";

// Enchanting a weapon or a piece of armor at an enchanting table can also give it our enchantments.
//
// Scripts get no event for enchanting, so we watch players who just used a table: when their XP level
// drops (they paid for an enchantment) and a newly enchanted item shows up in their inventory, that's
// the one they enchanted. Enchanted items they already had are marked as seen so they never roll.

const TABLE = "minecraft:enchanting_table";
const SEEN = "enchmods:seen";
const CHECK_TICKS = 4;
const SESSION_RANGE = 8; // blocks from the table
const SESSION_TICKS = 6000; // 5 minutes without touching the table again
const PENDING_TICKS = 600; // the enchanted item has 30 seconds to come out of the table

// Each roll can add one enchantment from its list to an item it fits. The chance is for the 3-level
// option; the 1- and 2-level options get a third and two thirds of it, and lower top levels.
// maxLevel caps what the table can give. Life Steal and Breaking never come from the table.
const ROLLS = [
  { ids: ["frost_aspect", "poison_aspect", "weakening_touch", "wither_aspect"], chance: 0.15 },
  { ids: ["strength_surge"], chance: 0.04 },
  { ids: ["zapping"], chance: 0.01, maxLevel: 2 },
  { ids: ["knockback_protection"], chance: 0.15 },
  { ids: ["protection_surge"], chance: 0.04 },
];

const sessions = new Map(); // player.id -> { player, location, dimensionId, startTick, level, pendingTick, levelsSpent }

function isEnchanted(item) {
  try {
    return (item.getComponent("minecraft:enchantable")?.getEnchantments().length ?? 0) > 0;
  } catch {
    return false;
  }
}

function canRoll(item) {
  return ROLLS.some(({ ids }) => ids.some((id) => canGoOn(id, item.typeId)));
}

function roll(item, levelsSpent) {
  for (const { ids, chance, maxLevel } of ROLLS) {
    if (!ids.some((id) => canGoOn(id, item.typeId))) continue;
    if (Math.random() >= (chance * levelsSpent) / 3) continue;
    // The top levels need the 3-level option.
    const caps = Object.fromEntries(
      ids.map((id) => [id, Math.max(1, Math.ceil((Math.min(ENCHANTMENTS[id].maxLevel, maxLevel ?? 9) * levelsSpent) / 3))])
    );
    addRandomEnchant(item, ids, caps);
  }
}

// Marks newly seen enchanted items. While an enchantment is pending, the first one is the item that
// just came out of the table and gets a roll.
function checkInventory(player, session) {
  const inventory = player.getComponent("minecraft:inventory")?.container;
  if (!inventory) return;
  for (let slot = 0; slot < inventory.size; slot++) {
    const item = inventory.getItem(slot);
    if (!item || !canRoll(item) || item.getDynamicProperty(SEEN) || !isEnchanted(item)) continue;
    if (session.pendingTick !== undefined) {
      roll(item, session.levelsSpent);
      session.pendingTick = undefined;
    }
    item.setDynamicProperty(SEEN, true);
    inventory.setItem(slot, item);
  }
}

function startSession(player, block) {
  const session = {
    player,
    location: block.location,
    dimensionId: block.dimension.id,
    startTick: system.currentTick,
    level: player.level,
    pendingTick: undefined,
    levelsSpent: 0,
  };
  sessions.set(player.id, session);
  checkInventory(player, session);
}

function tickSession(id, session) {
  const { player } = session;
  const now = system.currentTick;
  if (!player.isValid || player.dimension.id !== session.dimensionId || now - session.startTick > SESSION_TICKS) {
    sessions.delete(id);
    return;
  }
  const { x, y, z } = player.location;
  const { location: t } = session;
  if ((x - t.x) ** 2 + (y - t.y) ** 2 + (z - t.z) ** 2 > SESSION_RANGE ** 2) {
    sessions.delete(id);
    return;
  }
  if (player.level < session.level) {
    session.pendingTick = now;
    session.levelsSpent = Math.min(3, session.level - player.level);
  }
  session.level = player.level;
  if (session.pendingTick !== undefined && now - session.pendingTick > PENDING_TICKS) session.pendingTick = undefined;
  checkInventory(player, session);
}

world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
  if (!event.isFirstEvent) return;
  const { player, block } = event;
  if (block.typeId === TABLE) {
    system.run(() => startSession(player, block));
  } else if (sessions.has(player.id)) {
    // Using an anvil or anything else also costs levels; only the table should count.
    system.run(() => sessions.delete(player.id));
  }
});

world.afterEvents.playerLeave.subscribe(({ playerId }) => sessions.delete(playerId));

system.runInterval(() => {
  for (const [id, session] of sessions) {
    try {
      tickSession(id, session);
    } catch {
      sessions.delete(id);
    }
  }
}, CHECK_TICKS);
