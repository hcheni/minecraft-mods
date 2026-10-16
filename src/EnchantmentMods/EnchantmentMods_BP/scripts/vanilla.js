import { ARMOR, BREAKABLE } from "./enchantments.js";

// What we need to know about vanilla enchantments: their weights (how often the enchanting table and
// weighted loot pick them), what they go on at the enchanting table, whether they're treasure, and
// which ones can't be combined. Used next to ours so both compete on equal terms.
// No @minecraft imports, so tools/build.mjs can load this too.

const TOOLS = ["pickaxe", "shovel", "axe", "hoe"];
const MELEE = ["sword", "axe", "spear", "mace"];

export const VANILLA = {
  protection: { weight: 10, items: ARMOR },
  fire_protection: { weight: 5, items: ARMOR },
  blast_protection: { weight: 2, items: ARMOR },
  projectile_protection: { weight: 5, items: ARMOR },
  feather_falling: { weight: 5, items: ["boots"] },
  thorns: { weight: 1, items: ["chestplate"] },
  respiration: { weight: 2, items: ["helmet"] },
  aqua_affinity: { weight: 2, items: ["helmet"] },
  depth_strider: { weight: 2, items: ["boots"] },
  frost_walker: { weight: 2, items: ["boots"], treasure: true },
  soul_speed: { weight: 1, items: ["boots"], treasure: true, neverRandom: true },
  swift_sneak: { weight: 1, items: ["leggings"], treasure: true, neverRandom: true },
  sharpness: { weight: 10, items: ["sword", "axe", "spear"] },
  smite: { weight: 5, items: MELEE },
  bane_of_arthropods: { weight: 5, items: MELEE },
  knockback: { weight: 5, items: ["sword", "spear"] },
  fire_aspect: { weight: 2, items: ["sword", "spear", "mace"] },
  looting: { weight: 2, items: ["sword", "spear"] },
  lunge: { weight: 5, items: ["spear"] },
  density: { weight: 5, items: ["mace"] },
  breach: { weight: 2, items: ["mace"] },
  wind_burst: { weight: 2, items: ["mace"], treasure: true, neverRandom: true },
  efficiency: { weight: 10, items: [...TOOLS, "shears"] },
  silk_touch: { weight: 1, items: TOOLS },
  fortune: { weight: 2, items: TOOLS },
  unbreaking: { weight: 5, items: BREAKABLE },
  mending: { weight: 2, items: BREAKABLE, treasure: true },
  binding: { weight: 1, items: [...ARMOR, "elytra"], treasure: true, curse: true },
  vanishing: { weight: 1, items: BREAKABLE, treasure: true, curse: true },
  power: { weight: 10, items: ["bow"] },
  punch: { weight: 2, items: ["bow"] },
  flame: { weight: 2, items: ["bow"] },
  infinity: { weight: 1, items: ["bow"] },
  luck_of_the_sea: { weight: 2, items: ["fishing_rod"] },
  lure: { weight: 2, items: ["fishing_rod"] },
  loyalty: { weight: 5, items: ["trident"] },
  impaling: { weight: 2, items: ["trident"] },
  riptide: { weight: 2, items: ["trident"] },
  channeling: { weight: 1, items: ["trident"] },
  multishot: { weight: 2, items: ["crossbow"] },
  quick_charge: { weight: 5, items: ["crossbow"] },
  piercing: { weight: 10, items: ["crossbow"] },
};

// Enchantments in the same group can't be combined.
const EXCLUSIVE = [
  ["protection", "fire_protection", "blast_protection", "projectile_protection"],
  ["sharpness", "smite", "bane_of_arthropods", "density", "breach"],
  ["silk_touch", "fortune"],
  ["infinity", "mending"],
  ["riptide", "loyalty"],
  ["riptide", "channeling"],
  ["multishot", "piercing"],
  ["depth_strider", "frost_walker"],
];

export function vanillaConflict(a, b) {
  return a !== b && EXCLUSIVE.some((group) => group.includes(a) && group.includes(b));
}

// Vanilla enchantments loot and extra-enchantment rolls can pick (everything but Soul Speed, Swift
// Sneak and Wind Burst, which vanilla only gives in their own places).
export const RANDOM_VANILLA = Object.keys(VANILLA).filter((id) => !VANILLA[id].neverRandom);

// XP levels per enchantment level when an anvil applies a vanilla enchantment from a book, by rarity.
export function vanillaAnvilCost(id) {
  const weight = VANILLA[id]?.weight ?? 5;
  return weight >= 5 ? 1 : weight >= 2 ? 2 : 4;
}
