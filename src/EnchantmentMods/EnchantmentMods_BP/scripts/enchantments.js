// Every enchantment this pack adds. The scripts read this, and so does tools/build.js, which makes a
// book item for each level plus the chest, vault and villager loot. Keep this file free of imports so
// Node can load it too.
//
//   slot     – what it goes on: "weapon" (swords, spears, mace) or "armor" (helmets, chestplates,
//              leggings, boots)
//   aspect   – aspects are exclusive: an item can have only one, and vanilla Fire Aspect counts as one
//   anvilCost – XP levels per enchantment level when applying the book at an anvil

export const ENCHANTMENTS = {
  frost_aspect: { name: "Frost Aspect", maxLevel: 2, slot: "weapon", aspect: true, anvilCost: 2 },
  poison_aspect: { name: "Poison Aspect", maxLevel: 2, slot: "weapon", aspect: true, anvilCost: 2 },
  weakening_touch: { name: "Weakening Touch", maxLevel: 2, slot: "weapon", aspect: true, anvilCost: 2 },
  strength_surge: { name: "Strength Surge", maxLevel: 3, slot: "weapon", anvilCost: 4 },
  protection_surge: { name: "Protection Surge", maxLevel: 3, slot: "armor", anvilCost: 4 },
  knockback_resistance: { name: "Knockback Resistance", maxLevel: 4, slot: "armor", anvilCost: 2 },
};

export const ROMAN = ["", "I", "II", "III", "IV", "V"];

export function enchantLabel(id, level) {
  return `${ENCHANTMENTS[id].name} ${ROMAN[level]}`;
}
