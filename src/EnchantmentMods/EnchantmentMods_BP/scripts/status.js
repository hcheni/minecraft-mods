import { world, system } from "@minecraft/server";

// Our own status effects. Add-ons can't register real effects, so these are kept here, shown to
// players above the hotbar with their icons from the pack's glyph font (font/glyph_E5.png), and shown
// on mobs with particles.
//   Sticking – 20% slower per level, and jumps barely leave the ground, like on a honey block.
//   Target   – takes 20% more damage per level.

export const STATUS = {
  sticking: { name: "Sticking", icon: "", particle: "minecraft:honey_drip_particle" },
  target: { name: "Target", icon: "", particle: "minecraft:redstone_ore_dust_particle" },
};
const ROMAN = ["", "I", "II", "III", "IV", "V"];
const SLOW_PER_LEVEL = 0.2;
const TARGET_PER_LEVEL = 0.2;
const JUMP_KEPT = 0.2; // share of a jump's upward speed left, like a honey block
const JUMP_START = 0.25; // upward speed that counts as a jump starting
const PARTICLE_TICKS = 8;
const DISPLAY_TICKS = 10;
const SAVED_MOVEMENT = "enchmods:movement"; // speed before Sticking, in case the player leaves or the mob unloads

const active = new Map(); // entity id -> { entity, effects: { sticking?: { level, endTick }, target?: … }, lastVy, baseMovement }

function movement(entity) {
  try {
    return entity.getComponent("minecraft:movement");
  } catch {
    return undefined;
  }
}

function slow(entry, level) {
  const component = movement(entry.entity);
  if (!component) return;
  entry.baseMovement ??= component.currentValue;
  component.setCurrentValue(entry.baseMovement * (1 - SLOW_PER_LEVEL * level));
  entry.entity.setDynamicProperty(SAVED_MOVEMENT, entry.baseMovement);
}

function unslow(entry) {
  if (entry.baseMovement === undefined) return;
  try {
    movement(entry.entity)?.setCurrentValue(entry.baseMovement);
    entry.entity.setDynamicProperty(SAVED_MOVEMENT, undefined);
  } catch {
    // Gone.
  }
  entry.baseMovement = undefined;
}

// Gives the effect, keeping whichever of the old and new is stronger or lasts longer.
export function addStatus(entity, id, level, ticks) {
  let entry = active.get(entity.id);
  if (!entry) {
    entry = { entity, effects: {} };
    active.set(entity.id, entry);
  }
  const now = system.currentTick;
  const old = entry.effects[id];
  entry.effects[id] = {
    level: Math.max(level, old?.level ?? 0),
    endTick: Math.max(now + ticks, old?.endTick ?? 0),
  };
  if (id === "sticking") slow(entry, entry.effects.sticking.level);
}

export function statusLevel(entity, id) {
  const effect = active.get(entity.id)?.effects[id];
  return effect && effect.endTick > system.currentTick ? effect.level : 0;
}

export function damageTakenMultiplier(entity) {
  return 1 + TARGET_PER_LEVEL * statusLevel(entity, "target");
}

function formatTime(ticks) {
  const seconds = Math.ceil(ticks / 20);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function show(entry, now) {
  const parts = Object.entries(entry.effects).map(
    ([id, e]) => `${STATUS[id].icon} §f${STATUS[id].name} ${ROMAN[e.level]} §7${formatTime(e.endTick - now)}`
  );
  if (parts.length) entry.entity.onScreenDisplay.setActionBar(parts.join("   "));
}

function tick() {
  const now = system.currentTick;
  for (const [id, entry] of active) {
    const { entity } = entry;
    try {
      if (!entity.isValid) {
        active.delete(id);
        continue;
      }
      for (const [effect, e] of Object.entries(entry.effects)) {
        if (e.endTick > now) continue;
        delete entry.effects[effect];
        if (effect === "sticking") unslow(entry);
      }
      if (!Object.keys(entry.effects).length) {
        active.delete(id);
        continue;
      }

      if (entry.effects.sticking) {
        // Cut a jump down as it starts.
        const vy = entity.getVelocity().y;
        if (vy > JUMP_START && (entry.lastVy ?? 0) < 0.05) entity.applyKnockback({ x: 0, z: 0 }, -vy * (1 - JUMP_KEPT));
        entry.lastVy = vy;
      }
      if (now % PARTICLE_TICKS === 0) {
        const { x, y, z } = entity.location;
        for (const effect of Object.keys(entry.effects)) {
          entity.dimension.spawnParticle(STATUS[effect].particle, { x: x + (Math.random() - 0.5) * 0.6, y: y + 1 + Math.random() * 0.6, z: z + (Math.random() - 0.5) * 0.6 });
        }
      }
      if (entity.typeId === "minecraft:player" && now % DISPLAY_TICKS === 0) show(entry, now);
    } catch {
      active.delete(id);
    }
  }
}

// A player who left, or a mob that unloaded, while slowed gets its speed back when it returns.
function restoreSaved(entity) {
  try {
    const saved = entity.getDynamicProperty(SAVED_MOVEMENT);
    if (typeof saved !== "number" || active.has(entity.id)) return;
    movement(entity)?.setCurrentValue(saved);
    entity.setDynamicProperty(SAVED_MOVEMENT, undefined);
  } catch {
    // Try again next time.
  }
}

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (initialSpawn) restoreSaved(player);
});
world.afterEvents.entityLoad.subscribe(({ entity }) => restoreSaved(entity));

system.runInterval(tick, 1);
