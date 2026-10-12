import { world, system, EntityInitializationCause, EquipmentSlot } from "@minecraft/server";
import { itemKind } from "./enchantments.js";
import { addRandomEnchant } from "./rolls.js";

// Weapons and armor that mobs spawn with (zombies, skeletons, piglins…) can come with our
// enchantments: each piece has a chance to get one that fits it.

const GEAR_CHANCE = 0.15;
const MOB_IDS = [
  "frost_aspect", "poison_aspect", "weakening_touch", "wither_aspect",
  "strength_surge", "protection_surge", "knockback_protection", "breaking",
];
const SLOTS = [EquipmentSlot.Mainhand, EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet];
// Gear is handed out as the mob spawns; give it a moment.
const DELAY_TICKS = 2;

function enchantGear(entity) {
  if (!entity.isValid) return;
  const equippable = entity.getComponent("minecraft:equippable");
  if (!equippable) return;
  for (const slot of SLOTS) {
    const item = equippable.getEquipment(slot);
    if (!item || !itemKind(item.typeId) || Math.random() >= GEAR_CHANCE) continue;
    if (addRandomEnchant(item, MOB_IDS)) equippable.setEquipment(slot, item);
  }
}

world.afterEvents.entitySpawn.subscribe(({ entity, cause }) => {
  // Only new mobs: "Loaded" means an old one coming back from a saved chunk.
  if (cause !== EntityInitializationCause.Spawned || entity.typeId === "minecraft:player") return;
  system.runTimeout(() => {
    try {
      enchantGear(entity);
    } catch {
      // Not a mob that wears equipment.
    }
  }, DELAY_TICKS);
});
