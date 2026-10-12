// Generates the parts of EnchantmentMods_BP that follow from scripts/enchantments.js:
//   items/                    – a book item for every level of every enchantment
//   loot_tables/              – vanilla chest and vault loot tables with an extra pool for our books,
//                               and loot markers on the vault and End city weapons and armor
//   trading/economy_trades/   – the vanilla librarian trades plus our books
//
// Bedrock add-ons can only replace a loot table or trade table, not add to one, so those files are
// copies of the vanilla ones. When Minecraft updates them, rebuild from the matching bedrock-samples
// release (v1.26.50.4 was used for the current files):
//   node src/EnchantmentMods/tools/build.mjs <bedrock-samples behavior_pack folder>

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ENCHANTMENTS, LOOT_MARKERS, enchantLabel, itemKind } from "../EnchantmentMods_BP/scripts/enchantments.js";

const ASPECTS = ["frost_aspect", "poison_aspect", "weakening_touch", "wither_aspect"];
const SURGES = ["strength_surge", "protection_surge"];
const RARE = [...SURGES, "zapping", "life_steal"];
const TRIAL_CHESTS = ["corridor", "entrance", "intersection", "intersection_barrel", "supply"];

// Chance that a chest or vault holds a book of that enchantment (any level).
const CHANCE = { common: 0.2, uncommon: 0.1, rare: 0.04, extremely_rare: 0.01, almost_impossible: 0.003 };
// Each source maps enchantment ids to a rarity, or to [rarity, highest level found there].
const each = (ids, rarity) => Object.fromEntries(ids.map((id) => [id, rarity]));

const LOOT = [
  {
    // Trial vaults (opened with a trial key)
    tables: ["chests/trial_chambers/reward"],
    books: { knockback_protection: "common", ...each(ASPECTS, "rare"), breaking: "uncommon" },
  },
  {
    // Ominous vaults
    tables: ["chests/trial_chambers/reward_ominous"],
    books: { ...each(SURGES, "rare"), zapping: ["rare", 3], life_steal: "almost_impossible" },
  },
  {
    tables: ["chests/stronghold_library"],
    books: { ...each(SURGES, "rare"), ...each(ASPECTS, "uncommon"), zapping: ["extremely_rare", 2] },
  },
  {
    tables: ["chests/woodland_mansion"],
    books: { ...each(SURGES, "rare"), zapping: ["rare", 3] },
  },
  {
    // Trial chamber chests and barrels
    tables: TRIAL_CHESTS.map((name) => `chests/trial_chambers/${name}`),
    books: {
      ...each(SURGES, "extremely_rare"),
      ...each(ASPECTS, "rare"),
      knockback_protection: "rare",
      zapping: ["almost_impossible", 1],
    },
  },
  {
    tables: ["chests/pillager_outpost", "chests/desert_pyramid", "chests/jungle_temple"],
    books: { ...each(ASPECTS, "rare"), knockback_protection: "rare", breaking: "uncommon" },
  },
  {
    tables: ["chests/ancient_city"],
    books: { ...each(ASPECTS, "rare"), knockback_protection: "rare" },
  },
  {
    // Ocean ruins
    tables: ["chests/underwater_ruin_big", "chests/underwater_ruin_small"],
    books: { knockback_protection: "rare", breaking: "uncommon" },
  },
];

// Weapons and armor from these tables get a marker the scripts swap for a random enchantment
// (see LOOT_ROLLS in scripts/rolls.js). The vault tables pick from these sub-tables.
const MARKED = {
  end_city: ["chests/end_city_treasure"],
  trial_vault: ["chests/trial_chambers/reward_rare", "chests/trial_chambers/reward_unique"],
  ominous_vault: ["chests/trial_chambers/reward_ominous_rare", "chests/trial_chambers/reward_ominous_unique"],
};

