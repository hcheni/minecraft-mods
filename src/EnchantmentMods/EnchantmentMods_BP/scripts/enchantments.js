// Every enchantment this pack adds. The scripts read this, and so does tools/build.js, which makes a
// book item for each level plus the chest, vault and villager loot. Keep this file free of imports so
// Node can load it too.
//
//   items          – the kinds of item it goes on (see itemKind below)
//   aspect         – aspects are exclusive: an item can have only one, and vanilla Fire Aspect counts as one
//   curse          – shown in red like vanilla curses; when vanilla adds a conflicting enchantment
//                    later, the curse stays and the vanilla one comes off
//   vanillaConflicts – vanilla enchantments it can't be combined with
//   anvilCost      – XP levels per enchantment level when applying the book at an anvil
//
// The order here is the order of the books in the creative inventory and of the lore lines on an item:
// weapon aspects, other weapon enchantments, armor, then curses.

const WEAPONS = ["sword", "spear", "mace"];
const ARMOR = ["helmet", "chestplate", "leggings", "boots"];
// Everything Unbreaking can go on.
const BREAKABLE = [
  ...WEAPONS, ...ARMOR, "trident", "axe", "pickaxe", "shovel", "hoe", "bow", "crossbow", "fishing_rod",
  "shears", "flint_and_steel", "shield", "elytra", "carrot_on_a_stick", "warped_fungus_on_a_stick", "brush",
];

export const ENCHANTMENTS = {
  frost_aspect: { name: "Frost Aspect", maxLevel: 2, items: WEAPONS, aspect: true, anvilCost: 2 },
  poison_aspect: { name: "Poison Aspect", maxLevel: 2, items: WEAPONS, aspect: true, anvilCost: 2 },
  weakening_touch: { name: "Weakening Touch", maxLevel: 2, items: WEAPONS, aspect: true, anvilCost: 2 },
  wither_aspect: { name: "Wither Aspect", maxLevel: 2, items: WEAPONS, aspect: true, anvilCost: 2 },
  strength_surge: { name: "Strength Surge", maxLevel: 3, items: WEAPONS, anvilCost: 4 },
  zapping: { name: "Zapping", maxLevel: 3, items: ["sword"], anvilCost: 4 },
  life_steal: { name: "Life Steal", maxLevel: 1, items: [...WEAPONS, "trident"], anvilCost: 8 },
  protection_surge: { name: "Protection Surge", maxLevel: 3, items: ARMOR, anvilCost: 4 },
  knockback_protection: {
    name: "Knockback Protection",
    maxLevel: 4,
    items: ARMOR,
    vanillaConflicts: ["protection", "projectile_protection", "fire_protection", "blast_protection"],
    anvilCost: 2,
  },
  breaking: { name: "Breaking", maxLevel: 3, items: BREAKABLE, curse: true, vanillaConflicts: ["unbreaking"], anvilCost: 1 },
};

for (const ench of Object.values(ENCHANTMENTS)) {
  if (ench.aspect) ench.vanillaConflicts = ["fire_aspect"];
}

// Earlier versions used other ids or names.
export const RENAMED = { knockback_resistance: "knockback_protection" };
export const OLD_NAMES = ["Knockback Resistance"];

export const ROMAN = ["", "I", "II", "III", "IV", "V"];

// "Frost Aspect II"; a one-level enchantment has no number, like vanilla Mending.
export function enchantLabel(id, level) {
  const ench = ENCHANTMENTS[id];
  return ench.maxLevel === 1 ? ench.name : `${ench.name} ${ROMAN[level]}`;
}

// The lore line for an enchantment: gray, or red for a curse.
export function enchantLine(id, level) {
  return (ENCHANTMENTS[id].curse ? "§r§c" : "§r§7") + enchantLabel(id, level);
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

// Loot tables can't run scripts, so weapons and armor from vaults and End cities carry a marker lore
// line (color codes only, so it shows as nothing) that the scripts swap for a random enchantment as
// soon as a player opens the chest or picks the item up.
export const LOOT_MARKERS = { end_city: "§e§m§1", trial_vault: "§e§m§2", ominous_vault: "§e§m§3" };
