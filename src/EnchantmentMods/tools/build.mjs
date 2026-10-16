// Generates the parts of EnchantmentMods_BP that follow from scripts/enchantments.js:
//   items/                    – a book item for every level of every enchantment
//   item_catalog/             – the books' place and order in the creative inventory
//   loot_tables/              – vanilla loot tables where our books can turn up like vanilla ones
//   trading/economy_trades/   – the vanilla librarian trades with our books among the book trades
//
// Bedrock add-ons can only replace a loot table or trade table, not add to one, so those files are
// copies of the vanilla ones. When Minecraft updates them, rebuild from the matching bedrock-samples
// release (v1.26.50.4 was used for the current files):
//   node src/EnchantmentMods/tools/build.mjs <bedrock-samples behavior_pack folder>
//
// "Obtainable like vanilla enchantments": wherever vanilla can give an enchanted book, each of ours
// has the same chance as each vanilla enchantment there. Loot that picks the enchantment at random
// (enchant_randomly) gives every enchantment an equal share; loot made at an enchanting power
// (enchant_with_levels) picks by weight. Either way the book entry's weight is split between
// vanilla's enchantments and ours, so the chance of finding some enchanted book stays as it was.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ENCHANTMENTS, LIKE_VANILLA, LOOT_MARKERS, enchantLabel } from "../EnchantmentMods_BP/scripts/enchantments.js";
import { RANDOM_VANILLA, VANILLA } from "../EnchantmentMods_BP/scripts/vanilla.js";

// The structures and fishing, as the user listed them.
const LIKE_VANILLA_TABLES = [
  "chests/jungle_temple",
  "chests/stronghold_crossing", // storeroom
  "chests/stronghold_corridor", // altar
  "chests/stronghold_library",
  "chests/simple_dungeon",
  "chests/monster_room",
  "chests/abandoned_mineshaft",
  "chests/ancient_city",
  "chests/desert_pyramid",
  "chests/pillager_outpost",
  "chests/underwater_ruin_big",
  "chests/woodland_mansion",
  "gameplay/fishing/treasure",
];

// Mansion-only enchantments: their own pool in every woodland mansion chest.
const MANSION_ONLY = { life_steal: 0.05, strength_amplifier: 0.05 };

const SCALE = 1000; // loot weights are whole numbers; multiply everything to keep the split exact

const vanillaDir = process.argv[2];
if (!vanillaDir) {
  console.error("Usage: node build.mjs <bedrock-samples behavior_pack folder>");
  process.exit(1);
}
const bp = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "EnchantmentMods_BP");

function write(rel, data, { compact = false } = {}) {
  const file = path.join(bp, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, (compact ? JSON.stringify(data) : JSON.stringify(data, null, 2)) + "\n");
}

// Vanilla files may contain // comments.
function readVanilla(rel) {
  const text = fs.readFileSync(path.join(vanillaDir, rel), "utf8");
  return JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""));
}

for (const dir of ["items", "item_catalog", "loot_tables", "trading"]) {
  fs.rmSync(path.join(bp, dir), { recursive: true, force: true });
}

// ---- books -----------------------------------------------------------------------------------------

// The vanilla enchanted book texture, glint and yellow name, with the enchantment on the second line
// (gray, or red for a curse) just like a vanilla book's tooltip.
const bookIds = [];
for (const [id, ench] of Object.entries(ENCHANTMENTS)) {
  for (let level = 1; level <= ench.maxLevel; level++) {
    const identifier = `enchmods:${id}_book_${level}`;
    bookIds.push(identifier);
    write(`items/${id}_book_${level}.json`, {
      format_version: "1.21.60",
      "minecraft:item": {
        // No menu_category: item_catalog places the books.
        description: { identifier },
        components: {
          "minecraft:icon": { textures: { default: "enchmods_book" } },
          "minecraft:display_name": { value: `Enchanted Book\n${ench.curse ? "§c" : "§7"}${enchantLabel(id, level)}` },
          "minecraft:glint": true,
          "minecraft:rarity": "uncommon",
          "minecraft:max_stack_size": 1,
        },
      },
    });
  }
}
console.log(`${bookIds.length} book items`);

// After the vanilla enchanted books, in the order of ENCHANTMENTS, lowest level first. The creative
// inventory and its search both follow this order.
write("item_catalog/crafting_item_catalog.json", {
  format_version: "1.21.60",
  "minecraft:crafting_items_catalog": {
    categories: [
      {
        category_name: "items",
        groups: [{ group_identifier: { name: "minecraft:itemGroup.name.enchantedBook" }, items: bookIds }],
      },
    ],
  },
});

// ---- loot ------------------------------------------------------------------------------------------

const functionName = (f) => f.function.replace(/^minecraft:/, "");

// How the entry makes an enchanted book, or undefined if it isn't one we share.
function bookMode(entry) {
  if (entry.type !== "item" || entry.name !== "minecraft:book") return undefined;
  for (const f of entry.functions ?? []) {
    const name = functionName(f);
    if (name === "enchant_randomly") return { weighted: false, treasure: !!f.treasure };
    if (name === "enchant_with_levels") return { weighted: true, treasure: !!f.treasure };
  }
  return undefined; // plain books, and specific_enchants books (Swift Sneak in ancient cities)
}

// Each of ours that can be in this book, with its share of the book entry.
function customShares({ weighted, treasure }) {
  const ours = LIKE_VANILLA.filter((id) => treasure || !ENCHANTMENTS[id].curse);
  const theirs = RANDOM_VANILLA.filter((id) => treasure || !VANILLA[id].treasure);
  if (!weighted) return ours.map((id) => ({ id, share: 1 / (theirs.length + ours.length) }));
  const vanillaWeight = theirs.reduce((sum, id) => sum + VANILLA[id].weight, 0);
  const ourWeight = ours.reduce((sum, id) => sum + ENCHANTMENTS[id].weight, 0);
  return ours.map((id) => ({ id, share: ENCHANTMENTS[id].weight / (vanillaWeight + ourWeight) }));
}

