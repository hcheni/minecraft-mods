import { world, system, EntityDamageCause, EquipmentSlot } from "@minecraft/server";
import { canGoOn } from "./enchantments.js";
import { getEnchants, getLevel, hasVanilla } from "./items.js";
import { addStatus, damageTakenMultiplier } from "./status.js";
import { startZap, zapDamage } from "./zap.js";

// What the combat enchantments do.
//   Frostbite            – on a melee hit the target freezes: Slowness III, snowflakes and 1 freezing
//                          damage every 2 seconds, for 4 seconds per level.
//   Venom                – on a melee hit, Poison for 4 seconds per level (undead are immune).
//   Weakening Touch      – on a melee hit, Weakness I for 4 seconds per level.
//   Withering            – on a melee hit, Wither I for 3 seconds per level.
//   Sticking             – on a melee hit, Sticking I for 4 seconds per level (see status.js).
//   Target               – on a melee hit, Target II for 3 seconds per level (see status.js).
//   Strength Surge       – your melee hits deal 15% more damage per level while you're below half health.
//   Strength Amplifier   – killing anything that isn't undead makes your melee hits deal 10% more damage
//                          per level for 5 seconds.
//   Zapping              – see zap.js.
//   Life Steal           – killing anything that isn't undead with a melee hit heals level + 1 health.
//                          Undead wielders don't heal; trident throws don't count.
//   Protection Surge     – you take 6% less damage per level while below half health. Levels on every
//                          worn piece add up, like vanilla Protection.
//   Knockback Protection – 8% less knockback per level from hits by mobs, players and projectiles.
//                          Levels on every worn piece add up, to at most 100%.

const MELEE_CAUSES = new Set([
  EntityDamageCause.entityAttack,
  EntityDamageCause.maceSmash,
  EntityDamageCause.charging, // spear charge
]);
const KNOCKBACK_CAUSES = new Set([...MELEE_CAUSES, EntityDamageCause.projectile, EntityDamageCause.ramAttack]);
const UNBLOCKABLE_CAUSES = new Set([EntityDamageCause.void, EntityDamageCause.selfDestruct, EntityDamageCause.override]);
const ARMOR_SLOTS = [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet];

const STRENGTH_PER_LEVEL = 0.15;
const AMPLIFIER_PER_LEVEL = 0.1;
const AMPLIFIER_TICKS = 100;
const PROTECTION_PER_LEVEL = 0.06;
const KNOCKBACK_PER_LEVEL = 0.08;

// Effects the aspects give: [effect, its amplifier, seconds per enchantment level].
const ASPECT_EFFECTS = {
  poison_aspect: ["poison", 0, 4],
  weakening_touch: ["weakness", 0, 4],
  wither_aspect: ["wither", 0, 3],
};
const ASPECT_STATUS = {
  sticking: ["sticking", 1, 4],
  target: ["target", 2, 3],
};
const FROST_SECONDS_PER_LEVEL = 4;
const FREEZE_IMMUNE = new Set(["minecraft:stray", "minecraft:polar_bear", "minecraft:snow_golem", "minecraft:wither"]);
const FREEZE_SLOWNESS = 2; // amplifier: Slowness III
const FREEZE_DAMAGE = 1;
const FREEZE_DAMAGE_TICKS = 40;
const FREEZE_FIRST_DAMAGE_TICKS = 20;
const PARTICLE_TICKS = 5;

const frozen = new Map(); // entity id -> { entity, endTick, nextDamageTick }
const amplified = new Map(); // entity id -> { level, endTick }

export function isMelee(damageSource) {
  return !damageSource.damagingProjectile && MELEE_CAUSES.has(damageSource.cause);
}

export function mainhand(entity) {
  try {
    return entity.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Mainhand);
  } catch {
    return undefined;
  }
}

// A mob that just died may no longer answer questions about its family, so the ids back that up.
const UNDEAD = new Set(
  [
    "zombie", "husk", "drowned", "zombie_villager", "zombie_villager_v2", "zombie_pigman", "zoglin", "skeleton",
    "stray", "wither_skeleton", "bogged", "parched", "phantom", "wither", "skeleton_horse", "zombie_horse",
    "camel_husk",
  ].map((id) => `minecraft:${id}`)
);

export function isUndead(entity) {
  if (UNDEAD.has(entity.typeId)) return true;
  try {
    return !!entity.getComponent("minecraft:type_family")?.hasTypeFamily("undead");
  } catch {
    return false;
  }
}

