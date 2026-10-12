// Builds EnchantmentMods_BP/loot_tables/chests/*.json: the vanilla chest loot tables with one extra
// pool that can add a Frost Aspect or Poison Aspect book.
//
// Bedrock add-ons can only replace a loot table, not add to it, so each file is a copy of the vanilla
// one. When Minecraft updates its chest loot, rebuild from the matching bedrock-samples release:
//   node src/EnchantmentMods/tools/build-loot.js <folder with bedrock-samples behavior_pack/loot_tables/chests>
// (bedrock-samples v1.26.50.4 was used for the current files.)

const fs = require("fs");
const path = require("path");

const CHESTS = [
  "simple_dungeon",
  "abandoned_mineshaft",
  "desert_pyramid",
  "jungle_temple",
  "stronghold_corridor",
  "stronghold_library",
  "igloo_chest",
  "ancient_city",
  "woodland_mansion",
  "end_city_treasure",
  "bastion_treasure",
];

// One roll per chest: a book 8 times in 40, so about 1 chest in 5, and level II a quarter of the time.
const BOOK_POOL = {
  rolls: 1,
  entries: [
    { type: "item", name: "enchmods:frost_aspect_book_1", weight: 3 },
    { type: "item", name: "enchmods:frost_aspect_book_2", weight: 1 },
    { type: "item", name: "enchmods:poison_aspect_book_1", weight: 3 },
    { type: "item", name: "enchmods:poison_aspect_book_2", weight: 1 },
    { type: "empty", weight: 32 },
  ],
};

const vanillaDir = process.argv[2];
if (!vanillaDir) {
  console.error("Usage: node build-loot.js <vanilla loot_tables/chests folder>");
  process.exit(1);
}
const outDir = path.join(__dirname, "..", "EnchantmentMods_BP", "loot_tables", "chests");
fs.mkdirSync(outDir, { recursive: true });

for (const chest of CHESTS) {
  const table = JSON.parse(fs.readFileSync(path.join(vanillaDir, `${chest}.json`), "utf8"));
  table.pools.push(BOOK_POOL);
  fs.writeFileSync(path.join(outDir, `${chest}.json`), JSON.stringify(table, null, 2) + "\n");
  console.log(`Wrote ${chest}.json`);
}
