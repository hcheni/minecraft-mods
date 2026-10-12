// Bedrock has no custom enchantments, so an aspect lives on the weapon as a dynamic property
// ("frost:2") plus a gray lore line that reads like a vanilla enchantment.

export const ASPECTS = {
  frost: { name: "Frost Aspect", maxLevel: 2 },
  poison: { name: "Poison Aspect", maxLevel: 2 },
};
const ROMAN = ["", "I", "II", "III"];
const PROPERTY = "enchmods:aspect";
const LORE_PREFIX = "§r§7";
const LORE_LINE = /^§r§7(Frost|Poison) Aspect /;
const WEAPON = /^minecraft:(\w+_sword|\w+_spear|mace)$/;
const BOOK = /^enchmods:(frost|poison)_aspect_book_(\d)$/;

export function aspectLabel(aspect) {
  return `${ASPECTS[aspect.id].name} ${ROMAN[aspect.level]}`;
}

// The aspect a book carries, or undefined for anything that isn't one of our books.
export function bookAspect(item) {
  const match = item && BOOK.exec(item.typeId);
  return match ? { id: match[1], level: Number(match[2]) } : undefined;
}

export function isWeapon(item) {
  return !!item && WEAPON.test(item.typeId);
}

export function getAspect(item) {
  let value;
  try {
    value = item.getDynamicProperty(PROPERTY);
  } catch {
    return undefined;
  }
  if (typeof value !== "string") return undefined;
  const [id, level] = value.split(":");
  return ASPECTS[id] ? { id, level: Number(level) } : undefined;
}

// Writes the aspect (or clears it when aspect is undefined) on the item. Call container.setItem after.
export function setAspect(item, aspect) {
  item.setDynamicProperty(PROPERTY, aspect ? `${aspect.id}:${aspect.level}` : undefined);
  const lore = item.getLore().filter((line) => !LORE_LINE.test(line));
  if (aspect) lore.unshift(LORE_PREFIX + aspectLabel(aspect));
  item.setLore(lore);
}

export function hasFireAspect(item) {
  try {
    return !!item.getComponent("minecraft:enchantable")?.hasEnchantment("fire_aspect");
  } catch {
    return false;
  }
}

export function itemName(item) {
  if (item.nameTag) return item.nameTag;
  return item.typeId
    .replace(/^minecraft:/, "")
    .split("_")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}
