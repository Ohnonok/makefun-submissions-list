// Keyboard and pointer input for CYTOGUARD. WASD / arrows move, the mouse
// aims, hold the left button to shoot. One-shot presses (start, pause,
// upgrade picks, polarity, vent, fever, offering) are queued as bit flags and
// taken once by the loop, so a press between two frames is never lost and
// never counted twice. Bindings: Space = Fibrin Dash (play) / confirm
// (menus); Q / Right-click = polarity shift; R = Metabolic Vent; E = Fever
// Overdrive; F = Marrow Offering.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_PICK_1 = 4;
export const ACTION_PICK_2 = 8;
export const ACTION_PICK_3 = 16;
export const ACTION_SKIP = 32;
/** Space in play: Fibrin Dash. Space on menus still confirms (both flags set). */
export const ACTION_DASH = 64;
/** Q / Right-click: flip Bio/Toxin polarity. */
export const ACTION_POLARITY = 128;
/** E: activate Hyper-Immune Fever (needs a full ATP bar). */
export const ACTION_AWAKEN = 256;
/** F: Marrow Offering (only while standing on the Organ Core). */
export const ACTION_OFFERING = 512;
/** R: Metabolic Vent (gold zone 75–90% = perfect vent + Interferon Shockwave). */
export const ACTION_VENT = 1024;
/** V: open the Vascular Valve Gate (fluidics). */
export const ACTION_VALVE = 2048;

const MOVE_KEYS = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};
const CONFIRM = new Set(['Space', 'Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const PICK = { Digit1: ACTION_PICK_1, Numpad1: ACTION_PICK_1, Digit2: ACTION_PICK_2, Numpad2: ACTION_PICK_2, Digit3: ACTION_PICK_3, Numpad3: ACTION_PICK_3 };

export function createInput(canvas) {
  const held = new Set();
  let actions = 0;
  let mouseX = 640;
  let mouseY = 240;
  let firing = false;
  let clickX = -1;
  let clickY = -1;
  let clicked = false;

  window.addEventListener('keydown', (event) => {
    if (MOVE_KEYS[event.code]) {
      held.add(event.code);
      event.preventDefault();
    } else if (CONFIRM.has(event.code)) {
      // Space is both menu-confirm and in-play dash: main.js routes by screen.
      if (!event.repeat) actions |= ACTION_CONFIRM | ACTION_DASH;
      event.preventDefault();
    } else if (event.code === 'KeyQ') {
      if (!event.repeat) actions |= ACTION_POLARITY;
    } else if (event.code === 'KeyE') {
      if (!event.repeat) actions |= ACTION_AWAKEN;
    } else if (event.code === 'KeyF') {
      if (!event.repeat) actions |= ACTION_OFFERING;
    } else if (event.code === 'KeyV') {
      if (!event.repeat) actions |= ACTION_VALVE;
    } else if (event.code === 'KeyR') {
      if (!event.repeat) actions |= ACTION_VENT;
    } else if (PAUSE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PAUSE;
      event.preventDefault();
    } else if (PICK[event.code]) {
      if (!event.repeat) actions |= PICK[event.code];
    } else if (event.code === 'KeyC') {
      if (!event.repeat) actions |= ACTION_SKIP;
    }
  });
  window.addEventListener('keyup', (event) => {
    held.delete(event.code);
  });
  window.addEventListener('blur', () => {
    held.clear();
    firing = false;
  });
  canvas.addEventListener('pointermove', (event) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = ((event.clientX - rect.left) / rect.width) * 1280;
    mouseY = ((event.clientY - rect.top) / rect.height) * 720;
  });
  canvas.addEventListener('pointerdown', (event) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = ((event.clientX - rect.left) / rect.width) * 1280;
    mouseY = ((event.clientY - rect.top) / rect.height) * 720;
    if (event.button === 0) {
      firing = true;
      clickX = mouseX;
      clickY = mouseY;
      clicked = true;
    } else if (event.button === 2) {
      // Right-click flips polarity (dash is Space only).
      actions |= ACTION_POLARITY;
    }
  });
  window.addEventListener('pointerup', (event) => {
    if (event.button === 0) firing = false;
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  return {
    /** Movement direction, each axis in [-1, 1]. */
    move() {
      let x = 0;
      let y = 0;
      for (const code of held) {
        const d = MOVE_KEYS[code];
        if (d) { x += d[0]; y += d[1]; }
      }
      return { x, y };
    },
    aim() { return { x: mouseX, y: mouseY }; },
    isFiring() { return firing; },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
    /** The last click position, if one arrived since the last call. */
    takeClick() {
      if (!clicked) return null;
      clicked = false;
      return { x: clickX, y: clickY };
    },
  };
}
