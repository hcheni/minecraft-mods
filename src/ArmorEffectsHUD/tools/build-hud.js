// Generates ArmorHUD_RP/ui/hud_screen.json. Run: node tools/build-hud.js
// The payload layout here must match ArmorHUD_BP/scripts/main.js:
//   "ahud:" + 5 slots x [item code (1) + normal text (9) + low text (9)] + effects text
const fs = require("fs");
const path = require("path");

const PREFIX = "ahud:";
const SLOT_WIDTH = 19;
const ICON = 16;
const ROW_HEIGHT = 20;
const HUD_LIFETIME_SECONDS = 12; // the script resends at least every 5 s
const LEATHER_TINT = [0.63, 0.4, 0.25];

// Texture paths checked against Mojang's bedrock-samples (resource_pack/textures/item_texture.json).
const armor = (piece) => ({
  empty: `textures/ui/empty_armor_slot_${piece}`,
  icons: {
    L: { texture: `textures/items/leather_${piece}`, color: LEATHER_TINT },
    C: { texture: `textures/items/chainmail_${piece}` },
    I: { texture: `textures/items/iron_${piece}` },
    G: { texture: `textures/items/gold_${piece}` },
    D: { texture: `textures/items/diamond_${piece}` },
    N: { texture: `textures/items/netherite_${piece}` },
    K: { texture: `textures/items/copper_${piece}` },
  },
});

const SLOTS = [
  { name: "helmet", ...armor("helmet") },
  { name: "chestplate", ...armor("chestplate") },
  { name: "leggings", ...armor("leggings") },
  { name: "boots", ...armor("boots") },
  {
    name: "offhand",
    empty: "textures/ui/empty_armor_slot_shield",
    icons: {
      // Bedrock has no flat shield icon (it's drawn from the 3D model), so use the slot silhouette at full strength.
      S: { texture: "textures/ui/empty_armor_slot_shield" },
      U: { texture: "textures/items/totem" },
      A: { texture: "textures/items/arrow" },
      F: { texture: "textures/items/fireworks" },
      M: { texture: "textures/items/map_filled" },
      H: { texture: "textures/items/nautilus" },
    },
  },
];
SLOTS[0].icons.T = { texture: "textures/items/turtle_helmet" };
SLOTS[1].icons.E = { texture: "textures/items/elytra" };

const EFFECTS_START = PREFIX.length + SLOTS.length * SLOT_WIDTH;

const S = "#hud_title_text_string";
const slice = (start, end) => `(('%.${end}s' * ${S}) - ('%.${start}s' * ${S}))`;
const titleBinding = { binding_name: S, binding_type: "global", binding_condition: "always" };
const view = (expr, target) => ({ binding_type: "view", source_property_name: expr, target_property_name: target });
const hasPrefix = `(not ((${S} - '${PREFIX}') = ${S}))`;

function image(texture, visibleExpr, extra = {}) {
  return {
    type: "image",
    texture,
    size: [ICON, ICON],
    anchor_from: "left_middle",
    anchor_to: "left_middle",
    bindings: [titleBinding, view(visibleExpr, "#visible")],
    ...extra,
  };
}

function label(textExpr, color) {
  return {
    type: "label",
    text: "#text",
    localize: false,
    shadow: true,
    color,
    layer: 2,
    anchor_from: "left_middle",
    anchor_to: "left_middle",
    offset: [ICON + 4, 1],
    size: ["default", 10],
    bindings: [titleBinding, view(textExpr, "#text")],
  };
}

function slotRow(slot, slotIndex) {
  const base = PREFIX.length + slotIndex * SLOT_WIDTH;
  const code = slice(base, base + 1);
  const controls = [];

  for (const [letter, icon] of Object.entries(slot.icons)) {
    const extra = icon.color ? { color: icon.color } : {};
    controls.push({ [`icon_${letter}`]: image(icon.texture, `(${code} = '${letter}')`, extra) });
  }
  // Empty slot, or an item this HUD has no icon for: the dimmed vanilla slot outline.
  const notKnown = Object.keys(slot.icons).map((l) => `(not (${code} = '${l}'))`).join(" and ");
  controls.push({ icon_other: image(slot.empty, `(${notKnown})`, { alpha: 0.5 }) });

  controls.push({ normal: label(slice(base + 1, base + 10), [1, 1, 1]) });
  controls.push({ low: label(slice(base + 10, base + 19), [1, 0.33, 0.33]) });

  return { type: "panel", size: [90, ROW_HEIGHT], controls };
}

// Hides a vanilla title part while the title is carrying HUD data.
const hideWhileHud = {
  bindings: [titleBinding, view(`((${S} - '${PREFIX}') = ${S})`, "#visible")],
};

const hud = {
  namespace: "hud",

  // Keeps each HUD copy alive for a while, then removes it, like vanilla titles do.
  ahud_lifetime: {
    anim_type: "alpha",
    easing: "linear",
    duration: HUD_LIFETIME_SECONDS,
    from: 1,
    to: 1,
    destroy_at_end: "hud_title_text",
  },

  ahud_root: {
    type: "panel",
    size: ["100%", "100%"],
    alpha: "@hud.ahud_lifetime",
    bindings: [titleBinding, view(hasPrefix, "#visible")],
    controls: [
      {
        ahud_stack: {
          type: "stack_panel",
          orientation: "vertical",
          anchor_from: "left_middle",
          anchor_to: "left_middle",
          offset: [6, -10],
          size: [220, "100%c"],
          controls: [
            ...SLOTS.map((slot, i) => ({ [slot.name]: slotRow(slot, i) })),
            { spacer: { type: "panel", size: [1, 6] } },
            {
              effects: {
                type: "label",
                text: "#text",
                localize: false,
                shadow: true,
                layer: 2,
                size: ["default", "default"],
                bindings: [titleBinding, view(`(${S} - ('%.${EFFECTS_START}s' * ${S}))`, "#text")],
              },
            },
          ],
        },
      },
    ],
  },

  // Our own copy of the title factory: the game creates ahud_root whenever a title is shown,
  // and only controls created this way can read the title text.
  ahud_factory: {
    type: "panel",
    size: ["100%", "100%"],
    layer: 20,
    factory: {
      name: "hud_title_text_factory",
      control_ids: { hud_title_text: "ahud_root@hud.ahud_root" },
    },
  },

  root_panel: {
    modifications: [
      { array_name: "controls", operation: "insert_front", value: [{ "ahud_factory@hud.ahud_factory": {} }] },
    ],
  },

  // The normal title (text and its dark background box) stays hidden while it carries HUD data.
  "hud_title_text/title_frame": hideWhileHud,
  "hud_title_text/subtitle_frame": hideWhileHud,
};

const out = path.join(__dirname, "..", "ArmorHUD_RP", "ui", "hud_screen.json");
fs.writeFileSync(out, JSON.stringify(hud, null, 2) + "\n");
console.log("wrote", out, `(effects start at ${EFFECTS_START})`);
