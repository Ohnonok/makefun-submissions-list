// CYTOGUARD v2 — End screens, body map & codex drawer (ui/screens.js).
// Dual endings: Victory HOMEOSTASIS RESTORED (3 stars, ECG sparkline
// W1-15, +320 GP -> 770 GP) / Defeat ORGAN COLLAPSE — EPIGENETIC MEMORY
// SALVAGED (+110 GP, ADAPTIVE IMMUNITY +15%, [EVOLVE & RETRY]).
// Also: the slim anatomical body-map strip for the Draft screen and the
// Bio-Codex drawer state (opened from the small [BIO-CODEX] button in the
// title screen's top-right corner).
export const VICTORY_NARRATIVE_V2 = 'Omega Chimera eradicated. Vital homeostasis restored across all 15 waves.';
export const DEFEAT_NARRATIVE_V2 = "Primary defense breached — yet Memory B-Cells encoded the pathogen's genome. Your next lineage awakens stronger.";
export const BODY_MAP_ORGANS = ['CAPILLARY', 'LUNGS', 'LIVER', 'CARDIAC', 'MARROW'];
export const ENDLESS_BUTTON = { x: 660, y: 500, w: 260, h: 60 };
export const EVOLVE_BUTTON = { x: 440, y: 480, w: 220, h: 60 };

/** ECG-style Vitality Telemetry Sparkline: Organ Integrity + Chain, W1-15. */
export function drawTelemetrySparkline(g, x, y, w, h, telemetry) {
  g.save();
  g.strokeStyle = 'rgba(0,245,212,0.35)'; g.lineWidth = 1;
  g.strokeRect(x, y, w, h);
  if (telemetry.length < 2) { g.restore(); return; }
  g.strokeStyle = '#00f5d4'; g.lineWidth = 2.5; g.beginPath();
  telemetry.forEach((p, i) => {
    const px = x + (i / 14) * w;
    const py = y + h - (p.organ / 100) * h;
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  });
  g.stroke();
  g.strokeStyle = '#ffd166'; g.lineWidth = 2; g.beginPath();
  telemetry.forEach((p, i) => {
    const px = x + (i / 14) * w;
    const py = y + h - (Math.min(p.chain, 40) / 40) * h;
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  });
  g.stroke();
  g.restore();
}

/** Slim anatomical body-map strip: organ path ribbon, no small text. */
export function drawBodyMap(g, x, y, w, h, currentOrgan, cleared) {
  g.save();
  g.fillStyle = 'rgba(6,13,24,0.75)';
  g.beginPath(); g.roundRect(x, y, w, h, 10); g.fill();
  g.strokeStyle = '#00f5d4'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(x + 10, y + h / 2); g.lineTo(x + w - 10, y + h / 2); g.stroke();
  BODY_MAP_ORGANS.forEach((name, i) => {
    const px = x + 24 + (i / (BODY_MAP_ORGANS.length - 1)) * (w - 48);
    const done = cleared.includes(name);
    const cur = name === currentOrgan;
    g.fillStyle = done ? '#00f5d4' : cur ? '#ffd166' : 'rgba(255,255,255,0.35)';
    g.beginPath(); g.arc(px, y + h / 2, cur ? 10 : 7, 0, Math.PI * 2); g.fill();
    if (cur) { g.strokeStyle = '#ffd166'; g.beginPath(); g.arc(px, y + h / 2, 14, 0, Math.PI * 2); g.stroke(); }
  });
  g.fillStyle = '#e8fff9'; g.font = '700 13px system-ui, sans-serif'; g.textAlign = 'center';
  g.fillText(currentOrgan, x + w / 2, y + h - 8);
  g.restore();
}

/** Bio-Codex drawer: anatomy + pathogen catalog + Omega Chimera notes. */
export const CODEX_ENTRIES = [
  { title: 'T-Cell Lance', body: 'Precision perforin lance. The starter hunter.' },
  { title: 'Plasma Chakram', body: 'Orbiting antibody chakram, ricochets between foes.' },
  { title: 'Macrophage Prism', body: 'Refracts the lance into three rainbow beams.' },
  { title: 'NK-Cell Supernova', body: 'Cytokine Storm on every Polarity Shift (Q).' },
  { title: 'Dendritic Sentinel Prime', body: '600 GP — summons 2 Autonomous Antibody Drones.' },
  { title: 'Bacillus', body: 'Rod pathogen. Chains toward the Organ Core.' },
  { title: 'Bacteriophage', body: 'Hexagonal virion, six legs, ranged toxin shots.' },
  { title: 'Microplastic', body: 'Jagged crystal shard. Marches on the Core.' },
  { title: 'Malignant Tumor', body: 'Rogue cell. Red tethers drain the Core; mAb cures it.' },
  { title: 'Omega Chimera', body: 'The Synthetic Sovereign. 75% carapace vs Grade 1-3, polarity inversion every 5 s, spire regrowth under 40% HP.' },
];
export function createCodex() { return { open: false, selected: 0 }; }
export function toggleCodex(codex) { codex.open = !codex.open; return codex.open; }
