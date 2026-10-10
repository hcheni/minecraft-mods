// Generates ArmorHUD_RP/ui/hud_screen.json. Run: node tools/build-hud.js
// The script sends the finished HUD as one block of text after the "ahud:" marker; icons are
// characters from font/glyph_E1.png. The layout only shows that text on the left of the screen.
const fs = require("fs");
const path = require("path");

const PREFIX = "ahud:";
const FONT_SCALE = 1.3;

const S = "#hud_title_text_string";
const titleBinding = { binding_name: S, binding_condition: "always" };
const view = (expr, target) => ({ binding_type: "view", source_property_name: expr, target_property_name: target });

const hud = {
  namespace: "hud",

  ahud_root: {
    type: "panel",
    size: ["100%", "100%"],
    bindings: [titleBinding, view(`(not ((${S} - '${PREFIX}') = ${S}))`, "#visible")],
    controls: [
      {
        ahud_text: {
          type: "label",
          text: "#text",
          shadow: true,
          text_alignment: "left",
          font_scale_factor: FONT_SCALE,
          anchor_from: "left_middle",
          anchor_to: "left_middle",
          offset: [6, 0],
          size: ["default", "default"],
          bindings: [titleBinding, view(`(${S} - '${PREFIX}')`, "#text")],
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
};

// The normal title (text and its dark background box) stays hidden while it carries HUD data.
const hideWhileHud = { bindings: [titleBinding, view(`((${S} - '${PREFIX}') = ${S})`, "#visible")] };
hud["hud_title_text/title_frame"] = hideWhileHud;
hud["hud_title_text/subtitle_frame"] = hideWhileHud;

const out = path.join(__dirname, "..", "ArmorHUD_RP", "ui", "hud_screen.json");
fs.writeFileSync(out, JSON.stringify(hud, null, 2) + "\n");
console.log("wrote", out);
