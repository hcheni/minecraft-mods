import { world, system } from "@minecraft/server";

// Our own status effects. Add-ons can't register real effects, so these are kept here, shown to
// players above the hotbar with their icons from the pack's glyph font (font/glyph_E5.png), and shown
// on mobs with particles.
//   Sticking – 20% slower per level, and jumps barely leave the ground, like on a honey block. Only
//              the jump itself is cut: a wind charge or Wind Burst still throws you up, just
//              without the extra height jumping would add.
//   Target   – takes 20% more damage per level.
// Like vanilla effects, they all end when the player or mob dies, so nobody respawns with them.

export const STATUS = {
  sticking: { name: "Sticking", icon: "", particle: "minecraft:honey_drip_particle" },
  target: { name: "Target", icon: "", particle: "minecraft:redstone_ore_dust_particle" },
};
const ROMAN = ["", "I", "II", "III", "IV", "V"];
const SLOW_PER_LEVEL = 0.2;
const TARGET_PER_LEVEL = 0.2;
const JUMP_KEPT = 0.2; // share of a jump's upward speed left, like a honey block
const JUMP_START = 0.25; // upward speed that counts as leaving the ground
const JUMP_SPEED = 0.42; // upward speed a jump gives, plus 0.1 per Jump Boost level
const MOB_JUMP_MARGIN = 0.1; // a mob going up faster than its jump was launched, not jumping
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

// Ends one effect, undoing anything it changed on the entity. Every effect ends through here.
function endEffect(entry, effect) {
  delete entry.effects[effect];
  if (effect === "sticking") unslow(entry);
}

// Ends all of an entity's effects at once (when it dies).
export function clearStatus(entity) {
  const entry = active.get(entity.id);
  if (!entry) return;
  for (const effect of Object.keys(entry.effects)) endEffect(entry, effect);
  active.delete(entity.id);
  if (entity.typeId === "minecraft:player") {
    try {
      entity.onScreenDisplay.setActionBar("");
    } catch {
      // Left the game.
    }
  }
}

export function statusLevel(entity, id) {
  const effect = active.get(entity.id)?.effects[id];
  return effect && effect.endTick > system.currentTick ? effect.level : 0;
}

export function damageTakenMultiplier(entity) {
  return 1 + TARGET_PER_LEVEL * statusLevel(entity, "target");
}

function jumpSpeed(entity) {
  const boost = entity.getEffect("jump_boost");
  return JUMP_SPEED + (boost ? 0.1 * (boost.amplifier + 1) : 0);
}

// Takes away most of the jump's own upward speed as it leaves the ground. Players say whether they
// jumped; for a mob, going up faster than a jump means something launched it.
function cutJump(entry) {
  const { entity } = entry;
  const vy = entity.getVelocity().y;
  const leftGround = vy > JUMP_START && (entry.lastVy ?? 0) < 0.05;
  entry.lastVy = vy;
  if (!leftGround) return;
  const jump = jumpSpeed(entity);
  const jumping = entity.typeId === "minecraft:player" ? entity.isJumping : vy <= jump + MOB_JUMP_MARGIN;
  if (jumping) entity.applyKnockback({ x: 0, z: 0 }, -Math.min(vy, jump) * (1 - JUMP_KEPT));
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
        if (e.endTick <= now) endEffect(entry, effect);
      }
      if (!Object.keys(entry.effects).length) {
        active.delete(id);
        continue;
      }

      if (entry.effects.sticking) cutJump(entry);
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

world.afterEvents.entityDie.subscribe(({ deadEntity }) => clearStatus(deadEntity));

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  // Respawning: the effects were cleared at death; this catches a death the game didn't report.
  if (!initialSpawn) clearStatus(player);
  restoreSaved(player);
});
world.afterEvents.entityLoad.subscribe(({ entity }) => restoreSaved(entity));

system.runInterval(tick, 1);
