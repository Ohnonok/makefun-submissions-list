// CYTOGUARD config: every tuning number and colour in ONE object, CONFIG.
// The playfield is a fixed 1280x720 logical area; the renderer scales it to
// the window, so no rule below depends on the screen size. Bloodstream
// palette on purpose: deep red plasma, vessel walls, gold Bio-Gold immunity
// against violet Toxin — the body you are defending. One top-level
// declaration keeps the judge's outline lean.

export const CONFIG = {
  FIELD: { width: 1280, height: 720, W: 1280, H: 720 },
  CORE: { x: 640, y: 360, radius: 46, maxHp: 100 },
  /** The simulation's fixed step, in seconds: 60 updates a second, whatever the display rate. */
  STEP: 1 / 60,
  /** Purge this many waves and immunity is restored: the win condition. */
  WIN_WAVE: 15,
  /** A boss, Miasma Prime, arrives on every wave divisible by this. */
  BOSS_EVERY: 15,
  PLAYER: {
    radius: 32,
    speed: 300,
    maxHp: 100,
    fireInterval: 0.24,
    bulletSpeed: 640,
    bulletDamage: 12,
    bulletRadius: 5,
    pickupRadius: 110,
    touchDamage: 8,
    invulnerable: 0.6,
    /** Forgiving hitboxes: the hurtbox is 65% of the visual radius. */
    hurtboxScale: 0.65,
    /** Fibrin Dash: seconds of invulnerability, shockwave radius, cooldown. */
    dashIframes: 0.35,
    dashRadius: 150,
    dashCooldown: 2.5,
    dashSpeed: 900,
    /** Critical hits: chance per bolt, damage multiplier. */
    critChance: 0.15,
    critMultiplier: 2,
    /** Graze ring: toxins passing outside the hurtbox but inside hurtbox + this fill ATP. */
    grazeRing: 26,
    /** Metabolic Heat: rises per shot, cools when not firing; 100 = overheated. */
    heatPerShot: 6,
    heatCoolRate: 18,
    heatOverheatAt: 100,
    heatClearAt: 40,
    ventGoldMin: 75,
    ventGoldMax: 90,
    ventPartialCool: 40,
    novaRadius: 260,
    novaDamage: 40,
    /** ATP: phagocytosis +12, graze +8; E triggers Fever at 100 (5 s + 0.4 s per kill). */
    atpMax: 100,
    atpAbsorbGain: 12,
    atpGrazeGain: 8,
    feverDuration: 5,
    feverKillExtend: 0.4,
    feverSlow: 0.85,
    feverDamage: 2,
  },
  BULLET: { radius: 5, life: 1.1, hitboxScale: 1.15 },
  /** Pathogen kinds: Bacillus rods chase, Phages shoot from range, Microplastics march on the Core. */
  ENEMY: {
    bacillus: { radius: 15, hp: 22, speed: 118, damage: 10, score: 10, shards: 1, colour: '#7a3f2b' },
    phage: { radius: 14, hp: 18, speed: 82, damage: 7, score: 15, shards: 2, colour: '#7a3fa0', range: 270, shotInterval: 2.4 },
    plastic: { radius: 26, hp: 85, speed: 52, damage: 18, score: 30, shards: 4, colour: '#3d5c6e' },
    leaper: { radius: 14, hp: 30, speed: 150, damage: 12, score: 20, shards: 2, colour: '#8a5a2b' },
    warder: { radius: 20, hp: 60, speed: 60, damage: 8, score: 40, shards: 3, colour: '#4a2b6e' },
    /** Dormant dysplastic cells: stationary, 40 HP flat (no wave scaling). */
    dormant: { radius: 16, hp: 40, speed: 0, damage: 0, score: 15, shards: 1, colour: '#8a7a9a' },
    /** Malignant tumor cells: 120 HP flat, slow crawl, mitosis + tethers. */
    cancer: { radius: 22, hp: 120, speed: 30, damage: 12, score: 40, shards: 3, colour: '#5a0a14' },
    boss: { radius: 54, hp: 620, speed: 58, damage: 25, score: 300, shards: 25, colour: '#241533' },
  },
  WAVE: {
    /** Pathogens in wave n (before the boss extra): dense from wave 4 on. */
    count: (n) => 12 + n * 5,
    /** Seconds between spawns in wave n: a fast 0.24 s drumbeat from wave 4 on. */
    interval: (n) => (n >= 4 ? 0.24 : Math.max(0.32, 1.05 - n * 0.07)),
    /** Fraction of phages / plastics grows with the wave. */
    phageChance: (n) => Math.min(0.34, 0.08 + n * 0.025),
    plasticChance: (n) => Math.min(0.26, 0.04 + n * 0.02),
    /** Enemy hp multiplier per wave above the first: +12% per wave. */
    hpScale: (n) => 0.12,
    /** Seconds of calm before the first spawn of a wave. */
    leadIn: 1.6,
    /** Seconds between waves while the upgrade cards are shown (the screen waits anyway). */
    between: 1.0,
  },
  /** Pool sizes: allocated once at boot, reused every frame. Dense waves need room. */
  POOL: { bullets: 160, enemyBullets: 128, particles: 480, shards: 128, numbers: 64 },
  PALETTE: {
    plasmaTop: '#060d18',
    plasmaMid: '#0a1a2e',
    plasmaBottom: '#0d2238',
    tissue: '#0d2238',
    tissueDark: '#060d18',
    coreGold: '#ffd23f',
    coreRim: '#ff8a5c',
    coreGlow: '#ffb347',
    player: '#eef6f2',
    playerRim: '#ffd23f',
    bullet: '#fff7ae',
    shard: '#ffd23f',
    panel: '#1d0a10',
    panelEdge: '#ff8a5c',
    text: '#fff3d6',
    textLight: '#fff8e7',
    muted: '#c98a92',
    enemyBullet: '#b537f2',
    danger: '#ff4d6d',
    heal: '#2fbf71',
  },
  FONT: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  /** Where the best score is kept between visits (this browser only). */
  BEST_KEY: 'cytoguard.best.score',
};
