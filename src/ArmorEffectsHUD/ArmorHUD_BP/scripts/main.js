import { world, system, EquipmentSlot } from "@minecraft/server";

// The HUD data travels to the resource pack inside a hidden title.
// Layout (must match tools/build-hud.js):
//   "ahud:" (5 chars)
//   5 slots (4 armor + off hand) x [item code (1) + normal field (9) + low-durability field (9)]
//   effects text (variable length, starts at char 100)
const VERSION = "1.2";
const PREFIX = "ahud:";
const FIELD = 9;
const SLOTS = [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet, EquipmentSlot.Offhand];
const LOW_DURABILITY = 0.25; // at or below 25% the number turns red
const UPDATE_TICKS = 10; // refresh twice a second
const RESEND_TICKS = 100; // resend unchanged data every 5 seconds
const TITLE_STAY_TICKS = 200; // longer than RESEND_TICKS so the HUD never blinks out

// Item material -> one-letter code the resource pack maps to an icon.
const MATERIAL_CODES = {
  leather: "L",
  chainmail: "C",
  iron: "I",
  golden: "G",
  diamond: "D",
  netherite: "N",
  copper: "K",
};

// Whole item id -> code, checked before the material prefix (off-hand items mostly).
const ITEM_CODES = {
  turtle_helmet: "T",
  elytra: "E",
  shield: "S",
  totem_of_undying: "U",
  arrow: "A",
  firework_rocket: "F",
  empty_map: "M",
  filled_map: "M",
  nautilus_shell: "H",
};

const EFFECT_NAMES = {
  speed: "Speed",
  slowness: "Slowness",
  haste: "Haste",
  mining_fatigue: "Mining Fatigue",
  strength: "Strength",
  instant_health: "Instant Health",
  instant_damage: "Instant Damage",
  jump_boost: "Jump Boost",
  nausea: "Nausea",
  regeneration: "Regeneration",
  resistance: "Resistance",
  fire_resistance: "Fire Resistance",
  water_breathing: "Water Breathing",
  invisibility: "Invisibility",
  blindness: "Blindness",
  night_vision: "Night Vision",
  hunger: "Hunger",
  weakness: "Weakness",
  poison: "Poison",
  wither: "Wither",
  health_boost: "Health Boost",
  absorption: "Absorption",
  saturation: "Saturation",
  levitation: "Levitation",
  fatal_poison: "Fatal Poison",
  conduit_power: "Conduit Power",
  slow_falling: "Slow Falling",
  bad_omen: "Bad Omen",
  village_hero: "Hero of the Village",
  darkness: "Darkness",
  trial_omen: "Trial Omen",
  wind_charged: "Wind Charged",
  weaving: "Weaving",
  oozing: "Oozing",
  infested: "Infested",
  raid_omen: "Raid Omen",
};

const BAD_EFFECTS = new Set([
  "slowness", "mining_fatigue", "instant_damage", "nausea", "blindness", "hunger", "weakness",
  "poison", "wither", "fatal_poison", "levitation", "bad_omen", "darkness", "trial_omen",
  "raid_omen", "infested", "oozing", "weaving", "wind_charged",
]);

const ROMAN = ["", " II", " III", " IV", " V", " VI", " VII", " VIII", " IX", " X"];

const lastSent = new Map(); // player.id -> { payload, tick }

function pad(text) {
  text = text.slice(0, FIELD);
  return text + " ".repeat(FIELD - text.length);
}
const BLANK = pad("");

function itemCode(item) {
  if (!item) return "-";
  const id = item.typeId.replace("minecraft:", "");
  return ITEM_CODES[id] ?? MATERIAL_CODES[id.split("_")[0]] ?? "X";
}

function itemFields(item) {
  if (!item) return BLANK + BLANK;
  const durability = item.getComponent("minecraft:durability");
  if (!durability) {
    // Totems, arrows, fireworks: show how many are left. Single items show just the icon.
    return (item.maxAmount > 1 ? pad(`x${item.amount}`) : BLANK) + BLANK;
  }
  const max = durability.maxDurability;
  const left = max - durability.damage;
  const text = pad(`${left}/${max}`);
  return left / max <= LOW_DURABILITY ? BLANK + text : text + BLANK;
}

function formatTime(ticks) {
  if (ticks < 0 || ticks >= 20 * 60 * 60 * 24) return "**:**"; // infinite effect
  const seconds = Math.ceil(ticks / 20);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function effectName(typeId) {
  const id = typeId.replace("minecraft:", "");
  return (
    EFFECT_NAMES[id] ??
    id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function effectLines(player) {
  const effects = player.getEffects().filter((e) => e.duration !== 0);
  effects.sort((a, b) => a.duration - b.duration);
  return effects
    .map((e) => {
      const id = e.typeId.replace("minecraft:", "");
      const color = BAD_EFFECTS.has(id) ? "§c" : "§b";
      const level = ROMAN[e.amplifier] ?? ` ${e.amplifier + 1}`;
      return `${color}${effectName(e.typeId)}${level} §f${formatTime(e.duration)}`;
    })
    .join("\n");
}

function buildPayload(player) {
  const equippable = player.getComponent("minecraft:equippable");
  let payload = PREFIX;
  for (const slot of SLOTS) {
    const item = equippable?.getEquipment(slot);
    payload += itemCode(item) + itemFields(item);
  }
  return payload + effectLines(player);
}

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    try {
      const payload = buildPayload(player);
      const prev = lastSent.get(player.id);
      if (prev && prev.payload === payload && system.currentTick - prev.tick < RESEND_TICKS) continue;
      player.onScreenDisplay.setTitle(payload, {
        fadeInDuration: 0,
        stayDuration: TITLE_STAY_TICKS,
        fadeOutDuration: 0,
      });
      lastSent.set(player.id, { payload, tick: system.currentTick });
    } catch {
      // Player may have left or not finished loading; try again next update.
    }
  }
}, UPDATE_TICKS);

// Force a fresh send when a player joins or respawns (their HUD starts empty).
// The chat line on joining confirms the script is running.
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  lastSent.delete(player.id);
  if (initialSpawn) player.sendMessage(`§7[Armor HUD] v${VERSION} active`);
});
world.afterEvents.playerLeave.subscribe(({ playerId }) => lastSent.delete(playerId));
