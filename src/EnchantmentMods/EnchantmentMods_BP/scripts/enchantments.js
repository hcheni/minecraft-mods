// Every enchantment this pack adds. The scripts read this, and so does tools/build.mjs, which makes a
// book item for each level, the creative inventory order, and the chest, fishing and villager loot.
// Keep this file free of @minecraft imports so Node can load it too.
//
//   items       – the kinds of item it goes on (see itemKind below)
//   weight      – enchantment weight, like vanilla's: how likely it is next to other enchantments at
//                 the enchanting table and in loot that picks by weight
//   aspect      – aspects are exclusive: an item can have only one, and vanilla Fire Aspect counts as one
//   conflicts   – other enchantments of ours it can't be combined with
//   vanillaConflicts – vanilla enchantments it can't be combined with
//   curse       – shown in red; a treasure enchantment (never from the enchanting table). When vanilla
//                 adds a conflicting enchantment later, the curse stays and the vanilla one comes off
//   special     – only from its own loot (woodland mansions); never from the table, villagers,
//                 regular loot, or as an extra enchantment on a found book
//   tableMaxLevel – the highest level the enchanting table gives
//   anvilCost   – XP levels per enchantment level when applying the book at an anvil
//
// The order here is the order of the books in the creative inventory and of the lore lines on an
// item: weapon aspects, other weapon enchantments, tools, armor, then curses.

export const WEAPONS = ["sword", "spear", "mace"];
export const ARMOR = ["helmet", "chestplate", "leggings", "boots"];
// Everything Unbreaking can go on.
export const BREAKABLE = [
  ...WEAPONS, ...ARMOR, "trident", "axe", "pickaxe", "shovel", "hoe", "bow", "crossbow", "fishing_rod",
  "shears", "flint_and_steel", "shield", "elytra", "carrot_on_a_stick", "warped_fungus_on_a_stick", "brush",
];

const aspect = (name, maxLevel = 2) => ({ name, maxLevel, items: WEAPONS, aspect: true, weight: 2, anvilCost: 2 });

export const ENCHANTMENTS = {
  frost_aspect: aspect("Frostbite"),
  poison_aspect: aspect("Venom"),
  weakening_touch: aspect("Weakening Touch"),
  wither_aspect: aspect("Withering"),
  sticking: aspect("Sticking"),
  target: aspect("Target"),
  strength_surge: { name: "Strength Surge", maxLevel: 3, items: WEAPONS, weight: 3, anvilCost: 4 },
  strength_amplifier: {
    name: "Strength Amplifier",
    maxLevel: 3,
    items: [...WEAPONS, "trident"],
    weight: 1,
    special: true,
    conflicts: ["life_steal"],
    anvilCost: 8,
  },
  zapping: { name: "Zapping", maxLevel: 3, items: ["sword"], weight: 3, tableMaxLevel: 2, anvilCost: 4 },
  life_steal: {
    name: "Life Steal",
    maxLevel: 3,
    items: [...WEAPONS, "trident"],
    weight: 1,
    special: true,
    conflicts: ["strength_amplifier"],
    anvilCost: 8,
  },
  reach: {
    name: "Reach",
    maxLevel: 3,
    items: ["hoe", "shovel", "pickaxe", "axe", "sword", "spear", "mace", "trident"],
    weight: 2,
    anvilCost: 2,
  },
  protection_surge: { name: "Protection Surge", maxLevel: 3, items: ARMOR, weight: 3, anvilCost: 4 },
  knockback_protection: {
    name: "Knockback Protection",
    maxLevel: 4,
    items: ARMOR,
    weight: 5,
    vanillaConflicts: ["protection", "projectile_protection", "fire_protection", "blast_protection"],
    anvilCost: 2,
  },
  alchemist: { name: "Alchemist", maxLevel: 4, items: ["chestplate"], weight: 4, anvilCost: 2 },
  breaking: {
    name: "Breaking",
    maxLevel: 3,
    items: BREAKABLE,
    weight: 1,
    curse: true,
    vanillaConflicts: ["unbreaking"],
    anvilCost: 1,
  },
};

for (const ench of Object.values(ENCHANTMENTS)) {
  if (ench.aspect) ench.vanillaConflicts = ["fire_aspect"];
}

// Found in regular loot, at the enchanting table (unless a curse) and from librarians.
export const LIKE_VANILLA = Object.keys(ENCHANTMENTS).filter((id) => !ENCHANTMENTS[id].special);

// Earlier versions used other ids or names.
export const RENAMED = { knockback_resistance: "knockback_protection" };
export const OLD_NAMES = ["Knockback Resistance", "Frost Aspect", "Poison Aspect", "Wither Aspect"];

export const ROMAN = ["", "I", "II", "III", "IV", "V"];

// "Frostbite II"; a one-level enchantment has no number, like vanilla Mending.
export function enchantLabel(id, level) {
  const ench = ENCHANTMENTS[id];
  return ench.maxLevel === 1 ? ench.name : `${ench.name} ${ROMAN[level]}`;
}

// The lore line for an enchantment: gray, or red for a curse.
export function enchantLine(id, level) {
  return (ENCHANTMENTS[id].curse ? "§r§c" : "§r§7") + enchantLabel(id, level);
}

// Two enchantments of ours that can't share an item.
export function customConflict(a, b) {
  if (a === b) return false;
  if (ENCHANTMENTS[a]?.aspect && ENCHANTMENTS[b]?.aspect) return true;
  return !!ENCHANTMENTS[a]?.conflicts?.includes(b) || !!ENCHANTMENTS[b]?.conflicts?.includes(a);
}

const KINDS = [
  [/_pickaxe$/, "pickaxe"],
  [/_sword$/, "sword"],
  [/_spear$/, "spear"],
  [/_axe$/, "axe"],
  [/_shovel$/, "shovel"],
  [/_hoe$/, "hoe"],
  [/_helmet$/, "helmet"],
  [/_chestplate$/, "chestplate"],
  [/_leggings$/, "leggings"],
  [/_boots$/, "boots"],
];
const SINGLE_KINDS = new Set([
  "mace", "trident", "bow", "crossbow", "fishing_rod", "shears", "flint_and_steel", "shield", "elytra",
  "carrot_on_a_stick", "warped_fungus_on_a_stick", "brush",
]);

// "sword", "chestplate", "bow"…, or undefined for vanilla items none of ours can go on.
export function itemKind(typeId) {
  if (!typeId?.startsWith("minecraft:")) return undefined;
  const name = typeId.slice("minecraft:".length);
  if (SINGLE_KINDS.has(name)) return name;
  return KINDS.find(([pattern]) => pattern.test(name))?.[1];
}

export function canGoOn(id, typeId) {
  return ENCHANTMENTS[id].items.includes(itemKind(typeId));
}

// Loot tables can't run scripts, so books from loot that can carry more than one enchantment get a
// marker lore line (color codes only, so it shows as nothing) that the scripts act on when a player
// opens the chest or picks the book up. MULTI_POWER is the enchanting power those books are made with.
export const LOOT_MARKERS = { custom_book: "§e§m§c", vanilla_book: "§e§m§v" };
export const MULTI_POWER = 30;
