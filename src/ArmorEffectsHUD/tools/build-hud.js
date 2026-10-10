// Generates ArmorHUD_RP/ui/hud_screen.json. Run: node tools/build-hud.js
// The payload layout here must match ArmorHUD_BP/scripts/main.js:
//   "ahud:" + 4 slots x [material code (1) + normal text (9) + low text (9)] + effects text
const fs = require("fs");
const path = require("path");

const PREFIX = "ahud:";
const SLOT_WIDTH = 19;
const EFFECTS_START = PREFIX.length + 4 * SLOT_WIDTH; // 81
const ICON = 16;
const ROW_HEIGHT = 20;

const PIECES = ["helmet", "chestplate", "leggings", "boots"];
const EMPTY_ICONS = PIECES.map((p) => `textures/ui/empty_armor_slot_${p}`);
const LEATHER_TINT = [0.63, 0.4, 0.25];

// Material code -> texture for each piece (null = not used for that slot).
const MATERIALS = {
  L: (p) => `textures/items/leather_${p}`,
  C: (p) => `textures/items/chainmail_${p}`,
  I: (p) => `textures/items/iron_${p}`,
  G: (p) => `textures/items/gold_${p}`,
  D: (p) => `textures/items/diamond_${p}`,
  N: (p) => `textures/items/netherite_${p}`,
  K: (p) => `textures/items/copper_${p}`,
  T: (p) => (p === "helmet" ? "textures/items/turtle_helmet" : null),
  E: (p) => (p === "chestplate" ? "textures/items/elytra" : null),
};

const S = "#hud_title_text_string";
const slice = (start, end) => `(('%.${end}s' * ${S}) - ('%.${start}s' * ${S}))`;
const titleBinding = { binding_name: S, binding_condition: "always" };
const view = (expr, target) => ({ binding_type: "view", source_property_name: expr, target_property_name: target });

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
    shadow: true,
    color,
    anchor_from: "left_middle",
    anchor_to: "left_middle",
    offset: [ICON + 4, 1],
    size: ["default", 10],
    bindings: [titleBinding, view(textExpr, "#text")],
  };
}

function armorRow(slotIndex) {
  const piece = PIECES[slotIndex];
  const base = PREFIX.length + slotIndex * SLOT_WIDTH;
  const code = slice(base, base + 1);
  const controls = [];
  const known = [];

  for (const [letter, tex] of Object.entries(MATERIALS)) {
    const texture = tex(piece);
    if (!texture) continue;
    known.push(letter);
    const extra = letter === "L" ? { color: LEATHER_TINT } : {};
    controls.push({ [`icon_${letter}`]: image(texture, `(${code} = '${letter}')`, extra) });
  }
  // Empty slot, or armor this HUD has no icon for: show the vanilla slot outline.
  const notKnown = known.map((l) => `(not (${code} = '${l}'))`).join(" and ");
  controls.push({ icon_other: image(EMPTY_ICONS[slotIndex], `(${notKnown})`, { alpha: 0.6 }) });

  controls.push({ normal: label(slice(base + 1, base + 10), [1, 1, 1]) });
  controls.push({ low: label(slice(base + 10, base + 19), [1, 0.33, 0.33]) });

  return { type: "panel", size: [90, ROW_HEIGHT], controls };
}

const hud = {
  namespace: "hud",

  ahud_root: {
    type: "panel",
    size: ["100%", "100%"],
    bindings: [titleBinding, view(`(not ((${S} - '${PREFIX}') = ${S}))`, "#visible")],
    controls: [
      {
        ahud_stack: {
          type: "stack_panel",
          orientation: "vertical",
          anchor_from: "left_middle",
          anchor_to: "left_middle",
          offset: [6, -16],
          size: [220, "100%c"],
          controls: [
            ...PIECES.map((p, i) => ({ [p]: armorRow(i) })),
            { spacer: { type: "panel", size: [1, 6] } },
            {
              effects: {
                type: "label",
                text: "#text",
                shadow: true,
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

  // Hide the normal title text while it's carrying HUD data.
  "hud_title_text/title_frame/title": {
    modifications: [
      {
        array_name: "bindings",
        operation: "insert_back",
        value: view(`((#text - '${PREFIX}') = #text)`, "#visible"),
      },
    ],
  },
};

const out = path.join(__dirname, "..", "ArmorHUD_RP", "ui", "hud_screen.json");
fs.writeFileSync(out, JSON.stringify(hud, null, 2) + "\n");
console.log("wrote", out, `(effects start at ${EFFECTS_START})`);
