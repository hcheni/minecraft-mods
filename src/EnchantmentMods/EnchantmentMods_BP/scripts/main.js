import { world, system, GameMode } from "@minecraft/server";
import { ActionFormData, FormCancelationReason } from "@minecraft/server-ui";
import { ENCHANTMENTS, canGoOn, enchantLabel } from "./enchantments.js";
import { bookEnchant, combine, itemName, setEnchants } from "./items.js";
import { applyBookExtras, getBookExtras, rollBookExtras } from "./rolls.js";
import "./effects.js";
import "./breaking.js";
import "./table.js";
import "./mobs.js";
import "./upkeep.js";

// Use one of our books on an anvil to pick an item from your inventory to enchant. The vanilla anvil
// screen can't take custom books, so the anvil opens this menu instead. Armor you're wearing isn't
// listed: take it off to enchant it.

const ANVILS = new Set(["minecraft:anvil", "minecraft:chipped_anvil", "minecraft:damaged_anvil"]);

function cost(player, book, level) {
  return player.getGameMode() === GameMode.Creative ? 0 : level * ENCHANTMENTS[book.id].anvilCost;
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
  if (rollBookExtras(bookItem)) inventory.setItem(bookSlot, bookItem);
  const ench = ENCHANTMENTS[book.id];

  const choices = [];
  for (let slot = 0; slot < inventory.size; slot++) {
    const item = inventory.getItem(slot);
    if (item && canGoOn(book.id, item.typeId)) choices.push({ slot, typeId: item.typeId, name: itemName(item), ...combine(item, book) });
  }
  if (choices.length === 0) {
    player.sendMessage(`§cYou have nothing ${ench.name} can go on in your inventory. Armor you're wearing has to come off first.`);
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
  const item = inventory.getItem(choice.slot);
  const currentBook = inventory.getItem(bookSlot);
  if (currentBook?.typeId !== bookItem.typeId || item?.typeId !== choice.typeId) return;
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
  const extras = applyBookExtras(item, getBookExtras(currentBook));
  inventory.setItem(choice.slot, item);
  inventory.setItem(bookSlot);
  if (levels > 0) player.addLevels(-levels);
  player.playSound("random.anvil_use");
  const all = [enchantLabel(book.id, result.level), ...extras].join(", ");
  player.sendMessage(`§aYour ${itemName(item)} now has ${all}.`);
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
