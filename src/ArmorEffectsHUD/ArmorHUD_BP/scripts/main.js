import { world, system, EquipmentSlot } from "@minecraft/server";
import { GLYPHS } from "./glyphs.js";
import "./damage.js";

// The finished HUD travels to the resource pack inside a hidden title: "ahud:" followed by the
// text to show. Icons are characters from the pack's icon font (see glyphs.js).
const VERSION = "1.9";
const PREFIX = "ahud:";
const SLOTS = [
  { slot: EquipmentSlot.Head, empty: "empty_helmet" },
  { slot: EquipmentSlot.Chest, empty: "empty_chestplate" },
  { slot: EquipmentSlot.Legs, empty: "empty_leggings" },
  { slot: EquipmentSlot.Feet, empty: "empty_boots" },
  { slot: EquipmentSlot.Offhand, empty: "empty_offhand" },
];
const LOW_DURABILITY = 0.25; // at or below 25% the number turns red
const UPDATE_TICKS = 10; // refresh twice a second
const RESEND_TICKS = 100; // resend unchanged data every 5 seconds
const TITLE_STAY_TICKS = 200; // longer than RESEND_TICKS so the HUD never blinks out

// Item ids whose icon name differs from the id.
const ITEM_ICONS = {
  totem_of_undying: "totem",
  firework_rocket: "fireworks",
  empty_map: "map_filled",
  filled_map: "map_filled",
  nautilus_shell: "nautilus",
};
const EFFECT_ICONS = { fatal_poison: "poison" };

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

function isEnchanted(item) {
  try {
    return (item.getComponent("minecraft:enchantable")?.getEnchantments().length ?? 0) > 0;
  } catch {
    return false;
  }
}

function itemIcon(item, emptyIcon) {
  if (!item) return GLYPHS[emptyIcon];
  const id = item.typeId.replace("minecraft:", "");
  const name = ITEM_ICONS[id] ?? id.replace(/^golden_/, "gold_");
  const enchanted = isEnchanted(item) ? GLYPHS[`${name}_enchanted`] : undefined;
  // Armor from other add-ons has no icon: show the slot outline.
  return enchanted ?? GLYPHS[name] ?? GLYPHS[emptyIcon];
}

function itemText(item) {
  if (!item) return "";
  const durability = item.getComponent("minecraft:durability");
  if (!durability) {
    // Totems, arrows, fireworks: show how many are left. Single items show just the icon.
    return item.maxAmount > 1 ? `§fx${item.amount}` : "";
  }
  const max = durability.maxDurability;
  const left = max - durability.damage;
  return `${left / max <= LOW_DURABILITY ? "§c" : "§f"}${left}/${max}`;
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
  return effects.map((e) => {
    const id = e.typeId.replace("minecraft:", "");
    const icon = GLYPHS[`effect_${EFFECT_ICONS[id] ?? id}`] ?? " ";
    const color = BAD_EFFECTS.has(id) ? "§c" : "§b";
    const level = ROMAN[e.amplifier] ?? ` ${e.amplifier + 1}`;
    return `§f${icon} ${color}${effectName(e.typeId)}${level} §f${formatTime(e.duration)}`;
  });
}

function buildPayload(player) {
  const equippable = player.getComponent("minecraft:equippable");
  const lines = SLOTS.map(({ slot, empty }) => {
    const item = equippable?.getEquipment(slot);
    return `§f${itemIcon(item, empty)} ${itemText(item)}`;
  });
  const effects = effectLines(player);
  if (effects.length) lines.push("", ...effects);
  return PREFIX + lines.join("\n");
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
