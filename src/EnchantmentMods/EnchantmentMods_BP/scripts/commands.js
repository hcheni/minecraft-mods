import {
  system, CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus, EnchantmentTypes, EquipmentSlot,
  ItemStack,
} from "@minecraft/server";
import { ENCHANTMENTS, canGoOn, customConflict, enchantLabel } from "./enchantments.js";
import {
  bookEnchant, getEnchants, getVanilla, isBook, itemName, makeBook, setEnchants, vanillaLabel, vanillaName,
} from "./items.js";
import { VANILLA, vanillaConflict } from "./vanilla.js";

// Commands (cheats on, operators only, like vanilla /enchant). Both carry the pack's namespace; the
// game keeps the name /enchant for its own command.
//   /enchmods:enchant <target> <enchantment> [level]
//       Like /enchant, for ours and vanilla's. Sets the enchantment on the item each target holds, at
//       level 1 unless given; fails if it can't go on the item, the level is too high, or it clashes
//       with something the item has.
//   /enchmods:disenchant <target> <enchantment>
//       Removes that enchantment (ours or vanilla) from the item each target holds. If the item
//       doesn't have it, nothing happens.
// Ours are typed by name: frostbite, venom, strength_surge, life_steal… Vanilla ones by their usual id.

const ENUM = "enchmods:enchantment";
const nameOf = (id) => ENCHANTMENTS[id].name.toLowerCase().replace(/ /g, "_");
const CUSTOM_BY_NAME = Object.fromEntries(Object.keys(ENCHANTMENTS).map((id) => [nameOf(id), id]));

function held(entity) {
  try {
    const equippable = entity.getComponent("minecraft:equippable");
    return { equippable, item: equippable?.getEquipment(EquipmentSlot.Mainhand) };
  } catch {
    return {};
  }
}

function targetName(entity) {
  return entity.nameTag || entity.name || entity.typeId.replace(/^minecraft:/, "");
}

// What the item would look like with this enchantment at this level, or why it can't.
function planEnchant(item, name, level) {
  const custom = getEnchants(item);
  const vanilla = getVanilla(item);
  const id = CUSTOM_BY_NAME[name];
  if (id) {
    const ench = ENCHANTMENTS[id];
    if (!canGoOn(id, item.typeId)) return { error: `${ench.name} can't go on ${itemName(item)}` };
    if (level < 1 || level > ench.maxLevel) return { error: `${ench.name} goes from level 1 to ${ench.maxLevel}` };
    const clash =
      Object.keys(custom).find((other) => customConflict(other, id)) ??
      Object.keys(vanilla).find((v) => ench.vanillaConflicts?.includes(v));
    if (clash) return { error: `${ench.name} can't be combined with ${ENCHANTMENTS[clash]?.name ?? vanillaName(clash)}` };
    return { custom: { ...custom, [id]: level }, label: enchantLabel(id, level) };
  }
  const type = EnchantmentTypes.get(name);
  if (!type) return { error: `Unknown enchantment ${name}` };
  if (level < 1 || level > type.maxLevel) return { error: `${vanillaName(name)} goes from level 1 to ${type.maxLevel}` };
  const clash =
    Object.keys(vanilla).find((other) => vanillaConflict(other, name)) ??
    Object.keys(custom).find((ours) => ENCHANTMENTS[ours]?.vanillaConflicts?.includes(name));
  if (clash) return { error: `${vanillaName(name)} can't be combined with ${ENCHANTMENTS[clash]?.name ?? vanillaName(clash)}` };
  const enchantable = item.getComponent("minecraft:enchantable");
  if (!vanilla[name] && !enchantable?.canAddEnchantment({ type, level })) return { error: `${vanillaName(name)} can't go on ${itemName(item)}` };
  return { vanilla: name, level, label: vanillaLabel(name, level) };
}

