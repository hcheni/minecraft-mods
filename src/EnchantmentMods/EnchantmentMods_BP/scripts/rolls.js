import { ENCHANTMENTS, LIKE_VANILLA, LOOT_MARKERS, MULTI_POWER } from "./enchantments.js";
import { bookEnchant, conflictIn, getEnchants, getVanilla, isVanillaBook, makeBook, vanillaMax } from "./items.js";
import { RANDOM_VANILLA } from "./vanilla.js";

// Random enchantments for found books.
//
// Loot that makes books at enchanting power 30 (jungle temples, strongholds, fishing) can give vanilla
// books more than one enchantment. Our books found there, and the vanilla books themselves, get extra
// enchantments with the same odds vanilla uses: after the first, another is added with chance
// (power + 1) / 50, and the power halves each time (about 64% for a second one at power 30).

// Ours that can turn up as an extra: everything but the mansion-only ones.
const EXTRA_CUSTOM = LIKE_VANILLA;
// v1.3 marked vault and End city gear this way; those lines are just removed now.
const OLD_MARKERS = ["§e§m§1", "§e§m§2", "§e§m§3"];

export function randomLevel(max) {
  return 1 + Math.floor(Math.random() * max);
}

export function pickWeighted(entries) {
  let pick = Math.random() * entries.reduce((sum, e) => sum + e.weight, 0);
  for (const entry of entries) {
    pick -= entry.weight;
    if (pick < 0) return entry;
  }
  return entries.at(-1);
}

// How many extra enchantments a book made at this power gets.
export function extraCount(power = MULTI_POWER) {
  let level = Math.round((power + 1) * (1 + (Math.random() + Math.random() - 1) * 0.15));
  let count = 0;
  while (Math.random() * 50 < level + 1) {
    count++;
    level = Math.floor(level / 2);
  }
  return count;
}

// Adds one random enchantment (any of ours that can be found, or any random-loot vanilla one) that
// isn't on the set yet and doesn't clash with it. customOnly limits it to ours.
export function addRandomExtra(set, customOnly = false) {
  const candidates = [
    ...EXTRA_CUSTOM.filter((id) => !set.custom[id]).map((id) => ({ custom: true, id })),
    ...(customOnly ? [] : RANDOM_VANILLA.filter((id) => !set.vanilla[id]).map((id) => ({ custom: false, id }))),
  ];
  while (candidates.length) {
    const [pick] = candidates.splice(Math.floor(Math.random() * candidates.length), 1);
    const custom = { ...set.custom };
    const vanilla = { ...set.vanilla };
    if (pick.custom) custom[pick.id] = randomLevel(ENCHANTMENTS[pick.id].maxLevel);
    else vanilla[pick.id] = randomLevel(vanillaMax(pick.id));
    if (conflictIn(custom, vanilla)) continue;
    set.custom = custom;
    set.vanilla = vanilla;
    return true;
  }
  return false;
}

// Acts on a loot marker. Returns the item to put back (maybe a new one), or undefined if the item
// has no marker.
export function resolveLootMarker(item) {
  let lore;
  try {
    lore = item.getLore();
  } catch {
    return undefined;
  }
  if (lore.some((line) => OLD_MARKERS.includes(line))) {
    item.setLore(lore.filter((line) => !OLD_MARKERS.includes(line)));
    return item;
  }
  const marker = Object.values(LOOT_MARKERS).find((m) => lore.includes(m));
  if (!marker) return undefined;
  const set = { custom: getEnchants(item), vanilla: getVanilla(item) };
  const extras = extraCount();

  if (marker === LOOT_MARKERS.custom_book && bookEnchant(item)) {
    for (let i = 0; i < extras; i++) addRandomExtra(set);
    return makeBook(set);
  }
  if (marker === LOOT_MARKERS.vanilla_book && isVanillaBook(item) && extras > 0) {
    // The first extra is one of ours; any more can be ours or vanilla.
    addRandomExtra(set, true);
    for (let i = 1; i < extras; i++) addRandomExtra(set);
    return makeBook(set);
  }
  item.setLore(lore.filter((line) => line !== marker));
  return item;
}
