// CYTOGUARD v2+ APEX — Bio-Contracts (systems/contracts.js).
// One time-limited Bio-Contract per organ stage, rewarded with +150 GP to
// the Cell Lineage Bank on completion. Tick-driven: 90 s per contract, the
// countdown runs on fixed steps, never wall clock.
export const CONTRACT_REWARD_GP = 150;
export const CONTRACT_DURATION = 90; // seconds.

export const CONTRACT_POOL = [
  { id: 'hijack2', stage: 'lungs', text: 'CONTRACT: HIJACK 2 (+150 GP)', target: 'hijack', count: 2 },
  { id: 'hijack3', stage: 'liver', text: 'CONTRACT: HIJACK 3 (+150 GP)', target: 'hijack', count: 3 },
  { id: 'lysis40', stage: 'cardiac', text: 'CONTRACT: LYSE 40 (+150 GP)', target: 'lysis', count: 40 },
  { id: 'chain30', stage: 'marrow', text: 'CONTRACT: CHAIN x30 (+150 GP)', target: 'chain', count: 30 },
];

export function createContracts() {
  return { active: null, completed: 0, attempted: 0, expired: 0 };
}

/** Start the contract for this organ stage (one at a time). */
export function startContractForStage(contracts, stage) {
  if (contracts.active) return contracts.active;
  const def = CONTRACT_POOL.find((c) => c.stage === stage) || CONTRACT_POOL[0];
  contracts.active = { ...def, progress: 0, timer: CONTRACT_DURATION };
  contracts.attempted += 1;
  return contracts.active;
}

/** Progress + completion + expiry, called every fixed tick. */
export function updateContracts(state, dt) {
  const c = state.contracts;
  if (!c.active) return null;
  c.active.timer -= dt;
  const target = c.active.target;
  if (target === 'hijack') c.active.progress = state.symbiosis.hijacked;
  else if (target === 'lysis') c.active.progress = state.stats.kills;
  else if (target === 'chain') c.active.progress = state.maxChain;
  if (c.active.progress >= c.active.count) {
    const done = c.active;
    c.active = null;
    c.completed += 1;
    if (state.lineage) state.lineage.gp += CONTRACT_REWARD_GP;
    state.lineageGp = (state.lineageGp || 450) + CONTRACT_REWARD_GP;
    state.events.push({ type: 'contract', text: done.text });
    return { done, reward: CONTRACT_REWARD_GP };
  }
  if (c.active.timer <= 0) {
    c.active = null;
    c.expired += 1;
    state.events.push({ type: 'contractExpired' });
    return { expired: true };
  }
  return null;
}
export function contractLine(state) {
  return state.contracts.active ? state.contracts.active.text : null;
}