function enchant(origin, targets, name, level = 1) {
  const done = [];
  const failed = [];
  for (const target of targets) {
    const { equippable, item } = held(target);
    if (!item) {
      failed.push(`${targetName(target)} isn't holding anything`);
      continue;
    }
    if (isBook(item)) {
      failed.push(`${targetName(target)}: books can't be enchanted this way`);
      continue;
    }
    const plan = planEnchant(item, name, level);
    if (plan.error) {
      failed.push(`${targetName(target)}: ${plan.error}`);
      continue;
    }
    done.push(targetName(target));
    system.run(() => {
      const current = equippable.getEquipment(EquipmentSlot.Mainhand);
      if (current?.typeId !== item.typeId) return;
      if (plan.custom) {
        setEnchants(current, plan.custom);
      } else {
        const enchantable = current.getComponent("minecraft:enchantable");
        if (enchantable.hasEnchantment(plan.vanilla)) enchantable.removeEnchantment(plan.vanilla);
        enchantable.addEnchantment({ type: EnchantmentTypes.get(plan.vanilla), level: plan.level });
      }
      equippable.setEquipment(EquipmentSlot.Mainhand, current);
    });
  }
  const label = CUSTOM_BY_NAME[name] ? enchantLabel(CUSTOM_BY_NAME[name], level) : vanillaLabel(name, level);
  if (!done.length) return { status: CustomCommandStatus.Failure, message: failed.join("\n") || "No targets matched" };
  return {
    status: CustomCommandStatus.Success,
    message: [`Enchanted ${done.join(", ")} with ${label}`, ...failed].join("\n"),
  };
}

function disenchant(origin, targets, name) {
  const done = [];
  for (const target of targets) {
    const { equippable, item } = held(target);
    if (!item) continue;
    const id = CUSTOM_BY_NAME[name];
    const custom = getEnchants(item);
    const vanilla = getVanilla(item);
    if (id ? !custom[id] : !vanilla[name]) continue; // Doesn't have it: nothing happens.
    done.push(targetName(target));
    system.run(() => {
      let current = equippable.getEquipment(EquipmentSlot.Mainhand);
      if (current?.typeId !== item.typeId) return;
      if (bookEnchant(current)) {
        // A book of ours is named after its first enchantment, so it becomes a new book.
        const set = { custom: getEnchants(current), vanilla: getVanilla(current) };
        if (id) delete set.custom[id];
        else delete set.vanilla[name];
        current = Object.keys(set.custom).length || Object.keys(set.vanilla).length ? makeBook(set) : new ItemStack("minecraft:book");
      } else if (id) {
        delete custom[id];
        setEnchants(current, custom);
      } else {
        current.getComponent("minecraft:enchantable").removeEnchantment(name);
      }
      equippable.setEquipment(EquipmentSlot.Mainhand, current);
    });
  }
  const label = CUSTOM_BY_NAME[name] ? ENCHANTMENTS[CUSTOM_BY_NAME[name]].name : vanillaName(name);
  return {
    status: CustomCommandStatus.Success,
    message: done.length ? `Removed ${label} from ${done.join(", ")}` : `Nothing had ${label} to remove`,
  };
}

system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
  customCommandRegistry.registerEnum(ENUM, [...Object.keys(CUSTOM_BY_NAME), ...Object.keys(VANILLA)]);
  customCommandRegistry.registerCommand(
    {
      name: "enchmods:enchant",
      description: "Adds an enchantment, from Enchantment Mods or vanilla, to the item a player or mob is holding.",
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: true,
      mandatoryParameters: [
        { name: "target", type: CustomCommandParamType.EntitySelector },
        { name: ENUM, type: CustomCommandParamType.Enum },
      ],
      optionalParameters: [{ name: "level", type: CustomCommandParamType.Integer }],
    },
    enchant
  );
  customCommandRegistry.registerCommand(
    {
      name: "enchmods:disenchant",
      description: "Removes an enchantment from the item a player or mob is holding.",
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: true,
      mandatoryParameters: [
        { name: "target", type: CustomCommandParamType.EntitySelector },
        { name: ENUM, type: CustomCommandParamType.Enum },
      ],
    },
    disenchant
  );
});
