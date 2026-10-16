import { world, system, EquipmentSlot } from "@minecraft/server";
import { armorLevels } from "./effects.js";

// Alchemist (chestplate): potions you drink, and splash potions you throw, give effects that last 20%
// longer per level. A splash potion's longer effects go to everyone it hits.
//
// The game tells scripts about each effect before it starts and lets them change its length, but not
// where it came from. So we keep track of who is drinking a potion right now, and where splash potions
// thrown by an Alchemist wearer are, and stretch effects that start on the drinker or next to such a
// potion as it breaks. Lingering potions can't be changed: scripts can't touch the cloud's length.

const PER_LEVEL = 0.2;
const SPLASH_RADIUS = 5;
const CHEST = [EquipmentSlot.Chest];

const drinking = new Map(); // player id -> { level, untilTick } (Infinity while still drinking)
const potions = new Map(); // potion entity id -> { entity, level, location, goneTick }

function alchemistLevel(entity) {
  return armorLevels(entity, "alchemist", CHEST);
}

world.afterEvents.itemStartUse.subscribe(({ source, itemStack }) => {
  if (itemStack?.typeId !== "minecraft:potion") return;
  const level = alchemistLevel(source);
  if (level) drinking.set(source.id, { level, untilTick: Infinity });
});

// The effects start in the same tick the drink finishes, before this event; keep one extra tick.
function stopDrinking({ source }) {
  const entry = drinking.get(source.id);
  if (entry) entry.untilTick = system.currentTick + 1;
}
world.afterEvents.itemCompleteUse.subscribe(stopDrinking);
world.afterEvents.itemStopUse.subscribe(stopDrinking);

world.afterEvents.entitySpawn.subscribe(({ entity }) => {
  if (entity.typeId !== "minecraft:splash_potion") return;
  // The thrower is set right after the potion appears.
  system.run(() => {
    try {
      const owner = entity.getComponent("minecraft:projectile")?.owner;
      const level = owner ? alchemistLevel(owner) : 0;
      if (level) potions.set(entity.id, { entity, level, location: entity.location, goneTick: undefined });
    } catch {
      // Already broke.
    }
  });
});

function near(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2 <= SPLASH_RADIUS ** 2;
}

world.beforeEvents.effectAdd.subscribe((event) => {
  const now = system.currentTick;
  let level = 0;
  const drink = drinking.get(event.entity.id);
  if (drink && now <= drink.untilTick) level = drink.level;
  for (const potion of potions.values()) {
    if (potion.goneTick !== undefined && now - potion.goneTick > 1) continue;
    if (near(potion.location, event.entity.location)) level = Math.max(level, potion.level);
  }
  if (level) event.duration = Math.round(event.duration * (1 + PER_LEVEL * level));
});

system.runInterval(() => {
  const now = system.currentTick;
  for (const [id, entry] of drinking) if (now > entry.untilTick) drinking.delete(id);
  for (const [id, potion] of potions) {
    if (potion.goneTick === undefined) {
      if (potion.entity.isValid) potion.location = potion.entity.location;
      else potion.goneTick = now;
    } else if (now - potion.goneTick > 2) {
      potions.delete(id);
    }
  }
}, 1);
