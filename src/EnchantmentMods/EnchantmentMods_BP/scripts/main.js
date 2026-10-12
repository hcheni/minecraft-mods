import { world, system, EquipmentSlot, GameMode } from "@minecraft/server";
import { ActionFormData, FormCancelationReason } from "@minecraft/server-ui";
import { ENCHANTMENTS, enchantLabel } from "./enchantments.js";
import { bookEnchant, combine, getEnchants, hasFireAspect, itemName, itemSlot, setEnchants } from "./items.js";
import "./effects.js";
import "./table.js";

// Use one of our books on an anvil to pick an item from your inventory, or armor you're wearing, to
// enchant. The vanilla anvil screen can't take custom books, so the anvil opens this menu instead.

const ANVILS = new Set(["minecraft:anvil", "minecraft:chipped_anvil", "minecraft:damaged_anvil"]);
const ARMOR_SLOTS = [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet];
const FIRE_ASPECT_CHECK_TICKS = 20;

function cost(player, book, level) {
  return player.getGameMode() === GameMode.Creative ? 0 : level * ENCHANTMENTS[book.id].anvilCost;
}

// Where an item the book could go on sits: an inventory slot or a worn armor slot.
function places(player) {
  const inventory = player.getComponent("minecraft:inventory").container;
  const equippable = player.getComponent("minecraft:equippable");
  const list = [];
  for (let slot = 0; slot < inventory.size; slot++) {
    list.push({
      worn: false,
      get: () => inventory.getItem(slot),
      set: (item) => inventory.setItem(slot, item),
    });
  }
  for (const slot of ARMOR_SLOTS) {
    list.push({
      worn: true,
      get: () => equippable?.getEquipment(slot),
      set: (item) => equippable?.setEquipment(slot, item),
    });
  }
  return list;
}

async function showForm(player, form) {
  // The form can't open while the player is still busy with the interaction that triggered it.
  for (let tries = 0; tries < 20; tries++) {
    const response = await form.show(player);
    if (response.cancelationReason !== FormCancelationReason.UserBusy) return response;
    await system.waitTicks(5);
  }
  return undefined;
}

async function openMenu(player) {
  const inventory = player.getComponent("minecraft:inventory").container;
  const bookSlot = player.selectedSlotIndex;
  const bookItem = inventory.getItem(bookSlot);
  const book = bookEnchant(bookItem);
  if (!book) return;
  const ench = ENCHANTMENTS[book.id];

  const choices = [];
  for (const place of places(player)) {
    const item = place.get();
    if (itemSlot(item) !== ench.slot) continue;
    const name = itemName(item) + (place.worn ? " (worn)" : "");
    choices.push({ place, typeId: item.typeId, name, ...combine(item, book) });
  }
  const what = ench.slot === "weapon" ? "a sword, spear or mace" : "a helmet, chestplate, leggings or boots";
  if (choices.length === 0) {
    player.sendMessage(`§c${ench.name} can only go on ${what}. You don't have one with you.`);
    return;
  }

  const form = new ActionFormData()
    .title(`Apply ${enchantLabel(book.id, book.level)}`)
    .body(
      ench.aspect
        ? "Choose an item. Each item can have only one aspect, and Fire Aspect counts as one."
        : "Choose an item."
    );
  for (const choice of choices) {
    const detail = choice.error
      ? `§c${choice.error}`
      : `§8${enchantLabel(book.id, choice.level)} · ${cost(player, book, choice.level)} levels`;
    form.button(`${choice.name}\n${detail}`);
  }

  const response = await showForm(player, form);
  if (!response || response.canceled || response.selection === undefined) return;
  const choice = choices[response.selection];
  if (choice.error) {
    player.sendMessage(`§c${choice.name}: ${choice.error}.`);
    return;
  }

  // The inventory may have changed while the menu was open.
  const item = choice.place.get();
  if (inventory.getItem(bookSlot)?.typeId !== bookItem.typeId || item?.typeId !== choice.typeId) return;
  const result = combine(item, book);
  if (result.error) {
    player.sendMessage(`§c${choice.name}: ${result.error}.`);
    return;
  }
  const levels = cost(player, book, result.level);
  if (player.level < levels) {
    player.sendMessage(`§cYou need ${levels} levels to apply ${enchantLabel(book.id, result.level)}.`);
    return;
  }

  setEnchants(item, result.enchants);
  choice.place.set(item);
  inventory.setItem(bookSlot);
  if (levels > 0) player.addLevels(-levels);
  player.playSound("random.anvil_use");
  player.sendMessage(`§aYour ${itemName(item)} now has ${enchantLabel(book.id, result.level)}.`);
}

// The vanilla anvil screen can't combine our books, so anyone opening it with one in their inventory
// gets told how to use them, once per visit to the world.
const tipped = new Set(); // player ids

function showTip(player) {
  if (tipped.has(player.id)) return;
  const inventory = player.getComponent("minecraft:inventory")?.container;
  if (!inventory) return;
  for (let slot = 0; slot < inventory.size; slot++) {
    const book = bookEnchant(inventory.getItem(slot));
    if (!book) continue;
    tipped.add(player.id);
    player.sendMessage(
      `§eThe anvil screen can't combine ${ENCHANTMENTS[book.id].name} books. Close it, hold the book in your hand and tap the anvil to choose an item.`
    );
    return;
  }
}

world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
  if (!ANVILS.has(event.block.typeId)) return;
  const player = event.player;
  if (!bookEnchant(event.itemStack)) {
    if (event.isFirstEvent) system.run(() => showTip(player));
    return;
  }
  event.cancel = true;
  if (!event.isFirstEvent) return;
  system.run(() => openMenu(player));
});

world.afterEvents.playerLeave.subscribe(({ playerId }) => tipped.delete(playerId));

// Vanilla can still add Fire Aspect on top of one of our aspects (anvil or enchanting table). One
// aspect per item, so the newer Fire Aspect wins and ours comes off.
system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    const inventory = player.getComponent("minecraft:inventory")?.container;
    if (!inventory) continue;
    for (let slot = 0; slot < inventory.size; slot++) {
      const item = inventory.getItem(slot);
      if (itemSlot(item) !== "weapon" || !hasFireAspect(item)) continue;
      const enchants = getEnchants(item);
      const aspect = Object.keys(enchants).find((id) => ENCHANTMENTS[id]?.aspect);
      if (!aspect) continue;
      const level = enchants[aspect];
      delete enchants[aspect];
      setEnchants(item, enchants);
      inventory.setItem(slot, item);
      player.sendMessage(
        `§eFire Aspect replaced ${enchantLabel(aspect, level)} on your ${itemName(item)}. An item can have only one aspect.`
      );
    }
  }
}, FIRE_ASPECT_CHECK_TICKS);
