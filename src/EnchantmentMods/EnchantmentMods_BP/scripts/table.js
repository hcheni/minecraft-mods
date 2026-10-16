import { world, system } from "@minecraft/server";
import { ENCHANTMENTS, LIKE_VANILLA, itemKind } from "./enchantments.js";
import { conflictIn, getEnchants, getVanilla, isVanillaBook, makeBook, setEnchants, vanillaMax } from "./items.js";
import { pickWeighted } from "./rolls.js";
import { VANILLA } from "./vanilla.js";

// Our enchantments at the enchanting table, by weight, as if the table knew them.
//
// The table picks each enchantment by weight from those that fit the item. Scripts can't add to that
// list, so after the table has done its work we go over what it picked: each vanilla enchantment is
// swapped for one of ours with the chance our weights have against vanilla's for that kind of item
// (for a sword: our weapon enchantments against Sharpness, Smite, Knockback…). Books work the same,
// with every enchantment in the running. The level follows how high the vanilla one rolled.
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

// Ours the table can give: not the mansion-only ones, and not curses (vanilla's table never gives one).
const TABLE_CUSTOM = LIKE_VANILLA.filter((id) => !ENCHANTMENTS[id].curse);

const sessions = new Map(); // player.id -> { player, location, dimensionId, startTick, level, pendingTick }

function fits(items, kind) {
  return kind === "book" || items.includes(kind);
}

function kindOf(item) {
  return isVanillaBook(item) ? "book" : itemKind(item.typeId);
}

function canRoll(item) {
  const kind = kindOf(item);
  return !!kind && TABLE_CUSTOM.some((id) => fits(ENCHANTMENTS[id].items, kind));
}

// Returns the item to put back, or undefined if nothing changed.
export function swapIn(item) {
  const kind = kindOf(item);
  const ours = TABLE_CUSTOM.filter((id) => fits(ENCHANTMENTS[id].items, kind));
  const vanillaWeight = Object.entries(VANILLA)
    .filter(([, v]) => !v.treasure && fits(v.items, kind))
    .reduce((sum, [, v]) => sum + v.weight, 0);
  const ourWeight = ours.reduce((sum, id) => sum + ENCHANTMENTS[id].weight, 0);
  const chance = ourWeight / (ourWeight + vanillaWeight);

  const set = { custom: getEnchants(item), vanilla: getVanilla(item) };
  const swapped = [];
  for (const [id, level] of Object.entries(set.vanilla)) {
    if (Math.random() >= chance) continue;
    const vanilla = { ...set.vanilla };
    delete vanilla[id];
    const options = ours
      .filter((o) => !set.custom[o] && !conflictIn({ ...set.custom, [o]: 1 }, vanilla))
      .map((o) => ({ id: o, weight: ENCHANTMENTS[o].weight }));
    if (!options.length) continue;
    const pick = pickWeighted(options).id;
    const ench = ENCHANTMENTS[pick];
    const top = Math.min(ench.maxLevel, ench.tableMaxLevel ?? ench.maxLevel);
    set.vanilla = vanilla;
    set.custom = { ...set.custom, [pick]: Math.max(1, Math.min(top, Math.round((level / vanillaMax(id)) * top))) };
    swapped.push(id);
  }
  if (!swapped.length) return undefined;

  if (kind === "book") return makeBook(set);
  const enchantable = item.getComponent("minecraft:enchantable");
  for (const id of swapped) enchantable.removeEnchantment(id);
  setEnchants(item, set.custom);
  return item;
}

function isEnchanted(item) {
  try {
    return (item.getComponent("minecraft:enchantable")?.getEnchantments().length ?? 0) > 0;
  } catch {
    return false;
  }
}

// Marks newly seen enchanted items. While an enchantment is pending, the first one is the item that
// just came out of the table and gets its roll.
function checkInventory(player, session) {
  const inventory = player.getComponent("minecraft:inventory")?.container;
  if (!inventory) return;
  for (let slot = 0; slot < inventory.size; slot++) {
    let item = inventory.getItem(slot);
    if (!item || !canRoll(item) || item.getDynamicProperty(SEEN) || !isEnchanted(item)) continue;
    if (session.pendingTick !== undefined) {
      item = swapIn(item) ?? item;
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
  if (player.level < session.level) session.pendingTick = now;
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