const marker = (which) => ({ function: "set_lore", lore: [LOOT_MARKERS[which]] });

function shareBooks(table, name) {
  let shared = 0;
  for (const pool of table.pools) {
    const books = pool.entries.map(bookMode);
    if (!books.some(Boolean)) continue;
    const entries = [];
    pool.entries.forEach((entry, i) => {
      const weight = entry.weight ?? 1;
      const mode = books[i];
      if (!mode) {
        entries.push({ ...entry, weight: weight * SCALE });
        return;
      }
      const shares = customShares(mode);
      const ourShare = shares.reduce((sum, s) => sum + s.share, 0);
      // Books made at an enchanting power can carry more than one enchantment; the marker lets the
      // scripts add extras to ours, and ours to vanilla's, with vanilla's odds.
      const vanillaFunctions = mode.weighted ? [...entry.functions, marker("vanilla_book")] : entry.functions;
      entries.push({ ...entry, weight: Math.round(weight * SCALE * (1 - ourShare)), functions: vanillaFunctions });
      for (const { id, share } of shares) {
        const max = ENCHANTMENTS[id].maxLevel;
        for (let level = 1; level <= max; level++) {
          const custom = { type: "item", name: `enchmods:${id}_book_${level}`, weight: Math.max(1, Math.round((weight * SCALE * share) / max)) };
          if (mode.weighted) custom.functions = [marker("custom_book")];
          entries.push(custom);
        }
      }
      shared++;
      console.log(
        `${name}: ${shares.length} of ours share ${(ourShare * 100).toFixed(1)}% of the enchanted books` +
          (mode.weighted ? " (by weight, can carry extras)" : " (evenly, one enchantment each)")
      );
    });
    pool.entries = entries;
  }
  if (!shared) throw new Error(`${name}: no enchanted book entry found`);
}

for (const name of LIKE_VANILLA_TABLES) {
  const table = readVanilla(`loot_tables/${name}.json`);
  shareBooks(table, name);
  if (name === "chests/woodland_mansion") {
    for (const [id, chance] of Object.entries(MANSION_ONLY)) {
      const max = ENCHANTMENTS[id].maxLevel;
      const levels = Array.from({ length: max }, (_, i) => ({
        type: "item",
        name: `enchmods:${id}_book_${i + 1}`,
        weight: Math.round((chance * SCALE) / max),
      }));
      table.pools.push({ rolls: 1, entries: [...levels, { type: "empty", weight: SCALE - levels.reduce((a, e) => a + e.weight, 0) }] });
      console.log(`${name}: ${ENCHANTMENTS[id].name} book in ${chance * 100}% of chests, any level`);
    }
  }
  write(`loot_tables/${name}.json`, table);
}

// ---- librarians ------------------------------------------------------------------------------------

// Each librarian tier (novice to expert) has a slot that picks one trade at random from a list, one
// of which is the vanilla enchanted book. Trades can't be weighted, so the list is repeated: every
// other trade keeps its chance, and the book's chance is split evenly between every vanilla
// enchantment and each of ours, each of ours at an even spread of levels. Prices use vanilla's book
// formula: 2 + 3 × level emeralds plus up to 5 + 10 × level more, doubled for a curse, at most 64.
const TRADE_TIERS = [0, 1, 2, 3];
const LEVEL_SPREAD = 12; // divisible by every max level of ours (2, 3, 4)
const tradeCustom = LIKE_VANILLA;
const tradeVanilla = RANDOM_VANILLA.length;

function isBookTrade(trade) {
  return trade.gives.some((g) => (g.functions ?? []).some((f) => functionName(f) === "enchant_book_for_trading"));
}

function price(id, level) {
  const double = ENCHANTMENTS[id].curse ? 2 : 1;
  return { min: Math.min(64, (2 + 3 * level) * double), max: Math.min(64, (7 + 13 * level) * double) };
}

const tradeFile = "trading/economy_trades/librarian_trades.json";
const trades = readVanilla(tradeFile);
for (const tier of TRADE_TIERS) {
  const group = trades.tiers[tier].groups.find((g) => g.trades.some(isBookTrade));
  const book = group.trades.find(isBookTrade);
  const others = group.trades.filter((t) => t !== book);
  const copies = LEVEL_SPREAD * (tradeVanilla + tradeCustom.length);
  const list = [];
  for (const trade of others) for (let i = 0; i < copies; i++) list.push(trade);
  for (let i = 0; i < LEVEL_SPREAD * tradeVanilla; i++) list.push(book);
  for (const id of tradeCustom) {
    const max = ENCHANTMENTS[id].maxLevel;
    for (let level = 1; level <= max; level++) {
      const trade = {
        wants: [
          { item: "minecraft:emerald", quantity: price(id, level), price_multiplier: 0.2 },
          { item: "minecraft:book", quantity: 1, price_multiplier: 0.2 },
        ],
        gives: [{ item: `enchmods:${id}_book_${level}`, quantity: 1 }],
        trader_exp: book.trader_exp,
        max_uses: book.max_uses,
        reward_exp: book.reward_exp,
      };
      for (let i = 0; i < LEVEL_SPREAD / max; i++) list.push(trade);
    }
  }
  group.trades = list;
  const chanceBook = 1 / (others.length + 1);
  console.log(
    `librarian tier ${tier}: ${list.length} trade entries; each enchantment ${((chanceBook / (tradeVanilla + tradeCustom.length)) * 100).toFixed(2)}% per librarian`
  );
}
write(tradeFile, trades, { compact: true });
