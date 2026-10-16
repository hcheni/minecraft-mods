import { ItemStack, EnchantmentTypes } from "@minecraft/server";
import {
  ENCHANTMENTS, OLD_NAMES, RENAMED, ROMAN, canGoOn, customConflict, enchantLabel, enchantLine,
} from "./enchantments.js";
import { VANILLA, vanillaAnvilCost, vanillaConflict } from "./vanilla.js";

// Bedrock has no custom enchantments, so ours live on the item as a dynamic property holding
// {"frost_aspect":2,"strength_surge":1} plus lore lines that read like vanilla enchantments.
//
// Our books: the item type (enchmods:zapping_book_2) is the book's first enchantment, and the name
// shows it. A book can carry more: other enchantments of ours in the same property, and vanilla ones
// in enchmods:vanilla, all listed as lore lines under the name.

const PROPERTY = "enchmods:enchants";
const VANILLA_PROPERTY = "enchmods:vanilla";
const OLD_PROPERTY = "enchmods:aspect"; // v1.0–1.1 stored one aspect as "frost:2"
const NAMES = [...Object.values(ENCHANTMENTS).map((e) => e.name), ...OLD_NAMES];
const LORE_LINE = new RegExp(`^§r§[7c](${NAMES.join("|")})( [IVX]+)?$`);
const BOOK = /^enchmods:(\w+)_book_(\d)$/;
const ORDER = Object.keys(ENCHANTMENTS);

// ---- reading -------------------------------------------------------------------------------------

// The enchantment a book of ours is named after, or undefined for anything else.
export function bookEnchant(item) {
  const match = item && BOOK.exec(item.typeId);
  return match && ENCHANTMENTS[match[1]] ? { id: match[1], level: Number(match[2]) } : undefined;
}

export function isVanillaBook(item) {
  return item?.typeId === "minecraft:enchanted_book";
}

export function isBook(item) {
  return !!bookEnchant(item) || isVanillaBook(item);
}

function readJson(item, key) {
  try {
    const value = item.getDynamicProperty(key);
    return typeof value === "string" ? JSON.parse(value) : undefined;
  } catch {
    return undefined; // Not an item that can hold dynamic properties, or the value is damaged.
  }
}

// { id: level } for every enchantment of ours on the item (on a book of ours, its own one too).
export function getEnchants(item) {
  if (!item) return {};
  let stored = readJson(item, PROPERTY);
  if (stored) {
    stored = Object.fromEntries(Object.entries(stored).map(([id, level]) => [RENAMED[id] ?? id, level]));
  } else {
    let old;
    try {
      old = item.getDynamicProperty(OLD_PROPERTY);
    } catch {
      // ignore
    }
    stored = typeof old === "string" ? { [`${old.split(":")[0]}_aspect`]: Number(old.split(":")[1]) } : {};
  }
  const own = bookEnchant(item);
  if (own) stored[own.id] = Math.max(own.level, stored[own.id] ?? 0);
  return stored;
}

export function getLevel(item, id) {
  return getEnchants(item)[id] ?? 0;
}

function shortId(id) {
  return id.replace(/^minecraft:/, "");
}

// { id: level } for the vanilla enchantments on an item or book.
export function getVanilla(item) {
  if (!item) return {};
  if (bookEnchant(item)) return readJson(item, VANILLA_PROPERTY) ?? {};
  try {
    const list = item.getComponent("minecraft:enchantable")?.getEnchantments() ?? [];
    return Object.fromEntries(list.map((e) => [shortId(e.type.id), e.level]));
  } catch {
    return {};
  }
}

export function hasVanilla(item, id) {
  return (getVanilla(item)[id] ?? 0) > 0;
}

// ---- names ---------------------------------------------------------------------------------------

export function vanillaName(id) {
  return id
    .split("_")
    .map((word) => (word === "of" || word === "the" ? word : word[0].toUpperCase() + word.slice(1)))
    .join(" ");
}

export function vanillaMax(id) {
  try {
    return EnchantmentTypes.get(id)?.maxLevel ?? 1;
  } catch {
    return 1;
  }
}

export function vanillaLabel(id, level) {
  return vanillaMax(id) > 1 ? `${vanillaName(id)} ${ROMAN[level] ?? level}` : vanillaName(id);
}

