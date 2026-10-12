import { ENCHANTMENTS, enchantLabel } from "./enchantments.js";

// Bedrock has no custom enchantments, so ours live on the item as a dynamic property holding
// {"frost_aspect":2,"strength_surge":1} plus gray lore lines that read like vanilla enchantments.

const PROPERTY = "enchmods:enchants";
const OLD_PROPERTY = "enchmods:aspect"; // v1.0–1.1 stored one aspect as "frost:2"
const LORE_PREFIX = "§r§7";
const LORE_LINE = new RegExp(`^§r§7(${Object.values(ENCHANTMENTS).map((e) => e.name).join("|")}) [IVX]+$`);
const WEAPON = /^minecraft:(\w+_sword|\w+_spear|mace)$/;
const ARMOR = /^minecraft:\w+_(helmet|chestplate|leggings|boots)$/;
const BOOK = /^enchmods:(\w+)_book_(\d)$/;

// "weapon", "armor", or undefined for items our enchantments can't go on.
export function itemSlot(item) {
  if (!item) return undefined;
  if (WEAPON.test(item.typeId)) return "weapon";
  if (ARMOR.test(item.typeId)) return "armor";
  return undefined;
}

// The enchantment a book carries, or undefined for anything that isn't one of our books.
export function bookEnchant(item) {
  const match = item && BOOK.exec(item.typeId);
  return match && ENCHANTMENTS[match[1]] ? { id: match[1], level: Number(match[2]) } : undefined;
}

// { id: level } for every enchantment of ours on the item.
export function getEnchants(item) {
  try {
    const value = item.getDynamicProperty(PROPERTY);
    if (typeof value === "string") return JSON.parse(value);
    const old = item.getDynamicProperty(OLD_PROPERTY);
    if (typeof old === "string") {
      const [aspect, level] = old.split(":");
      return { [`${aspect}_aspect`]: Number(level) };
    }
  } catch {
    // Not an item that can hold dynamic properties, or the value is damaged.
  }
  return {};
}

export function getLevel(item, id) {
  return item ? getEnchants(item)[id] ?? 0 : 0;
}

// Writes the enchantments on the item, removing ours that aren't listed. Call setItem/setEquipment after.
export function setEnchants(item, enchants) {
  const ids = Object.keys(ENCHANTMENTS).filter((id) => enchants[id] > 0);
  const kept = Object.fromEntries(ids.map((id) => [id, enchants[id]]));
  item.setDynamicProperty(PROPERTY, ids.length ? JSON.stringify(kept) : undefined);
  item.setDynamicProperty(OLD_PROPERTY, undefined);
  const lore = item.getLore().filter((line) => !LORE_LINE.test(line));
  item.setLore([...ids.map((id) => LORE_PREFIX + enchantLabel(id, kept[id])), ...lore]);
}

export function hasFireAspect(item) {
  try {
    return !!item.getComponent("minecraft:enchantable")?.hasEnchantment("fire_aspect");
  } catch {
    return false;
  }
}

// The aspect on the item (ours or vanilla Fire Aspect), as an id, or undefined.
export function aspectOn(item, enchants = getEnchants(item)) {
  if (hasFireAspect(item)) return "fire_aspect";
  return Object.keys(enchants).find((id) => ENCHANTMENTS[id]?.aspect);
}

// What the item's enchantments would become with this book, or why it can't take it. Same rules as
// vanilla books: equal levels merge into the next level, a higher level replaces a lower one.
export function combine(item, book) {
  const ench = ENCHANTMENTS[book.id];
  if (itemSlot(item) !== ench.slot) return { error: `${ench.name} can't go on this` };
  const enchants = getEnchants(item);
  const current = enchants[book.id] ?? 0;
  if (ench.aspect) {
    const aspect = aspectOn(item, enchants);
    if (aspect === "fire_aspect") return { error: "Already has Fire Aspect" };
    if (aspect && aspect !== book.id) return { error: `Already has ${enchantLabel(aspect, enchants[aspect])}` };
  }
  const level = current === book.level ? Math.min(current + 1, ench.maxLevel) : Math.max(current, book.level);
  if (level === current) return { error: `Already has ${enchantLabel(book.id, current)}` };
  return { enchants: { ...enchants, [book.id]: level }, level };
}

export function itemName(item) {
  if (item.nameTag) return item.nameTag;
  return item.typeId
    .replace(/^minecraft:/, "")
    .split("_")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}
