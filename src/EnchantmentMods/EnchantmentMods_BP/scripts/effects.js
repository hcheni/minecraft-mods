import { world, system, EntityDamageCause, EquipmentSlot } from "@minecraft/server";
import { getEnchants, getLevel, hasFireAspect, itemSlot } from "./items.js";

// What the enchantments do.
//   Frost Aspect         – on a melee hit the target freezes: Slowness III, snowflakes and 1 freezing
//                          damage every 2 seconds, for 4 seconds per level.
//   Poison Aspect        – on a melee hit, Poison for 4 seconds per level (undead are immune).
//   Weakening Touch      – on a melee hit, Weakness I for 4 seconds per level.
//   Strength Surge       – your melee hits deal 15% more damage per level while you're below half health.
//   Protection Surge     – you take 6% less damage per level while below half health. Levels on every
//                          worn piece add up, like vanilla Protection.
//   Knockback Resistance – 8% less knockback per level from hits by mobs, players and projectiles.
//                          Levels on every worn piece add up, to at most 100%.

const SECONDS_PER_LEVEL = 4;
const MELEE_CAUSES = new Set([
  EntityDamageCause.entityAttack,
  EntityDamageCause.maceSmash,
  EntityDamageCause.charging, // spear charge
]);
const KNOCKBACK_CAUSES = new Set([...MELEE_CAUSES, EntityDamageCause.projectile, EntityDamageCause.ramAttack]);
const UNBLOCKABLE_CAUSES = new Set([EntityDamageCause.void, EntityDamageCause.selfDestruct, EntityDamageCause.override]);
const ARMOR_SLOTS = [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet];

const STRENGTH_PER_LEVEL = 0.15;
const PROTECTION_PER_LEVEL = 0.06;
const KNOCKBACK_PER_LEVEL = 0.08;

const FREEZE_IMMUNE = new Set(["minecraft:stray", "minecraft:polar_bear", "minecraft:snow_golem", "minecraft:wither"]);
const FREEZE_SLOWNESS = 2; // amplifier: Slowness III
const FREEZE_DAMAGE = 1;
const FREEZE_DAMAGE_TICKS = 40;
const FREEZE_FIRST_DAMAGE_TICKS = 20;
const PARTICLE_TICKS = 5;

const frozen = new Map(); // entity id -> { entity, endTick, nextDamageTick }

function mainhand(entity) {
  try {
    return entity.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Mainhand);
  } catch {
    return undefined;
  }
}

// Total levels of an armor enchantment across every piece the entity wears.
function armorLevels(entity, id) {
  let equippable;
  try {
    equippable = entity.getComponent("minecraft:equippable");
  } catch {
    return 0;
  }
  if (!equippable) return 0;
  let total = 0;
  for (const slot of ARMOR_SLOTS) {
    try {
      const item = equippable.getEquipment(slot);
      if (itemSlot(item) === "armor") total += getLevel(item, id);
    } catch {
      // Not every mob has every slot.
    }
  }
  return total;
}

function belowHalfHealth(entity) {
  try {
    const health = entity.getComponent("minecraft:health");
    return !!health && health.currentValue < health.effectiveMax / 2;
  } catch {
    return false;
  }
}

function freeze(entity, ticks) {
  if (FREEZE_IMMUNE.has(entity.typeId)) return;
  const now = system.currentTick;
  const entry = frozen.get(entity.id);
  if (entry) entry.endTick = Math.max(entry.endTick, now + ticks);
  else frozen.set(entity.id, { entity, endTick: now + ticks, nextDamageTick: now + FREEZE_FIRST_DAMAGE_TICKS });
  entity.addEffect("slowness", ticks, { amplifier: FREEZE_SLOWNESS });
}

function tickFrozen() {
  const now = system.currentTick;
  for (const [id, entry] of frozen) {
    const { entity } = entry;
    try {
      if (!entity.isValid || now >= entry.endTick) {
        frozen.delete(id);
        continue;
      }
      if (now % PARTICLE_TICKS === 0) {
        const { x, y, z } = entity.location;
        entity.dimension.spawnParticle("minecraft:snowflake_particle", { x, y: y + 1, z });
      }
      if (now >= entry.nextDamageTick) {
        entry.nextDamageTick = now + FREEZE_DAMAGE_TICKS;
        entity.applyDamage(FREEZE_DAMAGE, { cause: EntityDamageCause.freezing });
      }
    } catch {
      frozen.delete(id);
    }
  }
}

function applyAspect(target, weapon) {
  // An item with Fire Aspect loses our aspect within a second; until then Fire Aspect wins.
  if (hasFireAspect(weapon)) return;
  const enchants = getEnchants(weapon);
  const levelOf = (id) => enchants[id] ?? 0;
  if (levelOf("poison_aspect")) {
    target.addEffect("poison", SECONDS_PER_LEVEL * 20 * levelOf("poison_aspect"), { amplifier: 0 });
  } else if (levelOf("weakening_touch")) {
    target.addEffect("weakness", SECONDS_PER_LEVEL * 20 * levelOf("weakening_touch"), { amplifier: 0 });
  } else if (levelOf("frost_aspect")) {
    freeze(target, SECONDS_PER_LEVEL * 20 * levelOf("frost_aspect"));
  }
}

// Push back against part of the knockback the hit just gave.
function resistKnockback(entity, levels) {
  const share = Math.min(1, KNOCKBACK_PER_LEVEL * levels);
  const velocity = entity.getVelocity();
  entity.applyKnockback({ x: -velocity.x * share, z: -velocity.z * share }, velocity.y > 0 ? -velocity.y * share : 0);
}

// Strength Surge and Protection Surge change the damage before it's dealt.
world.beforeEvents.entityHurt.subscribe((event) => {
  const { hurtEntity, damageSource } = event;
  let multiplier = 1;

  const attacker = damageSource.damagingEntity;
  if (attacker && !damageSource.damagingProjectile && MELEE_CAUSES.has(damageSource.cause) && belowHalfHealth(attacker)) {
    const weapon = mainhand(attacker);
    if (itemSlot(weapon) === "weapon") multiplier *= 1 + STRENGTH_PER_LEVEL * getLevel(weapon, "strength_surge");
  }

  if (!UNBLOCKABLE_CAUSES.has(damageSource.cause) && belowHalfHealth(hurtEntity)) {
    const levels = armorLevels(hurtEntity, "protection_surge");
    multiplier *= Math.max(0, 1 - PROTECTION_PER_LEVEL * levels);
  }

  if (multiplier !== 1) event.damage *= multiplier;
});

world.afterEvents.entityHurt.subscribe(({ hurtEntity, damageSource }) => {
  const attacker = damageSource.damagingEntity;
  if (!attacker) return;
  try {
    if (!hurtEntity.isValid) return;
    if (!damageSource.damagingProjectile && MELEE_CAUSES.has(damageSource.cause)) {
      const weapon = mainhand(attacker);
      if (itemSlot(weapon) === "weapon") applyAspect(hurtEntity, weapon);
    }
    if (KNOCKBACK_CAUSES.has(damageSource.cause)) {
      const levels = armorLevels(hurtEntity, "knockback_resistance");
      if (levels > 0) resistKnockback(hurtEntity, levels);
    }
  } catch {
    // The target may have died from the hit.
  }
});

system.runInterval(tickFrozen, 1);