function vanillaLine(id, level) {
  return (VANILLA[id]?.curse ? "§r§c" : "§r§7") + vanillaLabel(id, level);
}

export function itemName(item) {
  return item.nameTag || vanillaName(item.typeId.replace(/^\w+:/, ""));
}

function ordered(enchants) {
  return ORDER.filter((id) => enchants[id] > 0);
}

// ---- writing -------------------------------------------------------------------------------------

// Writes our enchantments on a (non-book) item, removing ours that aren't listed. Call setItem after.
export function setEnchants(item, enchants) {
  const ids = ordered(enchants);
  const kept = Object.fromEntries(ids.map((id) => [id, enchants[id]]));
  item.setDynamicProperty(PROPERTY, ids.length ? JSON.stringify(kept) : undefined);
  item.setDynamicProperty(OLD_PROPERTY, undefined);
  const lore = item.getLore().filter((line) => !LORE_LINE.test(line));
  item.setLore([...ids.map((id) => enchantLine(id, kept[id])), ...lore]);
}

// True when the lore lines don't match the enchantments (an enchantment was renamed).
export function loreOutdated(item) {
  if (bookEnchant(item)) return false;
  const enchants = getEnchants(item);
  const want = ordered(enchants).map((id) => enchantLine(id, enchants[id]));
  const have = item.getLore().filter((line) => LORE_LINE.test(line));
  return want.join("\n") !== have.join("\n");
}

// A new book holding these enchantments: ours if it has any of ours (named after the first), otherwise
// a vanilla enchanted book.
export function makeBook({ custom, vanilla }) {
  const ids = ordered(custom);
  const vanillaIds = Object.keys(vanilla).filter((id) => vanilla[id] > 0);
  if (!ids.length) {
    const book = new ItemStack("minecraft:enchanted_book");
    const enchantable = book.getComponent("minecraft:enchantable");
    for (const id of vanillaIds) enchantable?.addEnchantment({ type: EnchantmentTypes.get(id), level: vanilla[id] });
    return book;
  }
  const [first, ...rest] = ids;
  const book = new ItemStack(`enchmods:${first}_book_${custom[first]}`);
  if (rest.length) book.setDynamicProperty(PROPERTY, JSON.stringify(Object.fromEntries(rest.map((id) => [id, custom[id]]))));
  if (vanillaIds.length) {
    book.setDynamicProperty(VANILLA_PROPERTY, JSON.stringify(Object.fromEntries(vanillaIds.map((id) => [id, vanilla[id]]))));
  }
  book.setLore([...rest.map((id) => enchantLine(id, custom[id])), ...vanillaIds.map((id) => vanillaLine(id, vanilla[id]))]);
  return book;
}

// ---- combining -----------------------------------------------------------------------------------

function mergeLevel(a, b, max) {
  if (!a) return b;
  if (!b) return a;
  return a === b ? Math.min(a + 1, max) : Math.max(a, b);
}

// Why these enchantments can't all be together, or undefined if they can.
export function conflictIn(custom, vanilla) {
  const ours = Object.keys(custom).filter((id) => custom[id] > 0);
  const theirs = Object.keys(vanilla).filter((id) => vanilla[id] > 0);
  for (const a of ours) {
    for (const b of ours) if (a < b && customConflict(a, b)) return `${ENCHANTMENTS[a].name} can't be combined with ${ENCHANTMENTS[b].name}`;
    for (const v of theirs) {
      if (ENCHANTMENTS[a].vanillaConflicts?.includes(v)) return `${ENCHANTMENTS[a].name} can't be combined with ${vanillaName(v)}`;
    }
  }
  for (const a of theirs) {
    for (const b of theirs) if (a < b && vanillaConflict(a, b)) return `${vanillaName(a)} can't be combined with ${vanillaName(b)}`;
  }
  return undefined;
}

function costOf(added) {
  return added.reduce(
    (sum, e) => sum + e.level * (e.custom ? ENCHANTMENTS[e.id].anvilCost : vanillaAnvilCost(e.id)),
    0
  );
}

