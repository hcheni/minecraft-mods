import { EntityDamageCause } from "@minecraft/server";

// Zapping: the mob you hit is zapped, then the zap jumps to mobs within 3 blocks of any zapped mob,
// and from those to mobs within 3 blocks of them, until 3 × level mobs are zapped or nothing is left
// in reach. Each zap deals level + 1 damage, and each mob is zapped once. Players (including you),
// tamed pets and villagers are never jumped to.
//
// The bolts are drawn with the pack's enchmods:zap particle: one down from the sky onto each zapped
// mob, and an arc from the mob the zap jumped from.

const RANGE = 3;
const MOBS_PER_LEVEL = 3;
const PARTICLE = "enchmods:zap";
const PARTICLES_PER_BLOCK = 4;
const BOLT_HEIGHT = 7;
const BOLT_JITTER = 0.35;
const NEVER_ZAP = [
  "minecraft:player", "minecraft:villager", "minecraft:villager_v2", "minecraft:wandering_trader",
  "minecraft:armor_stand", "minecraft:item", "minecraft:xp_orb",
];

export function zapDamage(level) {
  return level + 1;
}

function canZap(entity) {
  try {
    if (!entity.getComponent("minecraft:health")) return false;
    return !entity.getComponent("minecraft:tameable")?.isTamed;
  } catch {
    return false;
  }
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function middle(entity) {
  const { x, y, z } = entity.location;
  return { x, y: y + 0.9, z };
}

// A jagged line of particles from one point to another.
function drawBolt(dimension, from, to) {
  const length = distance(from, to);
  const steps = Math.max(2, Math.ceil(length * PARTICLES_PER_BLOCK));
  let offset = { x: 0, z: 0 };
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Wander sideways, pulled back to the line at both ends.
    const pull = Math.sin(Math.PI * t);
    offset = {
      x: (offset.x + (Math.random() - 0.5) * BOLT_JITTER) * pull,
      z: (offset.z + (Math.random() - 0.5) * BOLT_JITTER) * pull,
    };
    try {
      dimension.spawnParticle(PARTICLE, {
        x: from.x + (to.x - from.x) * t + offset.x,
        y: from.y + (to.y - from.y) * t,
        z: from.z + (to.z - from.z) * t + offset.z,
      });
    } catch {
      return; // Outside loaded chunks.
    }
  }
}

function strike(dimension, target, from) {
  const top = { x: target.x, y: target.y + BOLT_HEIGHT, z: target.z };
  drawBolt(dimension, top, target);
  if (from) drawBolt(dimension, from, target);
  try {
    dimension.playSound("ambient.weather.lightning.impact", target, { volume: 0.4, pitch: 1.6 });
  } catch {
    // Sounds are only decoration.
  }
}

// firstId: the mob that was hit (its zap damage was added to the hit itself). firstLocation is taken
// before the hit, since a mob the hit kills may already be gone.
export function startZap(attacker, firstId, level, firstLocation, dimension) {
  const max = MOBS_PER_LEVEL * level;
  const damage = zapDamage(level);
  const seen = new Set([firstId, attacker.id]);
  const zapped = [{ location: firstLocation }];
  strike(dimension, firstLocation);

  for (let i = 0; i < zapped.length && zapped.length < max; i++) {
    const from = zapped[i].location;
    let nearby;
    try {
      nearby = dimension.getEntities({ location: from, maxDistance: RANGE, excludeTypes: NEVER_ZAP });
    } catch {
      continue;
    }
    nearby = nearby
      .filter((entity) => !seen.has(entity.id) && canZap(entity))
      .sort((a, b) => distance(a.location, from) - distance(b.location, from));
    for (const entity of nearby) {
      if (zapped.length >= max) break;
      seen.add(entity.id);
      const location = middle(entity);
      zapped.push({ location });
      strike(dimension, location, from);
      try {
        const options = { cause: EntityDamageCause.lightning };
        if (attacker.isValid) options.damagingEntity = attacker;
        entity.applyDamage(damage, options);
      } catch {
        // It died or unloaded in the meantime.
      }
    }
  }
}
