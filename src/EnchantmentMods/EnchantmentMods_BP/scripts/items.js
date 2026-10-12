import { ENCHANTMENTS, OLD_NAMES, RENAMED, canGoOn, enchantLabel, enchantLine } from "./enchantments.js";

// Bedrock has no custom enchantments, so ours live on the item as a dynamic property holding
// {"frost_aspect":2,"strength_surge":1} plus lore lines that read like vanilla enchantments.

const PROPERTY = "enchmods:enchants";
const OLD_PROPERTY = "enchmods:aspect"; // v1.0–1.1 stored one aspect as "frost:2"
const NAMES = [...Object.values(ENCHANTMENTS).map((e) => e.name), ...OLD_NAMES];
const LORE_LINE = new RegExp(`^§r§[7c](${NAMES.join("|")})( [IVX]+)?$`);
const BOOK = /^enchmods:(\w+)_book_(\d)$/;

// The enchantment a book carries, or undefined for anything that isn't one of our books.
export function bookEnchant(item) {
  const match = item && BOOK.exec(item.typeId);
  return match && ENCHANTMENTS[match[1]] ? { id: match[1], level: Number(match[2]) } : undefined;
}

// { id: level } for every enchantment of ours on the item.
export function getEnchants(item) {
  try {
    const value = item.getDynamicProperty(PROPERTY);
    if (typeof value === "string") {
      const stored = JSON.parse(value);
      return Object.fromEntries(Object.entries(stored).map(([id, level]) => [RENAMED[id] ?? id, level]));
    }
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
  item.setLore([...ids.map((id) => enchantLine(id, kept[id])), ...lore]);
}

export function vanillaName(id) {
  return id
    .split("_")
    .map((word) => (word === "of" ? word : word[0].toUpperCase() + word.slice(1)))
    .join(" ");
}

export function hasVanilla(item, id) {
  try {
    return !!item.getComponent("minecraft:enchantable")?.hasEnchantment(id);
  } catch {
    return false;
  }
}

// What the item's enchantments would become with this book, or why it can't take it. Same rules as
// vanilla books: equal levels merge into the next level, a higher level replaces a lower one.
export function combine(item, book) {
  const ench = ENCHANTMENTS[book.id];
  if (!canGoOn(book.id, item.typeId)) return { error: `${ench.name} can't go on this` };
  const enchants = getEnchants(item);
  for (const id of ench.vanillaConflicts ?? []) {
    if (hasVanilla(item, id)) return { error: `Can't be combined with ${vanillaName(id)}` };
  }
  if (ench.aspect) {
    const other = Object.keys(enchants).find((id) => id !== book.id && ENCHANTMENTS[id]?.aspect);
    if (other) return { error: `Already has ${enchantLabel(other, enchants[other])}` };
  }
  const current = enchants[book.id] ?? 0;
  const level = current === book.level ? Math.min(current + 1, ench.maxLevel) : Math.max(current, book.level);
  if (level === current) return { error: `Already has ${enchantLabel(book.id, current)}` };
  return { enchants: { ...enchants, [book.id]: level }, level };
}

export function itemName(item) {
  return item.nameTag || vanillaName(item.typeId.replace(/^minecraft:/, ""));
}
