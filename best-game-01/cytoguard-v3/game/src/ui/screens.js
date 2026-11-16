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

/** 15-Wave Telemetry Curve: Organ Integrity + Chain, W1-15. Glowing
 * cyan-gold ECG area chart with a microscopic grid — never two bare
 * crossing lines. Label sits above the box; W1/W15 ticks inside it. */
export function drawTelemetrySparkline(g, x, y, w, h, telemetry) {
  g.save();
  g.fillStyle = 'rgba(6, 13, 24, 0.62)';
  g.fillRect(x, y, w, h);
  // Microscopic grid: 15 wave columns, 8 integrity rows.
  g.strokeStyle = 'rgba(0, 245, 212, 0.10)';
  g.lineWidth = 1;
  for (let i = 0; i <= 15; i += 1) {
    const px = x + (i / 15) * w;
    g.beginPath(); g.moveTo(px, y); g.lineTo(px, y + h); g.stroke();
  }
  for (let j = 0; j <= 8; j += 1) {
    const py = y + (j / 8) * h;
    g.beginPath(); g.moveTo(x, py); g.lineTo(x + w, py); g.stroke();
  }
  g.strokeStyle = 'rgba(0, 245, 212, 0.35)';
  g.lineWidth = 1;
  g.strokeRect(x, y, w, h);
  // Axis label above the box.
  g.fillStyle = '#7df9ff';
  g.font = '700 12px system-ui, sans-serif';
  g.textAlign = 'left';
  g.fillText('ORGAN INTEGRITY & CHAIN CURVE (W1–W15)', x, y - 10);
  if (telemetry.length < 2) { g.restore(); return; }
  const n = telemetry.length;
  const pxAt = (i) => x + (i / (n - 1)) * w;
  const pyOrgan = (p) => y + h - (p.organ / 100) * h;
  const pyChain = (p) => y + h - (Math.min(p.chain, 40) / 40) * h;
  // Glowing cyan-gold area gradient under the Organ Integrity curve.
  const ag = g.createLinearGradient(0, y, 0, y + h);
  ag.addColorStop(0, 'rgba(0, 245, 212, 0.38)');
  ag.addColorStop(0.6, 'rgba(0, 245, 212, 0.12)');
  ag.addColorStop(1, 'rgba(0, 245, 212, 0)');
  g.beginPath();
  telemetry.forEach((p, i) => { if (i === 0) g.moveTo(pxAt(i), pyOrgan(p)); else g.lineTo(pxAt(i), pyOrgan(p)); });
  g.lineTo(pxAt(n - 1), y + h);
  g.lineTo(pxAt(0), y + h);
  g.closePath();
  g.fillStyle = ag;
  g.fill();
  // Organ Integrity curve: thick glowing cyan, one dot per wave.
  g.save();
  g.shadowColor = '#00f5d4'; g.shadowBlur = 10;
  g.strokeStyle = '#00f5d4'; g.lineWidth = 3; g.beginPath();
  telemetry.forEach((p, i) => { if (i === 0) g.moveTo(pxAt(i), pyOrgan(p)); else g.lineTo(pxAt(i), pyOrgan(p)); });
  g.stroke();
  g.restore();
  telemetry.forEach((p, i) => {
    g.fillStyle = '#00f5d4';
    g.beginPath(); g.arc(pxAt(i), pyOrgan(p), 3.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(pxAt(i), pyOrgan(p), 1.4, 0, Math.PI * 2); g.fill();
  });
  // Chain curve: gold, one dot per wave.
  g.save();
  g.shadowColor = '#ffd166'; g.shadowBlur = 8;
  g.strokeStyle = '#ffd166'; g.lineWidth = 2; g.beginPath();
  telemetry.forEach((p, i) => { if (i === 0) g.moveTo(pxAt(i), pyChain(p)); else g.lineTo(pxAt(i), pyChain(p)); });
  g.stroke();
  g.restore();
  telemetry.forEach((p, i) => {
    g.fillStyle = '#ffd166';
    g.beginPath(); g.arc(pxAt(i), pyChain(p), 2.6, 0, Math.PI * 2); g.fill();
  });
  // W1 / W15 end ticks.
  g.fillStyle = 'rgba(232, 255, 249, 0.85)';
  g.font = '700 11px system-ui, sans-serif';
  g.textAlign = 'left';
  g.fillText('W1', x + 4, y + h - 6);
  g.textAlign = 'right';
  g.fillText('W15', x + w - 4, y + h - 6);
  g.restore();
}

/** Anatomical body-map: organ path ribbon with a glowing vessel halo
 * around the panel and a double ring on the current organ — no small text
 * beyond the organ name. */
export function drawBodyMap(g, x, y, w, h, currentOrgan, cleared) {
  g.save();
  // Soft vessel halo behind the panel so the map reads on any backdrop.
  g.globalCompositeOperation = 'lighter';
  const halo = g.createRadialGradient(x + w / 2, y + h / 2, 4, x + w / 2, y + h / 2, Math.max(w, h) * 0.75);
  halo.addColorStop(0, 'rgba(0, 245, 212, 0.16)');
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = halo;
  g.fillRect(x - 20, y - 20, w + 40, h + 40);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = 'rgba(6,13,24,0.78)';
  g.beginPath(); g.roundRect(x, y, w, h, 10); g.fill();
  g.strokeStyle = 'rgba(0, 245, 212, 0.6)'; g.lineWidth = 1.5;
  g.beginPath(); g.roundRect(x, y, w, h, 10); g.stroke();
  g.strokeStyle = '#00f5d4'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(x + 10, y + h / 2); g.lineTo(x + w - 10, y + h / 2); g.stroke();
  BODY_MAP_ORGANS.forEach((name, i) => {
    const px = x + 24 + (i / (BODY_MAP_ORGANS.length - 1)) * (w - 48);
    const done = cleared.includes(name);
    const cur = name === currentOrgan;
    if (cur) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      const cg = g.createRadialGradient(px, y + h / 2, 2, px, y + h / 2, 26);
      cg.addColorStop(0, 'rgba(255, 209, 102, 0.55)');
      cg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = cg;
      g.beginPath(); g.arc(px, y + h / 2, 26, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    g.fillStyle = done ? '#00f5d4' : cur ? '#ffd166' : 'rgba(255,255,255,0.35)';
    g.beginPath(); g.arc(px, y + h / 2, cur ? 11 : 7, 0, Math.PI * 2); g.fill();
    if (cur) {
      g.strokeStyle = '#ffd166'; g.lineWidth = 2;
      g.beginPath(); g.arc(px, y + h / 2, 16, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = 'rgba(255, 209, 102, 0.5)'; g.lineWidth = 1;
      g.beginPath(); g.arc(px, y + h / 2, 21, 0, Math.PI * 2); g.stroke();
    }
  });
  g.fillStyle = '#e8fff9'; g.font = '700 14px system-ui, sans-serif'; g.textAlign = 'center';
  g.fillText(currentOrgan, x + w / 2, y + h - 10);
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
