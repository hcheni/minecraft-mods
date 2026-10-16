import { world, EntityDamageCause, EntitySwingSource, GameMode } from "@minecraft/server";
import { canGoOn } from "./enchantments.js";
import { getLevel, getVanilla } from "./items.js";

// Reach: melee attacks land 0.5 blocks farther per level.
//
// Add-ons can't change how far a player reaches. What a script can see is the swing, so when a player
// swings a Reach weapon and nothing is within normal reach, we look the extra distance along their
// view and hit the first mob there ourselves. The game doesn't tell scripts how much damage a
// weapon does, so that hit uses the weapon's normal damage from the table below, plus Sharpness,
// Strength and Weakness. Mining and using blocks or mobs farther away isn't possible for add-ons.

const NORMAL_REACH = 3;
const CREATIVE_REACH = 5;
const PER_LEVEL = 0.5;
const KNOCKBACK = 0.4;
const KNOCKBACK_UP = 0.3;
const NEVER_HIT = new Set(["minecraft:item", "minecraft:xp_orb", "minecraft:arrow", "minecraft:armor_stand"]);

// Attack damage by material; tools and weapons of the same material differ by a fixed amount.
const MATERIAL = { wooden: 0, golden: 0, stone: 1, copper: 1, iron: 2, diamond: 3, netherite: 4 };
const BASE = { sword: 5, spear: 4, axe: 4, pickaxe: 2, shovel: 2, hoe: 2 };
const SINGLE = { "minecraft:mace": 6, "minecraft:trident": 9 };

function weaponDamage(item) {
  if (SINGLE[item.typeId]) return SINGLE[item.typeId];
  const match = /^minecraft:(\w+?)_(sword|spear|axe|pickaxe|shovel|hoe)$/.exec(item.typeId);
  if (!match) return 1;
  return BASE[match[2]] + (MATERIAL[match[1]] ?? 0);
}

function attackDamage(player, item) {
  let damage = weaponDamage(item) + 1.25 * (getVanilla(item).sharpness ?? 0);
  const strength = player.getEffect("strength");
  if (strength) damage += 3 * (strength.amplifier + 1);
  const weakness = player.getEffect("weakness");
  if (weakness) damage -= 4 * (weakness.amplifier + 1);
  return Math.max(0.5, damage);
}

function canHit(entity, player) {
  if (entity.id === player.id || NEVER_HIT.has(entity.typeId)) return false;
  try {
    return !!entity.getComponent("minecraft:health");
  } catch {
    return false;
  }
}

world.afterEvents.playerSwingStart.subscribe(({ player, heldItemStack, swingSource }) => {
  if (swingSource !== EntitySwingSource.Attack || !heldItemStack || !canGoOn("reach", heldItemStack.typeId)) return;
  const level = getLevel(heldItemStack, "reach");
  if (!level) return;
  try {
    const normal = player.getGameMode() === GameMode.Creative ? CREATIVE_REACH : NORMAL_REACH;
    // Something within normal reach: the game's own attack handles it.
    if (player.getEntitiesFromViewDirection({ maxDistance: normal }).some(({ entity }) => canHit(entity, player))) return;
    const hit = player
      .getEntitiesFromViewDirection({ maxDistance: normal + PER_LEVEL * level })
      .find(({ entity }) => canHit(entity, player));
    if (!hit) return;
    const { entity } = hit;
    if (!entity.applyDamage(attackDamage(player, heldItemStack), { cause: EntityDamageCause.entityAttack, damagingEntity: player })) return;
    const view = player.getViewDirection();
    const length = Math.hypot(view.x, view.z) || 1;
    entity.applyKnockback({ x: (view.x / length) * KNOCKBACK, z: (view.z / length) * KNOCKBACK }, KNOCKBACK_UP);
  } catch {
    // The mob moved away or died.
  }
});