// Total levels of an armor enchantment across every piece the entity wears.
export function armorLevels(entity, id, slots = ARMOR_SLOTS) {
  let equippable;
  try {
    equippable = entity.getComponent("minecraft:equippable");
  } catch {
    return 0;
  }
  if (!equippable) return 0;
  let total = 0;
  for (const slot of slots) {
    try {
      const item = equippable.getEquipment(slot);
      if (item && canGoOn(id, item.typeId)) total += getLevel(item, id);
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
  if (hasVanilla(weapon, "fire_aspect")) return;
  const enchants = getEnchants(weapon);
  if (enchants.frost_aspect) {
    freeze(target, FROST_SECONDS_PER_LEVEL * 20 * enchants.frost_aspect);
    return;
  }
  for (const [id, [effect, amplifier, seconds]] of Object.entries(ASPECT_EFFECTS)) {
    if (enchants[id]) return void target.addEffect(effect, seconds * 20 * enchants[id], { amplifier });
  }
  for (const [id, [status, level, seconds]] of Object.entries(ASPECT_STATUS)) {
    if (enchants[id]) return void addStatus(target, status, level, seconds * 20 * enchants[id]);
  }
}

// Push back against part of the knockback the hit just gave.
function resistKnockback(entity, levels) {
  const share = Math.min(1, KNOCKBACK_PER_LEVEL * levels);
  const velocity = entity.getVelocity();
  entity.applyKnockback({ x: -velocity.x * share, z: -velocity.z * share }, velocity.y > 0 ? -velocity.y * share : 0);
}

function amplifierBonus(attacker) {
  const buff = amplified.get(attacker.id);
  return buff && buff.endTick > system.currentTick ? AMPLIFIER_PER_LEVEL * buff.level : 0;
}

// Strength Surge, Strength Amplifier, Target, Protection Surge and the first Zapping zap change the
// damage before it's dealt.
world.beforeEvents.entityHurt.subscribe((event) => {
  const { hurtEntity, damageSource } = event;
  let multiplier = damageTakenMultiplier(hurtEntity);
  let extra = 0;

  const attacker = damageSource.damagingEntity;
  if (attacker && isMelee(damageSource)) {
    multiplier *= 1 + amplifierBonus(attacker);
    const weapon = mainhand(attacker);
    if (weapon) {
      if (belowHalfHealth(attacker) && canGoOn("strength_surge", weapon.typeId)) {
        multiplier *= 1 + STRENGTH_PER_LEVEL * getLevel(weapon, "strength_surge");
      }
      const zapping = canGoOn("zapping", weapon.typeId) ? getLevel(weapon, "zapping") : 0;
      if (zapping) {
        // The mob you hit is the first one zapped; the chain carries on next tick.
        extra += zapDamage(zapping);
        const { id, dimension } = hurtEntity;
        const { x, y, z } = hurtEntity.location;
        system.run(() => startZap(attacker, id, zapping, { x, y: y + 0.9, z }, dimension));
      }
    }
  }

  if (!UNBLOCKABLE_CAUSES.has(damageSource.cause) && belowHalfHealth(hurtEntity)) {
    multiplier *= Math.max(0, 1 - PROTECTION_PER_LEVEL * armorLevels(hurtEntity, "protection_surge"));
  }

  if (multiplier !== 1 || extra) event.damage = event.damage * multiplier + extra;
});

world.afterEvents.entityHurt.subscribe(({ hurtEntity, damageSource }) => {
  const attacker = damageSource.damagingEntity;
  if (!attacker) return;
  try {
    if (!hurtEntity.isValid) return;
    if (isMelee(damageSource)) {
      const weapon = mainhand(attacker);
      if (weapon && canGoOn("frost_aspect", weapon.typeId)) applyAspect(hurtEntity, weapon);
    }
    if (KNOCKBACK_CAUSES.has(damageSource.cause)) {
      const levels = armorLevels(hurtEntity, "knockback_protection");
      if (levels > 0) resistKnockback(hurtEntity, levels);
    }
  } catch {
    // The target may have died from the hit.
  }
});

world.afterEvents.entityDie.subscribe(({ deadEntity, damageSource }) => {
  const killer = damageSource.damagingEntity;
  if (!killer?.isValid || isUndead(deadEntity)) return;
  const weapon = mainhand(killer);
  if (!weapon) return;

  const amplifier = canGoOn("strength_amplifier", weapon.typeId) ? getLevel(weapon, "strength_amplifier") : 0;
  if (amplifier) amplified.set(killer.id, { level: amplifier, endTick: system.currentTick + AMPLIFIER_TICKS });

  const lifeSteal = canGoOn("life_steal", weapon.typeId) ? getLevel(weapon, "life_steal") : 0;
  if (!lifeSteal || !isMelee(damageSource) || isUndead(killer)) return;
  try {
    const health = killer.getComponent("minecraft:health");
    if (health) health.setCurrentValue(Math.min(health.effectiveMax, health.currentValue + lifeSteal + 1));
  } catch {
    // The killer died at the same moment.
  }
});

system.runInterval(tickFrozen, 1);