// Two books into one. Like vanilla: equal levels merge into the next level, otherwise the higher
// level wins; if anything on them can't go together, they don't combine.
// Returns { custom, vanilla, added, cost } or { error }.
export function combineBooks(target, held) {
  const a = { custom: getEnchants(target), vanilla: getVanilla(target) };
  const b = { custom: getEnchants(held), vanilla: getVanilla(held) };
  const custom = { ...a.custom };
  const vanilla = { ...a.vanilla };
  const added = [];
  for (const [id, level] of Object.entries(b.custom)) {
    const next = mergeLevel(custom[id], level, ENCHANTMENTS[id].maxLevel);
    if (next !== (custom[id] ?? 0)) added.push({ custom: true, id, level: next });
    custom[id] = next;
  }
  for (const [id, level] of Object.entries(b.vanilla)) {
    const next = mergeLevel(vanilla[id], level, vanillaMax(id));
    if (next !== (vanilla[id] ?? 0)) added.push({ custom: false, id, level: next });
    vanilla[id] = next;
  }
  const conflict = conflictIn(custom, vanilla);
  if (conflict) return { error: conflict };
  if (!added.length) return { error: "Nothing new to add" };
  return { custom, vanilla, added, cost: costOf(added) };
}

function canAddVanilla(item, id, level) {
  try {
    const enchantable = item.getComponent("minecraft:enchantable");
    const type = EnchantmentTypes.get(id);
    return !!enchantable && !!type && enchantable.canAddEnchantment({ type, level });
  } catch {
    return false;
  }
}

// A book's enchantments onto an item. Like the vanilla anvil, enchantments that don't fit the item or
// clash with what it has are skipped; at least one has to go on.
// Returns { custom, vanilla, added, cost } or { error }.
export function planApply(item, book) {
  const custom = getEnchants(item);
  const vanilla = getVanilla(item);
  const offer = { custom: getEnchants(book), vanilla: getVanilla(book) };
  const added = [];
  let reason;

  for (const id of ordered(offer.custom)) {
    const ench = ENCHANTMENTS[id];
    if (!canGoOn(id, item.typeId)) {
      reason ??= `${ench.name} can't go on this`;
      continue;
    }
    const clash =
      Object.keys(custom).find((other) => customConflict(other, id)) ??
      Object.keys(vanilla).find((v) => ench.vanillaConflicts?.includes(v));
    if (clash) {
      reason ??= `Can't be combined with ${ENCHANTMENTS[clash]?.name ?? vanillaName(clash)}`;
      continue;
    }
    const next = mergeLevel(custom[id], offer.custom[id], ench.maxLevel);
    if (next === (custom[id] ?? 0)) {
      reason ??= `Already has ${enchantLabel(id, next)}`;
      continue;
    }
    custom[id] = next;
    added.push({ custom: true, id, level: next });
  }

  for (const id of Object.keys(offer.vanilla)) {
    const clash =
      Object.keys(vanilla).find((other) => vanillaConflict(other, id)) ??
      Object.keys(custom).find((ours) => ENCHANTMENTS[ours]?.vanillaConflicts?.includes(id));
    if (clash) {
      reason ??= `Can't be combined with ${ENCHANTMENTS[clash]?.name ?? vanillaName(clash)}`;
      continue;
    }
    const next = mergeLevel(vanilla[id], offer.vanilla[id], vanillaMax(id));
    if (next === (vanilla[id] ?? 0)) {
      reason ??= `Already has ${vanillaLabel(id, next)}`;
      continue;
    }
    if (!vanilla[id] && !canAddVanilla(item, id, next)) {
      reason ??= `${vanillaName(id)} can't go on this`;
      continue;
    }
    vanilla[id] = next;
    added.push({ custom: false, id, level: next });
  }

  if (!added.length) return { error: reason ?? "Nothing on this book can go on it" };
  return { custom, vanilla, added, cost: costOf(added) };
}

// Writes a plan from planApply onto the item. Call setItem after.
export function writePlan(item, plan) {
  setEnchants(item, plan.custom);
  const enchantable = item.getComponent("minecraft:enchantable");
  for (const { custom, id, level } of plan.added) {
    if (custom) continue;
    if (enchantable.hasEnchantment(id)) enchantable.removeEnchantment(id);
    enchantable.addEnchantment({ type: EnchantmentTypes.get(id), level });
  }
}

export function addedLabels(added) {
  return added.map(({ custom, id, level }) => (custom ? enchantLabel(id, level) : vanillaLabel(id, level)));
}
