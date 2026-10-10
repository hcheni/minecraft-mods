import { world, system, EquipmentSlot } from "@minecraft/server";

// The HUD data travels to the resource pack inside a hidden title.
// Layout (must match RP/ui/hud_screen.json):
//   "ahud:" (5 chars)
//   4 armor slots x [normal field (9 chars) + low-durability field (9 chars)]
//   effects text (variable length, starts at char 77)
const PREFIX = "ahud:";
const FIELD = 9;
const SLOTS = [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet];
const LOW_DURABILITY = 0.25; // at or below 25% the number turns red
const UPDATE_TICKS = 10; // refresh twice a second
const RESEND_TICKS = 100; // resend unchanged data every 5 seconds

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

function armorFields(item) {
  if (!item) return BLANK + BLANK;
  const durability = item.getComponent("minecraft:durability");
  if (!durability) return pad(" --") + BLANK; // e.g. a carved pumpkin or mob head
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
    payload += armorFields(equippable?.getEquipment(slot));
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
        stayDuration: 20,
        fadeOutDuration: 0,
      });
      lastSent.set(player.id, { payload, tick: system.currentTick });
    } catch {
      // Player may have left or not finished loading; try again next update.
    }
  }
}, UPDATE_TICKS);

// Force a fresh send when a player joins or respawns (their HUD starts empty).
world.afterEvents.playerSpawn.subscribe(({ player }) => lastSent.delete(player.id));
world.afterEvents.playerLeave.subscribe(({ playerId }) => lastSent.delete(playerId));
