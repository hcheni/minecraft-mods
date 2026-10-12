import { world, system, EquipmentSlot } from "@minecraft/server";
import { getLevel } from "./items.js";

// Breaking (curse): the opposite of Unbreaking. Every time the item loses a point of durability there's
// a level/(level + 1) chance it loses one more: 50%, 67% or 75% for levels I, II and III, the same odds
// Unbreaking uses to save one.
//
// Scripts get no event for durability, so every tick we compare each held or worn item with what it
// was the tick before.

const SLOTS = [
  EquipmentSlot.Mainhand,
  EquipmentSlot.Offhand,
  EquipmentSlot.Head,
  EquipmentSlot.Chest,
  EquipmentSlot.Legs,
  EquipmentSlot.Feet,
];

const lastSeen = new Map(); // player id -> { [slot key]: { typeId, damage } }

function extraDamage(level, lost) {
  let extra = 0;
  for (let i = 0; i < lost; i++) if (Math.random() < level / (level + 1)) extra++;
  return extra;
}

function checkPlayer(player) {
  const equippable = player.getComponent("minecraft:equippable");
  if (!equippable) return;
  const before = lastSeen.get(player.id) ?? {};
  const now = {};
  for (const slot of SLOTS) {
    const item = equippable.getEquipment(slot);
    const durability = item?.getComponent("minecraft:durability");
    if (!durability) continue;
    // A different hotbar slot is a different item.
    const key = slot === EquipmentSlot.Mainhand ? `${slot}:${player.selectedSlotIndex}` : slot;
    let damage = durability.damage;
    const last = before[key];
    if (last?.typeId === item.typeId && damage > last.damage) {
      const level = getLevel(item, "breaking");
      const extra = level ? extraDamage(level, damage - last.damage) : 0;
      if (extra) {
        damage += extra;
        if (damage >= durability.maxDurability) {
          equippable.setEquipment(slot);
          player.playSound("random.break");
          continue;
        }
        durability.damage = damage;
        equippable.setEquipment(slot, item);
      }
    }
    now[key] = { typeId: item.typeId, damage };
  }
  lastSeen.set(player.id, now);
}

world.afterEvents.playerLeave.subscribe(({ playerId }) => lastSeen.delete(playerId));

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    try {
      checkPlayer(player);
    } catch {
      // The player left mid-check.
    }
  }
}, 1);
