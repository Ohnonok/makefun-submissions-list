// HUD, buy menu, kill feed, radio log and banners. One job: the DOM overlay.
// The sim never touches the DOM; main.js calls update() once per frame with the
// sim state, and this module writes textContent / styles only when values change.
import { WEAPONS, BUY_ITEMS, ECONOMY } from './weapons.js';
import { MAP } from './map.js';

function $(id) { return document.getElementById(id); }

export class Hud {
  constructor(onBuy, onCloseBuy) {
    this.onBuy = onBuy;
    this.onCloseBuy = onCloseBuy;
    this.cache = {};
    this._buildBuyGrid();
    $('buy-close').addEventListener('click', () => onCloseBuy());
  }
  _set(id, v) {
    if (this.cache[id] !== v) { this.cache[id] = v; const el = $(id); if (el) el.textContent = v; }
  }
  _buildBuyGrid() {
    const grid = $('buy-grid');
    grid.innerHTML = '';
    for (const item of BUY_ITEMS) {
      const div = document.createElement('div');
      div.className = 'buy-item';
      div.dataset.id = item.id;
      div.innerHTML = `<div class="nm">${item.label} <span class="pr">$${item.price}</span></div><div class="ds">[${item.key}] ${item.desc}</div>`;
      div.addEventListener('click', () => this.onBuy(item.id));
      grid.appendChild(div);
      item._el = div;
    }
  }
  fmtTime(t) {
    const s = Math.max(0, Math.ceil(t));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  update(s, p, recoil) {
    this._set('score-ct', String(s.score.CT));
    this._set('score-t', String(s.score.T));
    this._set('round-label', `ROUND ${Math.min(s.round, 9)}/9`);
    const timer = s.bombPlanted ? s.bombTimer : s.roundTimer;
    this._set('timer', this.fmtTime(timer));
    $('timer').classList.toggle('low', timer < 15);
    this._set('bomb-state', s.bombPlanted
      ? `💣 ${s.bombSite} ${this.fmtTime(s.bombTimer)}`
      : (p.hasBomb ? '💣 YOU CARRY THE CHARGE' : ''));
    this._set('money-val', `$${s.money}`);
    this._set('money-sub', s.phase === 'buy' ? 'Buy phase — press B' : s.phase === 'live' ? `Round ${s.round} · first to 5` : '');
    this._set('alive-ct', String(s.actors.filter((a) => a.side === 'CT' && a.alive).length));
    this._set('alive-t', String(s.actors.filter((a) => a.side === 'T' && a.alive).length));
    // Health / armour.
    const hp = Math.max(0, Math.ceil(p.hp));
    this._set('health-num', String(hp));
    $('health').classList.toggle('low', hp <= 30);
    $('health-bar').style.width = `${hp}%`;
    this._set('armor-line', p.armor > 0 ? `🛡 Kevlar ${Math.ceil(p.armor)}${p.hasKit ? ' · Defuse kit' : ''}` : p.hasKit ? 'Defuse kit' : '');
    // Ammo.
    const w = WEAPONS[p.weapon];
    this._set('ammo-mag', String(p.mag));
    this._set('ammo-reserve', `/ ${p.reserve}`);
    $('ammo').classList.toggle('empty', p.mag === 0);
    this._set('weapon-label', p.reloading > 0 ? `${w.name} — reloading…` : w.name);
    this._set('util-label', `Smoke ${p.smoke} · Flash ${p.flash} · ${p.weapon === 'awp' ? 'Right-click to scope' : 'Hold G/F to aim grenade · release to throw'}`);
    // Crosshair gap grows with spread: moving / firing / airborne.
    const gap = 2 + Math.min(14, recoil * 900 + (p.moving ? 4 : 0) + (p.airborne ? 6 : 0));
    $('crosshair').style.setProperty('--gap', `${gap}px`);
    $('crosshair').style.opacity = p.alive ? '1' : '0';
    // Kill feed.
    const kf = $('killfeed');
    const feedHtml = s.feed.slice(-5).map((f) =>
      `<div><span class="${f.killer === 'You' ? 'ct' : 't'}">${f.killer}</span> ✕ <span class="${f.victim === 'You' ? 't' : 'ct'}">${f.victim}</span>${f.head ? ' <span class="hs">HEADSHOT</span>' : ''}</div>`).join('');
    if (this.cache.feed !== feedHtml) { this.cache.feed = feedHtml; kf.innerHTML = feedHtml; }
    // Radio log.
    const rd = $('radio');
    const radioHtml = s.radio.slice(-4).map((r) =>
      `<div class="${r.who === 'sys' ? 'sys' : r.who === 'T' && p.side === 'CT' ? 'enemy' : ''}">${r.who === 'sys' ? '◆' : '📻 ' + r.who} ${r.text}</div>`).join('');
    if (this.cache.radio !== radioHtml) { this.cache.radio = radioHtml; rd.innerHTML = radioHtml; }
    // Plant / defuse prompt + progress.
    const prompt = $('prompt');
    let promptText = '';
    if (p.alive && s.phase === 'live') {
      if (p.side === 'T' && p.hasBomb && !s.bombPlanted) {
        const site = Object.entries(MAP.sites).find(([, st]) => Math.hypot(p.x - st.x, p.z - st.z) < st.r);
        if (site) promptText = s.plantProgress > 0 ? `Planting at ${site[0]}… ${Math.round(s.plantProgress * 100)}%` : `Hold E — plant at ${site[0]} (${site[1].name})`;
        else promptText = 'Carry the charge to Kiln Hall (A) or Brick Yard (B)';
      } else if (p.side === 'CT' && s.bombPlanted && Math.hypot(p.x - s.bombX, p.z - s.bombZ) < 3) {
        promptText = s.defuseProgress > 0 ? `Defusing… ${Math.round(s.defuseProgress * 100)}%` : 'Hold E — defuse the charge';
      } else if (p.side === 'CT' && s.bombPlanted) {
        promptText = `💣 Charge live at ${s.bombSite} — ${this.fmtTime(s.bombTimer)} left`;
      }
    }
    if (promptText) { prompt.hidden = false; if (this.cache.prompt !== promptText) { this.cache.prompt = promptText; prompt.textContent = promptText; } }
    else prompt.hidden = true;
    // Buy menu affordability.
    if (! $('buy').hidden) {
      this._set('buy-cash', `$${s.money}`);
      this._set('buy-round', String(s.round));
      for (const item of BUY_ITEMS) {
        const owned = item.id === 'armor' ? p.armor >= 100 : item.id === 'kit' ? p.hasKit : false;
        item._el.classList.toggle('cant', s.money < item.price && !owned);
        item._el.classList.toggle('owned', owned);
      }
    }
  }
  hitmarker(kill) {
    const h = $('hitmarker');
    h.classList.add('on');
    h.classList.toggle('kill', !!kill);
    clearTimeout(this._hmT);
    this._hmT = setTimeout(() => h.classList.remove('on'), 110);
  }
  damageFlash() {
    const d = $('damage');
    d.classList.add('on');
    clearTimeout(this._dmgT);
    this._dmgT = setTimeout(() => d.classList.remove('on'), 140);
  }
  setFlash(alpha) { $('flash').style.opacity = String(Math.max(0, Math.min(1, alpha))); }
  banner(text, sub, win) {
    const b = $('banner');
    $('banner-big').textContent = text;
    $('banner-big').className = `big ${win === true ? 'win' : win === false ? 'lose' : ''}`;
    $('banner-sub').textContent = sub || '';
    b.hidden = false;
    clearTimeout(this._bnT);
    this._bnT = setTimeout(() => { b.hidden = true; }, 3200);
  }
  showBuy(show) { $('buy').hidden = !show; }
  showMenu(show) { $('menu').hidden = !show; }
  showEnd(show, title, body) {
    $('end').hidden = !show;
    if (show) { $('end-title').textContent = title; $('end-body').textContent = body; }
  }
}
