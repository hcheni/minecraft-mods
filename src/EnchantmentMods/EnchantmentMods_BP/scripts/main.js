import { world, system, GameMode } from "@minecraft/server";
import { ActionFormData, FormCancelationReason } from "@minecraft/server-ui";
import { ASPECTS, aspectLabel, bookAspect, getAspect, hasFireAspect, isWeapon, itemName, setAspect } from "./aspects.js";
import "./effects.js";
import "./table.js";

// Use one of our books on an anvil to pick a sword, spear or mace from your inventory to enchant.
// The vanilla anvil screen can't take custom books, so the anvil opens this menu instead.

const ANVILS = new Set(["minecraft:anvil", "minecraft:chipped_anvil", "minecraft:damaged_anvil"]);
const LEVELS_PER_ENCHANT_LEVEL = 2; // XP cost, like a Fire Aspect book at an anvil
const FIRE_ASPECT_CHECK_TICKS = 20;

// What the weapon would end up with, or why the book can't go on it. Same rules as vanilla books:
// one aspect per item, equal levels merge into the next level, a higher level replaces a lower one.
function combine(weapon, book) {
  if (hasFireAspect(weapon)) return { error: "Already has Fire Aspect" };
  const current = getAspect(weapon);
  if (!current) return { result: book };
  if (current.id !== book.id) return { error: `Already has ${aspectLabel(current)}` };
  const level =
    current.level === book.level
      ? Math.min(current.level + 1, ASPECTS[book.id].maxLevel)
      : Math.max(current.level, book.level);
  if (level === current.level) return { error: `Already has ${aspectLabel(current)}` };
  return { result: { id: book.id, level } };
}

function cost(player, result) {
  return player.getGameMode() === GameMode.Creative ? 0 : result.level * LEVELS_PER_ENCHANT_LEVEL;
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
  const book = bookAspect(bookItem);
  if (!book) return;

  const choices = [];
  for (let slot = 0; slot < inventory.size; slot++) {
    const item = inventory.getItem(slot);
    if (isWeapon(item)) choices.push({ slot, typeId: item.typeId, name: itemName(item), ...combine(item, book) });
  }
  if (choices.length === 0) {
    player.sendMessage(`§c${aspectLabel(book)} can only go on a sword, spear or mace. You don't have one with you.`);
    return;
  }

  const form = new ActionFormData()
    .title(`Apply ${aspectLabel(book)}`)
    .body("Choose a weapon. Each item can have only one aspect, and Fire Aspect counts as one.");
  for (const choice of choices) {
    const detail = choice.error
      ? `§c${choice.error}`
      : `§8${aspectLabel(choice.result)} · ${cost(player, choice.result)} levels`;
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
  const weapon = inventory.getItem(choice.slot);
  if (inventory.getItem(bookSlot)?.typeId !== bookItem.typeId || weapon?.typeId !== choice.typeId) return;
  const { result, error } = combine(weapon, book);
  if (error) {
    player.sendMessage(`§c${choice.name}: ${error}.`);
    return;
  }
  const levels = cost(player, result);
  if (player.level < levels) {
    player.sendMessage(`§cYou need ${levels} levels to apply ${aspectLabel(result)}.`);
    return;
  }

  setAspect(weapon, result);
  inventory.setItem(choice.slot, weapon);
  inventory.setItem(bookSlot);
  if (levels > 0) player.addLevels(-levels);
  player.playSound("random.anvil_use");
  player.sendMessage(`§aYour ${choice.name} now has ${aspectLabel(result)}.`);
}

// The vanilla anvil screen can't combine our books, so anyone opening it with one in their inventory
// gets told how to use them, once per visit to the world.
const tipped = new Set(); // player ids

function showTip(player) {
  if (tipped.has(player.id)) return;
  const inventory = player.getComponent("minecraft:inventory")?.container;
  if (!inventory) return;
  for (let slot = 0; slot < inventory.size; slot++) {
    const book = bookAspect(inventory.getItem(slot));
    if (!book) continue;
    tipped.add(player.id);
    player.sendMessage(
      `§eThe anvil screen can't combine ${aspectLabel(book)} books. Close it, hold the book in your hand and tap the anvil to choose a weapon.`
    );
    return;
  }
}

world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
  if (!ANVILS.has(event.block.typeId)) return;
  const player = event.player;
  if (!bookAspect(event.itemStack)) {
    if (event.isFirstEvent) system.run(() => showTip(player));
    return;
  }
  event.cancel = true;
  if (!event.isFirstEvent) return;
  system.run(() => openMenu(player));
});

world.afterEvents.playerLeave.subscribe(({ playerId }) => tipped.delete(playerId));

// Vanilla can still add Fire Aspect on top of ours (anvil or enchanting table). One aspect per item,
// so the newer Fire Aspect wins and ours comes off.
system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    const inventory = player.getComponent("minecraft:inventory")?.container;
    if (!inventory) continue;
    for (let slot = 0; slot < inventory.size; slot++) {
      const item = inventory.getItem(slot);
      if (!isWeapon(item)) continue;
      const aspect = getAspect(item);
      if (!aspect || !hasFireAspect(item)) continue;
      setAspect(item, undefined);
      inventory.setItem(slot, item);
      player.sendMessage(`§eFire Aspect replaced ${aspectLabel(aspect)} on your ${itemName(item)}. An item can have only one aspect.`);
    }
  }
}, FIRE_ASPECT_CHECK_TICKS);
