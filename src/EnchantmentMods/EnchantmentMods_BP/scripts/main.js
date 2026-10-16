import { world, system, GameMode } from "@minecraft/server";
import { ActionFormData, FormCancelationReason } from "@minecraft/server-ui";
import { ENCHANTMENTS, enchantLabel, itemKind } from "./enchantments.js";
import {
  addedLabels, bookEnchant, combineBooks, getEnchants, getVanilla, isBook, itemName, makeBook, planApply,
  vanillaLabel, writePlan,
} from "./items.js";
import "./effects.js";
import "./breaking.js";
import "./reach.js";
import "./alchemist.js";
import "./table.js";
import "./upkeep.js";

// Hold one of our books and tap an anvil to choose what to use it on: an item in your inventory, which
// gets every enchantment on the book that fits it (ours and vanilla), or another enchanted book, ours
// or vanilla, to combine the two into one. The vanilla anvil screen can't take our books, so the anvil
// opens this menu instead. Armor you're wearing isn't listed: take it off to enchant it.

const ANVILS = new Set(["minecraft:anvil", "minecraft:chipped_anvil", "minecraft:damaged_anvil"]);

function cost(player, plan) {
  return player.getGameMode() === GameMode.Creative ? 0 : plan.cost;
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

function plan(target, book) {
  return isBook(target) ? combineBooks(target, book) : planApply(target, book);
}

// "Book: Zapping I, Sharpness IV +2"
function bookName(item) {
  const custom = getEnchants(item);
  const vanilla = getVanilla(item);
  const labels = [
    ...Object.keys(ENCHANTMENTS).filter((id) => custom[id]).map((id) => enchantLabel(id, custom[id])),
    ...Object.entries(vanilla).map(([id, level]) => vanillaLabel(id, level)),
  ];
  const more = labels.length > 2 ? ` +${labels.length - 2}` : "";
  return `Book: ${labels.slice(0, 2).join(", ") || "empty"}${more}`;
}

async function openMenu(player) {
  const inventory = player.getComponent("minecraft:inventory").container;
  const bookSlot = player.selectedSlotIndex;
  const bookItem = inventory.getItem(bookSlot);
  if (!bookEnchant(bookItem)) return;

  const choices = [];
  for (let slot = 0; slot < inventory.size; slot++) {
    if (slot === bookSlot) continue;
    const item = inventory.getItem(slot);
    if (!item || (!isBook(item) && !itemKind(item.typeId))) continue;
    const result = plan(item, bookItem);
    // Leave out items nothing on the book could ever go on.
    if (result.error && !isBook(item) && /can't go on this|Nothing on this book/.test(result.error)) continue;
    choices.push({ slot, typeId: item.typeId, name: isBook(item) ? bookName(item) : itemName(item), ...result });
  }
  if (choices.length === 0) {
    player.sendMessage("§cNothing in your inventory can take this book. Armor you're wearing has to come off first.");
    return;
  }

  const form = new ActionFormData()
    .title("Use Enchanted Book")
    .body("Choose an item to enchant, or a book to combine with. Each item can have only one aspect, and Fire Aspect counts as one.");
  for (const choice of choices) {
    const detail = choice.error
      ? `§c${choice.error}`
      : `§8${addedLabels(choice.added).join(", ")} · ${cost(player, choice)} levels`;
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
  const target = inventory.getItem(choice.slot);
  const book = inventory.getItem(bookSlot);
  if (book?.typeId !== bookItem.typeId || target?.typeId !== choice.typeId) return;
  const result = plan(target, book);
  if (result.error) {
    player.sendMessage(`§c${choice.name}: ${result.error}.`);
    return;
  }
  const levels = cost(player, result);
  if (player.level < levels) {
    player.sendMessage(`§cYou need ${levels} levels for that.`);
    return;
  }

  if (isBook(target)) {
    inventory.setItem(choice.slot, makeBook(result));
  } else {
    writePlan(target, result);
    inventory.setItem(choice.slot, target);
  }
  inventory.setItem(bookSlot);
  if (levels > 0) player.addLevels(-levels);
  player.playSound("random.anvil_use");
  const what = isBook(target) ? "The combined book" : `Your ${itemName(target)}`;
  player.sendMessage(`§a${what} now has ${addedLabels(result.added).join(", ")}.`);
}

// The vanilla anvil screen can't combine our books, so anyone opening it with one in their inventory
// gets told how to use them, once per visit to the world.
const tipped = new Set(); // player ids

function showTip(player) {
  if (tipped.has(player.id)) return;
  const inventory = player.getComponent("minecraft:inventory")?.container;
  if (!inventory) return;
  for (let slot = 0; slot < inventory.size; slot++) {
    if (!bookEnchant(inventory.getItem(slot))) continue;
    tipped.add(player.id);
    player.sendMessage(
      "§eThe anvil screen can't use Enchantment Mods books. Close it, hold the book in your hand and tap the anvil to choose an item or another book."
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
