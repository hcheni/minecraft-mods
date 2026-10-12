import { EnchantmentTypes } from "@minecraft/server";
import { ENCHANTMENTS, LOOT_MARKERS, ROMAN, canGoOn } from "./enchantments.js";
import { bookEnchant, combine, getEnchants, hasVanilla, setEnchants, vanillaName } from "./items.js";

// Random enchantments: for the enchanting table, mob gear, vault and End city loot, and the extra
// vanilla enchantments a Breaking book can carry.

const ALL = Object.keys(ENCHANTMENTS);
const LOOT_ROLLS = {
  end_city: { chance: 0.35, ids: ALL },
  trial_vault: { chance: 0.35, ids: ALL.filter((id) => !["strength_surge", "protection_surge", "life_steal", "zapping"].includes(id)) },
  ominous_vault: { chance: 0.35, ids: ALL },
};

// Lower levels are more likely: level k of n has weight n - k + 1.
export function rollLevel(maxLevel) {
  const weights = Array.from({ length: maxLevel }, (_, i) => maxLevel - i);
  let pick = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < maxLevel; i++) {
    pick -= weights[i];
    if (pick < 0) return i + 1;
  }
  return 1;
}

// Adds one random enchantment from ids that the item can take. caps limits levels: { zapping: 2 }.
// Returns the id added, or undefined.
export function addRandomEnchant(item, ids, caps = {}) {
  const candidates = ids.filter((id) => canGoOn(id, item.typeId));
  while (candidates.length) {
    const [id] = candidates.splice(Math.floor(Math.random() * candidates.length), 1);
    const result = combine(item, { id, level: rollLevel(Math.min(ENCHANTMENTS[id].maxLevel, caps[id] ?? 9)) });
    if (result.error) continue;
    setEnchants(item, result.enchants);
    return id;
  }
  return undefined;
}

// Swaps a loot marker for (maybe) a random enchantment. Returns true if the item changed.
export function resolveLootMarker(item) {
  const lore = item.getLore();
  const source = Object.keys(LOOT_MARKERS).find((key) => lore.includes(LOOT_MARKERS[key]));
  if (!source) return false;
  item.setLore(lore.filter((line) => !Object.values(LOOT_MARKERS).includes(line)));
  const { chance, ids } = LOOT_ROLLS[source];
  if (Math.random() < chance) addRandomEnchant(item, ids);
  return true;
}

// A Breaking book can come with low-level vanilla enchantments too, rolled the first time anyone
// sees the book and kept as a dynamic property plus lore lines.
const EXTRAS = "enchmods:extras";
const EXTRA_CHANCE = [0.4, 0.15]; // one extra, then a second
const EXTRA_POOL = [
  "protection", "fire_protection", "feather_falling", "blast_protection", "projectile_protection", "respiration",
  "aqua_affinity", "thorns", "depth_strider", "sharpness", "smite", "bane_of_arthropods", "knockback", "looting",
  "efficiency", "fortune", "power", "punch", "flame", "luck_of_the_sea", "lure", "loyalty", "impaling",
  "riptide", "multishot", "quick_charge", "piercing", "density", "breach", "wind_burst",
];

export function rollBookExtras(book) {
  if (!ENCHANTMENTS[bookEnchant(book)?.id]?.curse || book.getDynamicProperty(EXTRAS) !== undefined) return false;
  const extras = [];
  for (const chance of EXTRA_CHANCE) {
    if (Math.random() >= chance) break;
    const choices = EXTRA_POOL.filter((id) => !extras.some((e) => e.id === id) && EnchantmentTypes.get(id));
    const id = choices[Math.floor(Math.random() * choices.length)];
    const maxLevel = EnchantmentTypes.get(id).maxLevel;
    extras.push({ id, level: maxLevel >= 4 ? Math.ceil(Math.random() * 2) : 1 });
  }
  book.setDynamicProperty(EXTRAS, JSON.stringify(extras));
  if (extras.length) {
    book.setLore([...extras.map((e) => `§r§7${vanillaName(e.id)}${EnchantmentTypes.get(e.id).maxLevel > 1 ? ` ${ROMAN[e.level]}` : ""}`), ...book.getLore()]);
  }
  return true;
}

export function getBookExtras(book) {
  try {
    return JSON.parse(book.getDynamicProperty(EXTRAS) ?? "[]");
  } catch {
    return [];
  }
}

// Adds the book's extra vanilla enchantments that the item can take (like the vanilla anvil, the
// others are skipped, including ones that clash with our enchantments). Returns the names added.
export function applyBookExtras(item, extras) {
  const enchantable = item.getComponent("minecraft:enchantable");
  if (!enchantable) return [];
  const blocked = Object.keys(getEnchants(item)).flatMap((id) => ENCHANTMENTS[id]?.vanillaConflicts ?? []);
  const added = [];
  for (const { id, level } of extras) {
    const type = EnchantmentTypes.get(id);
    if (!type || hasVanilla(item, id) || blocked.includes(id)) continue;
    const enchantment = { type, level };
    try {
      if (!enchantable.canAddEnchantment(enchantment)) continue;
      enchantable.addEnchantment(enchantment);
      added.push(`${vanillaName(id)}${type.maxLevel > 1 ? ` ${ROMAN[level]}` : ""}`);
    } catch {
      // Not compatible with this item after all.
    }
  }
  return added;
}
