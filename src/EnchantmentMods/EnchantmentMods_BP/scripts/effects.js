import { world, system, EntityDamageCause, EquipmentSlot } from "@minecraft/server";
import { getAspect, hasFireAspect, isWeapon } from "./aspects.js";

// What the aspects do on a melee hit, like Fire Aspect: 4 seconds per level.
//   Frost Aspect  – the target freezes: Slowness III, snowflakes, and 1 freezing damage every 2 seconds.
//   Poison Aspect – the target gets Poison (undead are immune, as with any poison).

const SECONDS_PER_LEVEL = 4;
const MELEE_CAUSES = new Set([EntityDamageCause.entityAttack, EntityDamageCause.maceSmash]);
const FREEZE_IMMUNE = new Set(["minecraft:stray", "minecraft:polar_bear", "minecraft:snow_golem", "minecraft:wither"]);
const FREEZE_SLOWNESS = 2; // amplifier: Slowness III
const FREEZE_DAMAGE = 1;
const FREEZE_DAMAGE_TICKS = 40;
const FREEZE_FIRST_DAMAGE_TICKS = 20;
const PARTICLE_TICKS = 5;

const frozen = new Map(); // entity id -> { entity, endTick, nextDamageTick }

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

world.afterEvents.entityHurt.subscribe(({ hurtEntity, damageSource }) => {
  const attacker = damageSource.damagingEntity;
  if (!attacker || damageSource.damagingProjectile || !MELEE_CAUSES.has(damageSource.cause)) return;
  try {
    const weapon = attacker.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Mainhand);
    // An item with Fire Aspect loses its other aspect within a second; until then Fire Aspect wins.
    if (!isWeapon(weapon) || hasFireAspect(weapon)) return;
    const aspect = getAspect(weapon);
    if (!aspect || !hurtEntity.isValid) return;
    const ticks = SECONDS_PER_LEVEL * 20 * aspect.level;
    if (aspect.id === "poison") hurtEntity.addEffect("poison", ticks, { amplifier: 0 });
    else freeze(hurtEntity, ticks);
  } catch {
    // The target may have died from the hit, or the attacker has no equipment.
  }
});

system.runInterval(tickFrozen, 1);
