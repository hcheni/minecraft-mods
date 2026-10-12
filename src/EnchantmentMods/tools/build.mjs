// Generates the parts of EnchantmentMods_BP that follow from scripts/enchantments.js:
//   items/                    – a book item for every level of every enchantment
//   loot_tables/              – vanilla chest and vault loot tables with an extra pool for our books
//   trading/economy_trades/   – the vanilla librarian trades plus our books
//
// Bedrock add-ons can only replace a loot table or trade table, not add to one, so those files are
// copies of the vanilla ones. When Minecraft updates them, rebuild from the matching bedrock-samples
// release (v1.26.50.4 was used for the current files):
//   node src/EnchantmentMods/tools/build.mjs <bedrock-samples behavior_pack folder>

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ENCHANTMENTS, enchantLabel } from "../EnchantmentMods_BP/scripts/enchantments.js";

const ASPECTS = ["frost_aspect", "poison_aspect", "weakening_touch"];
const SURGES = ["strength_surge", "protection_surge"];
const TRIAL_CHESTS = ["corridor", "entrance", "intersection", "intersection_barrel", "supply"];

// Chance that a chest or vault holds a book of that enchantment (any level).
const CHANCE = { common: 0.2, uncommon: 0.1, rare: 0.04, extremely_rare: 0.01 };
const each = (ids, rarity) => Object.fromEntries(ids.map((id) => [id, rarity]));

const LOOT = [
  {
    // Trial vaults (opened with a trial key)
    tables: ["chests/trial_chambers/reward"],
    books: { knockback_resistance: "common", ...each(ASPECTS, "rare") },
  },
  {
    // Ominous vaults
    tables: ["chests/trial_chambers/reward_ominous"],
    books: each(SURGES, "rare"),
  },
  {
    tables: ["chests/stronghold_library"],
    books: { ...each(SURGES, "rare"), ...each(ASPECTS, "uncommon") },
  },
  {
    tables: ["chests/woodland_mansion"],
    books: each(SURGES, "rare"),
  },
  {
    // Trial chamber chests and barrels
    tables: TRIAL_CHESTS.map((name) => `chests/trial_chambers/${name}`),
    books: { ...each(SURGES, "extremely_rare"), ...each(ASPECTS, "rare"), knockback_resistance: "rare" },
  },
];

// Librarian trades. Each list becomes a new trade slot at that tier (3 = expert, 4 = master); every
// librarian offers one book from it, picked at random.
const TRADES = [
  {
    tier: 3,
    traderExp: 15,
    books: [["frost_aspect", 1], ["poison_aspect", 1], ["weakening_touch", 1], ["knockback_resistance", 1], ["knockback_resistance", 2]],
  },
  {
    tier: 4,
    traderExp: 30,
    books: [
      ["frost_aspect", 2], ["poison_aspect", 2], ["weakening_touch", 2], ["knockback_resistance", 3],
      ["strength_surge", 1], ["protection_surge", 1],
    ],
  },
];

function emeraldPrice(id, level) {
  const rare = SURGES.includes(id);
  return Math.min(64, rare ? 30 + 10 * level : 5 + 8 * level);
}

const vanillaDir = process.argv[2];
if (!vanillaDir) {
  console.error("Usage: node build.mjs <bedrock-samples behavior_pack folder>");
  process.exit(1);
}
const bp = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "EnchantmentMods_BP");

function write(rel, data) {
  const file = path.join(bp, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

// Vanilla files may contain // comments.
function readVanilla(rel) {
  const text = fs.readFileSync(path.join(vanillaDir, rel), "utf8");
  return JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""));
}

for (const dir of ["items", "loot_tables", "trading"]) fs.rmSync(path.join(bp, dir), { recursive: true, force: true });

// Book items: the vanilla enchanted book texture, glint and yellow name, with the enchantment on the
// gray second line, just like a vanilla book's tooltip.
let books = 0;
for (const [id, ench] of Object.entries(ENCHANTMENTS)) {
  for (let level = 1; level <= ench.maxLevel; level++) {
    write(`items/${id}_book_${level}.json`, {
      format_version: "1.21.60",
      "minecraft:item": {
        description: {
          identifier: `enchmods:${id}_book_${level}`,
          menu_category: { category: "equipment", group: "minecraft:itemGroup.name.enchantedBook" },
        },
        components: {
          "minecraft:icon": { textures: { default: "enchmods_book" } },
          "minecraft:display_name": { value: `Enchanted Book\n§7${enchantLabel(id, level)}` },
          "minecraft:glint": true,
          "minecraft:rarity": "uncommon",
          "minecraft:max_stack_size": 1,
        },
      },
    });
    books++;
  }
}
console.log(`${books} book items`);

// One extra pool per table. Lower levels are more likely: level k of n gets weight n - k + 1.
const SCALE = 10000;
for (const { tables, books: sources } of LOOT) {
  const entries = [];
  for (const [id, rarity] of Object.entries(sources)) {
    const max = ENCHANTMENTS[id].maxLevel;
    const levelWeights = Array.from({ length: max }, (_, i) => max - i);
    const total = levelWeights.reduce((a, b) => a + b, 0);
    levelWeights.forEach((w, i) => {
      const weight = Math.round((CHANCE[rarity] * SCALE * w) / total);
      if (weight > 0) entries.push({ type: "item", name: `enchmods:${id}_book_${i + 1}`, weight });
    });
  }
  const used = entries.reduce((a, e) => a + e.weight, 0);
  const pool = { rolls: 1, entries: [...entries, { type: "empty", weight: SCALE - used }] };
  for (const table of tables) {
    const data = readVanilla(`loot_tables/${table}.json`);
    data.pools.push(pool);
    write(`loot_tables/${table}.json`, data);
    console.log(`loot_tables/${table}.json: a book ${((used / SCALE) * 100).toFixed(0)}% of the time`);
  }
}

const tradeFile = "trading/economy_trades/librarian_trades.json";
const trades = readVanilla(tradeFile);
for (const { tier, traderExp, books: list } of TRADES) {
  trades.tiers[tier].groups.push({
    num_to_select: 1,
    trades: list.map(([id, level]) => ({
      wants: [
        { item: "minecraft:emerald", quantity: emeraldPrice(id, level), price_multiplier: 0.2 },
        { item: "minecraft:book", quantity: 1 },
      ],
      gives: [{ item: `enchmods:${id}_book_${level}`, quantity: 1 }],
      trader_exp: traderExp,
      max_uses: 12,
      reward_exp: true,
    })),
  });
}
write(tradeFile, trades);
console.log(`${tradeFile}: ${TRADES.map((t) => `${t.books.length} books at tier ${t.tier}`).join(", ")}`);
