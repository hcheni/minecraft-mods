import { world, system } from "@minecraft/server";

// Floating damage numbers: when a player hurts a mob or another player, show the health the target
// actually lost, after armor, enchantments and effects, as a number that floats up above it.
//
// The hurt event's own damage value isn't documented as before or after armor, so we measure:
// every tick we remember the health of entities near players, and on a hit we compare.

const TEXT_ENTITY = "ahud:damage_text";
const TRACK_RADIUS = 32; // blocks around each player
const TEXT_TICKS = 20; // how long a number stays up
const RISE_PER_TICK = 0.04; // blocks
const SKIP_TYPES = [TEXT_ENTITY, "minecraft:item", "minecraft:xp_orb", "minecraft:arrow", "minecraft:armor_stand"];

// entity id -> the last two health readings, so a hit can use one taken before that tick.
const healthLog = new Map(); // id -> { tick, health, prevTick, prevHealth }
const floating = []; // { entity, ticksLeft }

function readHealth(entity) {
  try {
    return entity.getComponent("minecraft:health")?.currentValue;
  } catch {
    return undefined;
  }
}

function recordHealth() {
  const tick = system.currentTick;
  const seen = new Set();
  for (const player of world.getAllPlayers()) {
    let nearby;
    try {
      nearby = player.dimension.getEntities({ location: player.location, maxDistance: TRACK_RADIUS, excludeTypes: SKIP_TYPES });
    } catch {
      continue;
    }
    for (const entity of nearby) {
      if (seen.has(entity.id)) continue;
      seen.add(entity.id);
      const health = readHealth(entity);
      if (health === undefined) continue;
      const log = healthLog.get(entity.id);
      healthLog.set(entity.id, { tick, health, prevTick: log?.tick ?? -1, prevHealth: log?.health });
    }
  }
  // Forget entities that died or moved away.
  if (tick % 100 === 0) {
    for (const [id, log] of healthLog) if (tick - log.tick > 100) healthLog.delete(id);
  }
}

// Health from a reading taken before this tick (the current tick's reading may already include the hit).
function healthBefore(entityId, tick) {
  const log = healthLog.get(entityId);
  if (!log) return undefined;
  if (log.tick < tick) return log.health;
  if (log.prevTick >= 0 && log.prevTick < tick) return log.prevHealth;
  return undefined;
}

function formatDamage(amount) {
  const rounded = Math.round(amount * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function showNumber(target, amount) {
  try {
    const head = target.getHeadLocation();
    const location = {
      x: head.x + (Math.random() - 0.5) * 0.6,
      y: head.y + 0.6,
      z: head.z + (Math.random() - 0.5) * 0.6,
    };
    const text = target.dimension.spawnEntity(TEXT_ENTITY, location);
    text.nameTag = `§c§l-${formatDamage(amount)}`;
    floating.push({ entity: text, ticksLeft: TEXT_TICKS });
  } catch {
    // The target may be in an unloaded chunk or already gone.
  }
}

function moveNumbers() {
  for (let i = floating.length - 1; i >= 0; i--) {
    const item = floating[i];
    item.ticksLeft--;
    try {
      if (!item.entity.isValid) {
        floating.splice(i, 1);
        continue;
      }
      if (item.ticksLeft <= 0) {
        item.entity.remove();
        floating.splice(i, 1);
        continue;
      }
      const { x, y, z } = item.entity.location;
      item.entity.teleport({ x, y: y + RISE_PER_TICK, z });
    } catch {
      floating.splice(i, 1);
    }
  }
}

world.afterEvents.entityHurt.subscribe(({ hurtEntity, damage, damageSource }) => {
  if (hurtEntity.typeId === TEXT_ENTITY) return;
  if (damageSource.damagingEntity?.typeId !== "minecraft:player") return;

  const tick = system.currentTick;
  const before = healthBefore(hurtEntity.id, tick);
  const after = readHealth(hurtEntity) ?? 0;
  const lost = before !== undefined ? before - after : 0;

  // Health went down: that's the final damage. If it didn't (absorption hearts soaked the hit) or we had
  // no earlier reading, fall back to the game's own number.
  const amount = lost > 0.05 ? lost : damage;
  if (amount > 0) showNumber(hurtEntity, amount);

  const log = healthLog.get(hurtEntity.id);
  if (log) healthLog.set(hurtEntity.id, { ...log, tick, health: after, prevTick: log.tick, prevHealth: log.health });
});

system.runInterval(() => {
  recordHealth();
  moveNumbers();
}, 1);