// Librarian trades. Each list becomes a new trade slot at that tier (3 = expert, 4 = master); every
// librarian offers one book from it, picked at random. Life Steal is never sold.
const TRADES = [
  {
    tier: 3,
    traderExp: 15,
    books: [...ASPECTS.map((id) => [id, 1]), ["knockback_protection", 1], ["knockback_protection", 2], ["breaking", 1]],
  },
  {
    tier: 4,
    traderExp: 30,
    books: [
      ...ASPECTS.map((id) => [id, 2]), ["knockback_protection", 3], ["strength_surge", 1], ["protection_surge", 1],
      ["zapping", 1],
    ],
  },
];

function emeraldPrice(id, level) {
  if (ENCHANTMENTS[id].curse) return 3 + 4 * level;
  return Math.min(64, RARE.includes(id) ? 30 + 10 * level : 5 + 8 * level);
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
// second line (gray, or red for a curse) just like a vanilla book's tooltip. They sit with the
// vanilla enchanted books in the Items tab. The numbered file names keep them in the order of
// ENCHANTMENTS (by type), then by level.
let books = 0;
for (const [id, ench] of Object.entries(ENCHANTMENTS)) {
  for (let level = 1; level <= ench.maxLevel; level++) {
    books++;
    const color = ench.curse ? "§c" : "§7";
    write(`items/${String(books).padStart(2, "0")}_${id}_book_${level}.json`, {
      format_version: "1.21.60",
      "minecraft:item": {
        description: {
          identifier: `enchmods:${id}_book_${level}`,
          menu_category: { category: "items", group: "minecraft:itemGroup.name.enchantedBook" },
        },
        components: {
          "minecraft:icon": { textures: { default: "enchmods_book" } },
          "minecraft:display_name": { value: `Enchanted Book\n${color}${enchantLabel(id, level)}` },
          "minecraft:glint": true,
          "minecraft:rarity": "uncommon",
          "minecraft:max_stack_size": 1,
        },
      },
    });
  }
}
console.log(`${books} book items`);

const tables = new Map(); // path -> table data, so a table can get both a book pool and markers

function table(rel) {
  if (!tables.has(rel)) tables.set(rel, readVanilla(`loot_tables/${rel}.json`));
  return tables.get(rel);
}

// One extra pool per table. Lower levels are more likely: level k of n gets weight n - k + 1.
const SCALE = 10000;
for (const { tables: names, books: sources } of LOOT) {
  const entries = [];
  for (const [id, source] of Object.entries(sources)) {
    const [rarity, cap] = Array.isArray(source) ? source : [source, ENCHANTMENTS[id].maxLevel];
    const max = Math.min(cap, ENCHANTMENTS[id].maxLevel);
    const levelWeights = Array.from({ length: max }, (_, i) => max - i);
    const total = levelWeights.reduce((a, b) => a + b, 0);
    levelWeights.forEach((w, i) => {
      const weight = Math.round((CHANCE[rarity] * SCALE * w) / total);
      if (weight > 0) entries.push({ type: "item", name: `enchmods:${id}_book_${i + 1}`, weight });
    });
  }
  const used = entries.reduce((a, e) => a + e.weight, 0);
  const pool = { rolls: 1, entries: [...entries, { type: "empty", weight: SCALE - used }] };
  for (const name of names) {
    table(name).pools.push(pool);
    console.log(`${name}: a book ${((used / SCALE) * 100).toFixed(1)}% of the time`);
  }
}

for (const [source, names] of Object.entries(MARKED)) {
  for (const name of names) {
    let marked = 0;
    for (const pool of table(name).pools) {
      for (const entry of pool.entries) {
        if (entry.type !== "item" || !itemKind(entry.name)) continue;
        entry.functions = [...(entry.functions ?? []), { function: "set_lore", lore: [LOOT_MARKERS[source]] }];
        marked++;
      }
    }
    console.log(`${name}: ${marked} weapon/armor entries marked as ${source}`);
  }
}

for (const [name, data] of tables) write(`loot_tables/${name}.json`, data);

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
