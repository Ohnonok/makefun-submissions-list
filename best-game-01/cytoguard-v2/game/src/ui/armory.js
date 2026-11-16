// CYTOGUARD v2 — Cell Lineage Bank & Elite Immune Armory (ui/armory.js).
// The spendable-GP shop: 5 immune classes + 3 permanent organ systems.
// Display rule: the bank badge lives inside the Bio-Armory panel on the
// title screen; the victory screen shows the transfer +320 GP -> 770 GP
// with a lit [ UNLOCK DENDRITIC PRIME ] button. No small stacked text.
import { IMMUNE_CLASSES, ORGAN_SYSTEMS } from '../core/lineage.js';

export const ARMORY_RECTS = {
  dendritic: { x: 1010, y: 470, w: 220, h: 56 },
  deploy: { x: 490, y: 560, w: 300, h: 64 },
};

/** Compact armory panel data for the title screen (Bio-Armory panel). */
export function armoryPanel(lineage, nutrients) {
  return {
    gp: lineage.gp,
    tier: lineage.tier,
    vit: nutrients.vit, pro: nutrients.pro, min: nutrients.min,
    weapon: 'APEX PHOTON LANCE',
    classes: IMMUNE_CLASSES.map((c) => ({ name: c.name, cost: c.cost, unlocked: c.unlocked })),
    systems: ORGAN_SYSTEMS.map((s) => ({ name: s.name, level: s.level })),
  };
}

/** Draw the compact Bio-Armory panel (title bottom 30%, element a). */
export function drawArmoryPanel(g, x, y, w, h, panel) {
  g.save();
  g.fillStyle = 'rgba(6, 13, 24, 0.82)';
  g.strokeStyle = '#ffd166'; g.lineWidth = 2;
  g.beginPath(); g.roundRect(x, y, w, h, 12); g.fill(); g.stroke();
  g.fillStyle = '#ffd166';
  g.font = '700 20px system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.font = '700 16px system-ui, sans-serif';
  g.fillText(`VIT [${panel.vit}/10] • PRO [${panel.pro}/10] • MIN [${panel.min}/10] → ${panel.weapon}`, x + 16, y + h / 2);
  g.fillStyle = '#00f5d4';
  g.font = '700 16px system-ui, sans-serif'; g.textAlign = 'right';
  g.fillText(`CELL LINEAGE BANK: ${panel.gp} GP`, x + w - 52, y + h / 2);
  g.restore();
}
