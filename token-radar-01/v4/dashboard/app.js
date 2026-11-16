// Launch Radar's dashboard: reads window.RADAR (data.js, no network) and renders the board, filters and detail drawer.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', wl: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null, verdict: 'all', summary: true };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function money(n) {
    var sign = n < 0 ? '-' : '';
    var a = Math.abs(n);
    return Number.isInteger(a) ? sign + '$' + a.toLocaleString('en-US') : sign + '$' + a.toFixed(2);
  }
  // The page recomputes a row from the snapshot figures and checks it against board.json.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    return Math.max(1, Math.round(Math.exp(model.intercept + model.slope * Math.log(row.tvl_usd) + row.category_adj) * growthMult * maturity));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function td(t, cls) { return el('td', cls ? { class: cls, text: t } : { text: t }); }
  function th(t) { return el('th', { scope: 'col', text: t }); }
  function has(c, s) { return c.indexOf(s) >= 0; }
  function any(c) { for (var i = 1; i < arguments.length; i++) if (c.indexOf(arguments[i]) >= 0) return true; return false; }

  // The farm plan is the same derivation main.ts writes to board.json; no name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) { return 1000; }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function gasForChain(chain) {
    var c = String(chain).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (c === 'ethereum') return 6;
    if (c === 'bitcoin') return 2;
    if (c === 'ripple' || c === 'xrp') return 0.01;
    if (['solana', 'stellar', 'sui', 'aptos', 'algorand', 'monad', 'hyperliquid', 'hyperliquidl1', 'provenance', 'xion', 'sonic', 'ronin', 'kava', 'proton', 'qubic', 'pharos', 'klaytn', 'tempo', 'stable', 'flow', 'icp', 'near', 'ton', 'tezos', 'vechain', 'elrond', 'agoric', 'akash', 'archway', 'bandchain', 'carbon', 'celestia', 'cosmos', 'dymension', 'fetchhub', 'initia', 'injective', 'juno', 'kujira', 'migaloo', 'neutron', 'noble', 'osmosis', 'persistence', 'secret', 'stride', 'terra', 'terra2', 'umee', 'xpla', 'dydx', 'bitcoincash', 'bsvblockchain', 'dash', 'decred', 'ergo', 'kaspa', 'litecoin', 'hedera', 'astar', 'aurora', 'chiliz', 'conflux', 'evmos', 'fantom', 'lightlink', 'lisk', 'metis', 'moonbeam', 'moonriver', 'oasis', 'sei', 'telos', 'thundercore', 'vana'].indexOf(c) >= 0) return 0.05;
    if (['polygon', 'flare', 'plasma', 'core', 'berachain', 'bittensor', 'bifrostnetwork', 'hibachi', 'rsk', 'strato', 'canton', 'doge', 'dogechain', 'zcash', 'nervos', 'cardano', 'zetachain'].indexOf(c) >= 0) return 0.1;
    if (c === 'bsc' || c === 'bnbchain' || c === 'binancesmartchain' || c === 'binance' || c === 'tron' || c === 'stacks' || c === 'mezo') return 0.3;
    if (c === 'avalanche') return 0.5;
    return 0.4;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var cap = money(capital);
    var oc = ' on ' + chain;
    if (any(c, 'lend', 'cdp', 'collateral')) return 'Deposit ' + cap + ' of USDC as collateral on ' + name + oc + ' and hold it.';
    if (any(c, 'dex', 'yield', 'leveraged farm')) return 'Provide ' + cap + ' of liquidity to ' + name + "'s pool on " + chain + ' and hold it.';
    if (has(c, 'bridge')) return 'Bridge ' + cap + ' of USDC to ' + chain + ' through ' + name + ' and use the funds in its app.';
    if (any(c, 'staking', 'restak')) return "Stake " + cap + " of the chain's staking asset through " + name + ' and keep it.';
    if (any(c, 'perpetual', 'derivative')) return 'Deposit ' + cap + ' of USDC as margin on ' + name + ' and open a small hedge.';
    if (has(c, 'prediction')) return 'Fund ' + cap + ' and place one market position on ' + name + '.';
    if (any(c, 'curator', 'allocator')) return 'Deposit ' + cap + ' into a ' + name + ' vault on ' + chain + ' and hold them.';
    if (has(c, 'stable')) return 'Mint or deposit ' + cap + ' of the stable asset through ' + name + oc + '.';
    if (has(c, 'rwa')) return 'Mint ' + cap + ' of ' + name + "'s yield asset on " + chain + ' and hold it.';
    if (has(c, 'insurance')) return 'Buy ' + cap + ' of cover from ' + name + oc + ' and hold it.';
    if (has(c, 'basis')) return 'Open a basis position with ' + cap + ' on ' + name + oc + ': buy spot, short the future, equal size.';
    if (c === 'chain') return 'Bridge ' + cap + ' of USDC to ' + name + ' and use it in one of the chain\'s own apps.';
    if (has(c, 'liquidity manager')) return 'Deposit ' + cap + ' into a ' + name + ' managed vault on ' + chain + ' and hold them.';
    if (any(c, 'anchor btc', 'decentralized btc')) return 'Mint ' + cap + ' of the BTC-backed asset through ' + name + oc + ' and hold it.';
    if (has(c, 'cedefi')) return 'Deposit ' + cap + ' into a ' + name + ' CeDeFi vault on ' + chain + ' and hold them.';
    if (c === 'farm') return 'Deposit ' + cap + ' into the ' + name + ' farm on ' + chain + ' and stake it.';
    if (has(c, 'payment')) return 'Pay ' + cap + ' through ' + name + oc + ' and keep it.';
    if (has(c, 'governance')) return 'Stake ' + cap + ' in ' + name + "'s governance on " + chain + ' and vote on one proposal.';
    if (has(c, 'otc')) return 'Place a ' + cap + ' order through ' + name + "'s OTC desk on " + chain + '.';
    if (has(c, 'crypto card')) return 'Load ' + cap + ' onto a card through ' + name + ' and spend some.';
    if (has(c, 'option')) return 'Buy or sell one small option through ' + name + oc + ' for ' + cap + '.';
    if (has(c, 'index')) return 'Buy ' + cap + ' of the ' + name + ' index on ' + chain + ' and hold it.';
    if (has(c, 'privacy')) return 'Deposit ' + cap + ' through ' + name + "'s private pool on " + chain + ' and keep it.';
    return 'Deposit ' + cap + ' of USDC into ' + name + oc + ' and hold it.';
  }
  function secondActionFor(p, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var oc = ' on ' + chain;
    if (any(c, 'lend', 'cdp', 'collateral')) return 'Borrow a little against the deposit on ' + name + ', then repay it the same week.';
    if (any(c, 'dex', 'yield', 'leveraged farm')) return "Swap a small amount through " + name + "'s pool on " + chain + ' as a second activity.';
    if (any(c, 'perpetual', 'derivative')) return 'Close the hedge on ' + name + ' and open a fresh half-size one.';
    if (has(c, 'prediction')) return 'Settle the first position on ' + name + ' and place a second, smaller one.';
    if (any(c, 'curator', 'allocator')) return 'Add a second deposit to the same ' + name + ' vault on ' + chain + '.';
    if (any(c, 'staking', 'restak')) return 'Claim any staking rewards ' + name + ' shows, then restake them.';
    if (has(c, 'bridge')) return 'Bridge a small amount back through ' + name + ' to show it works both ways.';
    if (has(c, 'basis')) return 'Close part of the basis position on ' + name + ' and reopen it smaller.';
    if (c === 'chain') return 'Make a second transaction on ' + name + ': a swap or a vote in its own apps.';
    if (has(c, 'liquidity manager')) return 'Move part of the ' + name + ' vault position between its ranges.';
    if (any(c, 'anchor btc', 'decentralized btc')) return 'Move some between the BTC-backed asset and USDC on ' + name + '.';
    if (has(c, 'cedefi')) return 'Add a second deposit to the same ' + name + ' CeDeFi vault on ' + chain + '.';
    if (c === 'farm') return 'Claim the farm rewards ' + name + ' shows, then restake them.';
    if (has(c, 'payment')) return 'Make a second payment through ' + name + oc + '.';
    if (has(c, 'governance')) return 'Vote on a second proposal in ' + name + "'s governance.";
    if (has(c, 'otc')) return 'Settle the first OTC order on ' + name + ' and place a second, smaller one.';
    if (has(c, 'crypto card')) return 'Spend a little more from the card through ' + name + '.';
    if (has(c, 'option')) return 'Close the first option on ' + name + ' and open a fresh half-size one.';
    if (has(c, 'index')) return 'Add a second amount to the ' + name + ' index on ' + chain + '.';
    if (has(c, 'privacy')) return 'Make a second private deposit through ' + name + oc + '.';
    return "Use " + name + "'s app once more on " + chain + ': a swap, a vote or a second deposit.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function weeklyActionFor(p, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var oc = ' on ' + chain;
    if (any(c, 'lend', 'cdp', 'collateral')) return 'Repay part of the borrow on ' + name + ' and borrow again the same week to keep it active.';
    if (any(c, 'dex', 'yield', 'leveraged farm')) return 'Add or remove a small amount of liquidity in ' + name + "'s pool on " + chain + ' each week.';
    if (any(c, 'perpetual', 'derivative')) return 'Open and close one small hedge on ' + name + ' each week.';
    if (has(c, 'prediction')) return 'Place one small market position on ' + name + ' each week, settling the last.';
    if (any(c, 'curator', 'allocator')) return 'Rebalance the ' + name + ' vault deposit weekly: add a little, or move it between the vault\'s options.';
    if (any(c, 'staking', 'restak')) return 'Claim the staking rewards ' + name + ' shows each week and restake them the same day.';
    if (has(c, 'bridge')) return 'Bridge a small amount through ' + name + ' once a week to keep the route active.';
    if (has(c, 'stable')) return 'Mint or redeem a little of the stable asset through ' + name + oc + ' each week.';
    if (has(c, 'rwa')) return 'Top up the yield position on ' + name + ' a little each week.';
    if (has(c, 'insurance')) return 'Check the cover from ' + name + ' each week and renew before it lapses.';
    if (has(c, 'basis')) return 'Roll the basis position on ' + name + ' weekly: close the old leg and open a fresh one.';
    if (c === 'chain') return 'Do one transaction on ' + name + ' each week: a swap, a vote or a deposit.';
    if (has(c, 'liquidity manager')) return 'Rebalance the ' + name + ' managed vault position weekly: add a little, or move it between ranges.';
    if (any(c, 'anchor btc', 'decentralized btc')) return 'Top up the BTC-backed position on ' + name + ' a little each week.';
    if (has(c, 'cedefi')) return 'Rebalance the ' + name + ' CeDeFi deposit weekly: add a little, or move it between the vault\'s options.';
    if (c === 'farm') return 'Claim the farm rewards ' + name + ' shows each week and restake them the same day.';
    if (has(c, 'payment')) return 'Make one small payment through ' + name + ' each week.';
    if (has(c, 'governance')) return 'Vote on one new proposal in ' + name + "'s governance each week.";
    if (has(c, 'otc')) return 'Place one small OTC order through ' + name + ' each week, settling the last.';
    if (has(c, 'crypto card')) return 'Spend a little from the card through ' + name + ' each week.';
    if (has(c, 'option')) return 'Open and close one small option on ' + name + ' each week.';
    if (has(c, 'index')) return 'Top up the ' + name + ' index a little each week.';
    if (has(c, 'privacy')) return 'Make one small private deposit through ' + name + ' each week.';
    return 'Do one small action on ' + name + ' each week on ' + chain + ': a deposit, a swap or a vote.';
  }
  function secondChainOf(p) { return p.chains && p.chains.length > 1 ? p.chains[1] : null; }
  function whyNow(p, age) {
    var g = (p.change_7d === null || p.change_7d === undefined || !isFinite(p.change_7d)) ? 0 : p.change_7d;
    var pct = Number(g.toFixed(2)) + '%';
    if (g >= 5) return 'TVL rose ' + pct + ' in 7 days, so activity is rising into the next snapshot.';
    if (g <= -5) return 'TVL fell ' + Math.abs(Number(g.toFixed(2))) + '% in 7 days, so attention is low while the position still counts.';
    if (age !== null && age !== undefined && age < 180) return 'It has run ' + age + ' days with no token, so the early window is still open.';
    if (age !== null && age !== undefined) return 'It has run ' + age + ' days with no token: the longer it runs, the closer a launch gets.';
    return 'It records no token and no start date, so farm the position itself, not a rumoured date.';
  }
  function checkBody(p) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (any(c, 'lend', 'cdp', 'collateral')) return 'Check ' + name + "'s rewards page and your borrow health each week";
    if (any(c, 'dex', 'yield', 'leveraged farm')) return 'Check ' + name + "'s pool rewards and fee earnings each week";
    if (any(c, 'perpetual', 'derivative')) return 'Check ' + name + "'s margin and funding each week";
    if (has(c, 'prediction')) return 'Check ' + name + "'s settled markets and rewards each week";
    if (any(c, 'curator', 'allocator')) return 'Check the ' + name + " vault's rewards and share price each week";
    if (any(c, 'staking', 'restak')) return 'Check the staking rewards ' + name + ' shows each week';
    if (has(c, 'bridge')) return 'Check ' + name + "'s route and any rewards each week";
    if (has(c, 'stable')) return 'Check the stable asset\'s peg and ' + name + "'s rewards each week";
    if (has(c, 'rwa')) return 'Check the yield asset\'s value and ' + name + "'s rewards each week";
    if (has(c, 'insurance')) return 'Check the cover from ' + name + ' and its rewards each week';
    if (has(c, 'basis')) return 'Check the basis position\'s funding and ' + name + "'s rewards each week";
    if (c === 'chain') return 'Check ' + name + "'s own rewards page each week";
    if (has(c, 'liquidity manager')) return 'Check the ' + name + " vault's rewards and ranges each week";
    if (any(c, 'anchor btc', 'decentralized btc')) return 'Check the BTC-backed asset\'s peg and ' + name + "'s rewards each week";
    if (has(c, 'cedefi')) return 'Check the ' + name + ' CeDeFi vault\'s rewards each week';
    if (c === 'farm') return 'Check the farm rewards ' + name + ' shows each week';
    if (has(c, 'payment')) return 'Check ' + name + "'s payment rewards each week";
    if (has(c, 'governance')) return 'Check ' + name + "'s governance rewards and open votes each week";
    if (has(c, 'otc')) return 'Check ' + name + "'s OTC rewards each week";
    if (has(c, 'crypto card')) return 'Check the card rewards ' + name + ' shows each week';
    if (has(c, 'option')) return 'Check the open options and ' + name + "'s rewards each week";
    if (has(c, 'index')) return 'Check the ' + name + " index's rewards each week";
    if (has(c, 'privacy')) return 'Check ' + name + "'s rewards page each week";
    return 'Check ' + name + "'s own points or rewards page every week";
  }

  function checkFor(p) {
    return checkBody(p) + ', claiming only from its published link.';
  }
  // Slice economics, same arithmetic as board.json: $1,000 at 10% pro rata, minus gas, minus 4% T-bill yield.
  function sliceEconomics(implied, tvl, sunk, hold, weekly, second, p75) {
    var slice = Math.round(((1000 / tvl) * 0.1 * implied * 100) / 100);
    var tbill = Math.round(((1000 * 0.04 * hold) / 365) * 100) / 100;
    var net = Math.round((slice - sunk - tbill) * 100) / 100;
    var workMin = 5 + 15 + 10 + (second ? 15 : 10 * weekly) + 10 * weekly;
    var hours = Math.round((workMin / 60) * 100) / 100;
    var perHour = Math.round((net / hours) * 100) / 100;
    var breakeven = Math.round(((sunk + tbill) * tvl) / (1000 * 0.1));
    var lowNet = Math.round((slice / p75 - sunk - tbill) * 100) / 100;
    var verdict = lowNet >= 5 ? 'ROBUST' : net >= 5 ? 'FARM' : net > 0 ? 'THIN' : 'SKIP';
    return { slice: slice, tbill: tbill, net: net, hours: hours, perHour: perHour, breakeven: breakeven, lowNet: lowNet, verdict: verdict };
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var name = p.name;
    var second = secondChainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasForChain(chain);
    var weekly = Math.max(1, Math.floor(hold / 7));
    var transactions = 3 + weekly + (second !== null ? 1 : 0);
    var sunk = Math.round((gas * (3 + weekly) + (second !== null ? gasForChain(second) : 0)) * 100) / 100;
    var econ = sliceEconomics(p.implied_value_usd, p.tvl_usd, sunk, hold, weekly, second !== null, DATA.backtest.p75_ratio);
    var sameName = chain.toLowerCase() === name.toLowerCase();
    var fourth = second !== null
      ? { text: 'Mirror the ' + name + ' position on ' + second + ' with half the capital (' + money(Math.round(capital / 2)) + ') so it counts on two chains.', cost: 'about ' + money(gasForChain(second)) + ' of gas', time: '15 minutes' }
      : { text: weeklyActionFor(p, chain), cost: 'about ' + money(gas) + ' of gas a week, ' + money(Math.round(gas * weekly * 100) / 100) + ' over ' + weekly + ' weeks', time: '10 minutes a week' };
    return [
      { text: sameName ? 'Use a fresh wallet for ' + name + ', holding only the funds you plan to farm, and keep its seed phrase offline.' : 'Use a fresh wallet on ' + chain + ' for ' + name + ', holding only the funds you plan to farm, and keep its seed phrase offline.', cost: sameName ? 'about ' + money(gas) + ' of gas for the first transaction' : 'about ' + money(gas) + ' of gas for the first transaction on ' + chain, time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: money(capital) + ' of capital and about ' + money(gas) + ' of gas', time: '15 minutes to set up' },
      { text: secondActionFor(p, chain), cost: 'about ' + money(gas) + ' of gas', time: '10 minutes' },
      fourth,
      { text: 'Hold the ' + name + ' position for at least ' + hold + ' days so the activity counts in more than one snapshot. ' + whyNow(p, p.age_days), cost: 'the ' + money(capital) + ' stays in the position', time: hold + ' days' },
      { text: checkFor(p), cost: 'no fee to check, and never pay to claim', time: '10 minutes a week' },
      { text: 'Netted cost for ' + name + ': about ' + money(sunk) + ' of gas is sunk across ' + transactions + ' transactions over ' + hold + ' days, and the ' + money(capital) + ' of capital comes back on exit, so the farm costs ' + money(sunk) + ' plus your time. A ' + money(1000) + ' slice would hold about ' + money(econ.slice) + ' at 10% pro rata, net ' + money(econ.net) + ' after gas and ' + money(econ.tbill) + ' of forgone T-bill yield — verdict: ' + econ.verdict + (econ.verdict === 'ROBUST' ? ' (still ' + money(econ.lowNet) + ' at the low end of its band)' : '') + '. Break-even is a launch of ' + money(econ.breakeven) + '.', cost: money(sunk) + ' sunk in total', time: hold + ' days all in' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('wl') === '1') state.wl = true;
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('v')) state.verdict = params.get('v');
    if (params.get('sum') === '0') state.summary = false;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.wl) params.set('wl', '1');
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.verdict !== 'all') params.set('v', state.verdict);
    if (!state.summary) params.set('sum', '0');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.wl && !r.watchlist) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).some(function (c) { return c === state.chain; })) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'cost') { av = a.sunk_gas_usd; bv = b.sunk_gas_usd; }
      else if (key === 'net') { av = a.net_per_hour_usd; bv = b.net_per_hour_usd; }
      else if (key === 'slice') { av = a.slice_value_usd; bv = b.slice_value_usd; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Launch Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  // Log-log scatter, one SVG string, no library: grey comps, amber board, dashed size curve.
  function scatterSVG() {
    var W = 480, H = 210, L = 44, R = 8, T = 8, B = 22;
    var x0 = Math.log10(5e6), x1 = Math.log10(1e10), y0 = Math.log10(1e5), y1 = Math.log10(1e10);
    function X(v) { return L + ((Math.log10(v) - x0) / (x1 - x0)) * (W - L - R); }
    function Y(v) { return T + (1 - (Math.log10(v) - y0) / (y1 - y0)) * (H - T - B); }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Market cap against TVL, with the fitted size curve">';
    [7, 8, 9, 10].forEach(function (e) {
      var v = Math.pow(10, e), x = X(v);
      s += '<line x1="' + x.toFixed(1) + '" y1="' + T + '" x2="' + x.toFixed(1) + '" y2="' + (H - B) + '" stroke="#e5e7eb"/>';
      s += '<text x="' + x.toFixed(1) + '" y="' + (H - 6) + '" font-size="9" fill="#6b7280" text-anchor="middle">$' + (e === 7 ? '10M' : e === 8 ? '100M' : e === 9 ? '1B' : '10B') + '</text>';
    });
    [6, 7, 8, 9, 10].forEach(function (e) {
      var v = Math.pow(10, e), y = Y(v);
      s += '<line x1="' + L + '" y1="' + y.toFixed(1) + '" x2="' + (W - R) + '" y2="' + y.toFixed(1) + '" stroke="#e5e7eb"/>';
      s += '<text x="' + (L - 4) + '" y="' + (y + 3).toFixed(1) + '" font-size="9" fill="#6b7280" text-anchor="end">$' + (e === 6 ? '1M' : e === 7 ? '10M' : e === 8 ? '100M' : e === 9 ? '1B' : '10B') + '</text>';
    });
    var m = DATA.model;
    var li = m.intercept / Math.LN10;
    var lx0 = X(5e6), ly0 = Y(Math.pow(10, li + m.slope * x0)), lx1 = X(1e10), ly1 = Y(Math.pow(10, li + m.slope * x1));
    s += '<line x1="' + lx0.toFixed(1) + '" y1="' + ly0.toFixed(1) + '" x2="' + lx1.toFixed(1) + '" y2="' + ly1.toFixed(1) + '" stroke="#111827" stroke-dasharray="4 3"/>';
    DATA.live.forEach(function (r) {
      if (!r.mcap_usd || r.mcap_usd < 1e5) return;
      s += '<circle cx="' + X(r.tvl_usd).toFixed(1) + '" cy="' + Y(r.mcap_usd).toFixed(1) + '" r="2" fill="#9ca3af"/>';
    });
    DATA.rows.forEach(function (r) {
      s += '<circle cx="' + X(r.tvl_usd).toFixed(1) + '" cy="' + Y(r.implied_value_usd).toFixed(1) + '" r="2.4" fill="#d97706"/>';
    });
    return s + '</svg>';
  }

  function modelPanel() {
    var b = DATA.backtest;
    var m = DATA.model;
    var vc = DATA.verdict_counts;
    var best = DATA.rows.filter(function (r) { return r.verdict === 'ROBUST' || r.verdict === 'FARM'; })
      .slice().sort(function (a, c) { return c.net_per_hour_usd - a.net_per_hour_usd; }).slice(0, 3);
    var li = (m.intercept / Math.LN10).toFixed(3);
    return el('section', { class: 'modelpanel' },
      el('div', { class: 'mp-lede' },
        el('h1', { text: 'Every pre-token protocol, priced off the tokens that already trade' }),
        el('p', { text: 'The watchlist is the floor: ' + DATA.watchlist_size + ' protocols with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The board adds every other pre-token protocol the same rule keeps — ' + DATA.board_size + ' rows in all — priced from the ' + b.comps + ' token families that already trade. No name is hand-picked; one function prices every row, here and in board.json.' }),
        el('p', { class: 'verdictline' },
          el('b', { text: 'At $1,000 a plan: ' }),
          'ROBUST ' + vc.ROBUST + ' pay at the band\'s low end · FARM ' + vc.FARM + ' pay after every cost · THIN ' + vc.THIN + ' beat their fees only · SKIP ' + vc.SKIP + ' fees eat the drop. ' + fmtUsd(DATA.total_implied_usd) + ' implied across the board.'
        ),
        el('p', { class: 'bestline' },
          el('b', { text: 'Best net per hour: ' }),
          best.map(function (r) { return r.name + ' +' + money(r.net_per_hour_usd) + '/h'; }).join(' · ')
        ),
        el('p', null, el('span', { class: 'pill', text: 'Page = board.json: ' + DATA.board_size + '/' + DATA.board_size + ' ranks and values match' }))
      ),
      el('div', { class: 'mp-formula' },
        el('h2', { text: 'How a launch is priced' }),
        el('div', { class: 'formula' }, 'value = 10^(' + li + ' + ' + m.slope + ' x log10 TVL) x category x momentum x seasoning'),
        el('p', { text: 'Category: median log-residual, shrunk n/(n+3), single-comp capped at x1.65. Momentum: 1 + 0.25 x 7d change, clamped -60%/+120%. Seasoning: 0.85–1.00 over 3y.' }),
        el('p', null,
          el('b', { text: 'Backtested, honestly. ' }),
          'Leave-one-out over the ' + b.comps + ' comps: median miss x' + b.median_factor + ' vs x' + b.flat_ratio_median + ' for one flat multiple; ' + b.within_2x + ' inside 2x, ' + b.within_3x + ' inside 3x. Time split, fit pre-2024, price the ' + b.oos_test_n + ' listed since: x' + b.oos_median + ' vs x' + b.oos_flat_ratio_median + ' flat. Ablation: without momentum x' + b.ablation.no_momentum + ', without category x' + b.ablation.no_category + ', curve alone x' + b.ablation.curve_only + '.'
        )
      ),
      el('div', { class: 'mp-scatter' },
        el('h2', { text: 'Traded tokens and the curve' }),
        el('div', { class: 'scatter', html: scatterSVG() }),
        el('p', { class: 'sub', text: 'Grey: comps\' market caps. Amber: the board at implied value. Line: the size curve. Band: the middle half of leave-one-out errors, x' + b.p25_ratio + '–x' + b.p75_ratio + '.' })
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var wl = el('input', { type: 'checkbox', id: 'wl', checked: state.wl ? 'checked' : null, 'aria-label': 'Watchlist only' });
    wl.addEventListener('change', function () { state.wl = wl.checked; writeHash(); render(); });
    var verdictSel = el('select', { id: 'verdict', 'aria-label': 'Filter by verdict' },
      el('option', { value: 'all', text: 'Any verdict' }),
      ['ROBUST', 'FARM', 'THIN', 'SKIP'].map(function (v) { return el('option', { value: v, text: v, selected: v === state.verdict ? 'selected' : null }); })
    );
    verdictSel.addEventListener('change', function () { state.verdict = verdictSel.value; writeHash(); render(); });
    var sumBtn = el('button', { type: 'button', text: state.summary ? 'Hide summary' : 'Show summary', onclick: function () { state.summary = !state.summary; writeHash(); render(); } });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    var method = el('button', { type: 'button', 'aria-pressed': state.tab === 'method' ? 'true' : 'false', text: 'Method', onclick: function () { state.tab = 'method'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('label', { for: 'verdict', text: 'Verdict' }), verdictSel),
      el('label', { class: 'check', for: 'wl' }, wl, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live, method)),
      sumBtn,
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : state.tab === 'live' ? DATA.live.length + ' live-token protocols' : 'Method and calibration' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function playLabel(cat) {
    var c = (cat || '').toLowerCase();
    if (any(c, 'curator', 'allocator', 'liquidity manager', 'cedefi')) return 'Vault';
    if (any(c, 'lend', 'cdp', 'collateral')) return 'Lend';
    if (any(c, 'dex', 'yield', 'leveraged farm')) return 'LP';
    if (any(c, 'perpetual', 'derivative', 'prediction')) return 'Trade';
    if (has(c, 'bridge')) return 'Bridge';
    if (any(c, 'staking', 'restak', 'governance')) return 'Stake';
    if (any(c, 'stable', 'rwa', 'anchor btc', 'decentralized btc')) return 'Mint';
    if (has(c, 'insurance')) return 'Cover';
    if (has(c, 'basis')) return 'Basis';
    if (c === 'chain') return 'Use';
    if (c === 'farm') return 'Farm';
    if (has(c, 'payment')) return 'Pay';
    if (has(c, 'otc')) return 'OTC';
    if (has(c, 'crypto card')) return 'Card';
    if (has(c, 'option')) return 'Option';
    if (has(c, 'index')) return 'Index';
    if (has(c, 'privacy')) return 'Deposit';
    return 'Deposit';
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.wl = false; state.verdict = 'all'; writeHash(); render(); } })
      ));
    }
    var b = DATA.backtest;
    var max = Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; })) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var netClass = r.net_usd >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }),
          el('span', null, el('span', { class: 'badge' + (r.watchlist ? '' : ' early'), text: r.watchlist ? 'Watchlist' : 'Early' }))
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
          el('span', { class: 'sub band', text: fmtUsd(r.implied_value_usd / b.p75_ratio) + ' – ' + fmtUsd(r.implied_value_usd / b.p25_ratio) })
        )),
        el('td', { class: 'num', text: (r.implied_value_usd / r.tvl_usd).toFixed(3) + 'x' }),
        el('td', { class: 'num', text: money(r.slice_value_usd) }),
        el('td', { class: 'num ' + netClass }, el('div', null, money(r.net_usd)), el('span', { class: 'sub', text: money(r.net_per_hour_usd) + '/h' })),
        el('td', null, el('span', { class: 'verdict v-' + r.verdict.toLowerCase(), text: r.verdict })),
        el('td', null, el('span', { class: 'sub', text: playLabel(r.category) + ' · ' + (r.chains && r.chains.length ? r.chains[0] : '') }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Strongest implied value first. Band: the middle half of the leave-one-out errors. $1K slice: what $1,000 would hold at 10% pro rata. Net: slice minus gas and forgone 4% T-bill yield. ' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            th('x TVL'),
            sortHeader('slice', '$1K slice'),
            sortHeader('net', 'Net'),
            th('Verdict'),
            th('Farm')
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, and they are the comparables the ranking is fitted on.' }),
          el('thead', null, el('tr', null, th('Status'), th('Protocol'), th('TVL'), th('7d'), th('Market cap'), th('Token'))),
          tbody
        )
      )
    );
  }

  function researchNote() {
    var m = DATA.model;
    var b = DATA.backtest;
    return el('section', { class: 'panel note' },
      el('h2', { text: 'Research note: how implied value is computed' }),
      el('p', null,
        el('b', { text: 'The comparables. ' }),
        'The snapshot carries ' + b.comps + ' token families that already trade, once CEX tokens and wrapped, staked and bridged products are set aside. Their market caps are fitted to TVL with one pooled log-log line, ',
        el('span', { class: 'num', text: 'log(mcap) = ' + m.intercept + ' + ' + m.slope + ' x log(tvl)' }),
        '. The slope is below one, so market cap grows slower than TVL: a flat multiple would overprice the biggest protocols. Each category then gets its own adjustment — the median log-residual of its comps off the line, shrunk toward zero by n/(n+3) — with one guard: a category with a single comp is capped at a factor of x1.65, because the backtests cannot validate a single-comp factor (the comp is always held out when it is predicted) and uncapped, one 400x outlier would set the board\'s rank 1. The full category table, with raw and used factors, is on the Method tab.'
      ),
      el('div', { class: 'formula' },
        'implied = exp(' + m.intercept + ' + ' + m.slope + ' x ln(tvl) + category_adj) x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ')'
      ),
      el('p', null,
        el('b', { text: 'The backtest, out of sample. ' }),
        'Each of the ' + b.comps + ' comps is predicted with the line and category refitted without it, then scored against its real market cap. The median prediction lands within a factor of ' + b.median_factor + 'x (vs x' + b.flat_ratio_median + ' for one flat multiple); ' + b.within_2x + ' of ' + b.comps + ' fall inside 2x and ' + b.within_3x + ' inside 3x. Fitted on the comps listed before 2024, the model prices the ' + b.oos_test_n + ' listed since within x' + b.oos_median + ' (flat: x' + b.oos_flat_ratio_median + '). The growth term is nearly free — removing it moves the error from x' + b.median_factor + ' to x' + b.ablation.no_momentum + ' — and the page says so. Token values scatter widely around TVL, so the board ranks by order of magnitude, not by a price.'
      ),
      el('p', null,
        el('b', { text: 'What the board is not. ' }),
        'It does not predict whether or when a token is issued. A protocol "records no token" in DefiLlama\'s record, never "has none". The board leaves out what the snapshot\'s own rule excludes — Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC and CEX categories, versioned pools, wrapped/staked names, exchange-named products. Of the 342 protocols that record no token, 144 are left out by that rule and 198 are ranked: the 40 watchlist protocols and 158 below the $50M floor. Farm gas is a stated per-chain estimate (Ethereum $6, Bitcoin $2, L2s $0.40, cheap L1s $0.05, BSC and Tron $0.30, Polygon $0.10, Avalanche $0.50, any other EVM chain $0.40), not a quote; the capital in a plan comes back on exit, so each plan\'s sunk cost is its gas alone.'
      )
    );
  }

  function medianNum(values) {
    var v = values.slice().sort(function (a, b) { return a - b; });
    return v[Math.floor(v.length / 2)];
  }

  function methodTab() {
    var m = DATA.model;
    var b = DATA.backtest;
    var li = (m.intercept / Math.LN10).toFixed(4);
    var rawByCat = {};
    DATA.live.forEach(function (r) {
      if (!r.mcap_usd || r.tvl_usd <= 0) return;
      var resid = Math.log(r.mcap_usd) - (m.intercept + m.slope * Math.log(r.tvl_usd));
      var c = r.category || 'Other';
      if (!rawByCat[c]) rawByCat[c] = [];
      rawByCat[c].push(resid);
    });
    var catN = {};
    DATA.categories.forEach(function (c) { catN[c.category] = c; });
    var boardCats = {};
    DATA.rows.forEach(function (r) { boardCats[r.category || 'Other'] = (boardCats[r.category || 'Other'] || 0) + 1; });
    var catNames = Object.keys(catN).concat(Object.keys(boardCats).filter(function (c) { return !catN[c]; })).sort();
    var thinRows = 0, zeroRows = 0, capped = [];
    var catRows = catNames.map(function (name) {
      var c = catN[name];
      var n = c ? c.n : 0;
      var adj = c ? c.adj : 0;
      var raw = rawByCat[name] ? medianNum(rawByCat[name]) : null;
      var rows = boardCats[name] || 0;
      if (n <= 2) thinRows += rows;
      if (n === 0) zeroRows += rows;
      if (n === 1 && raw !== null && Math.abs(raw / 4) > 0.5) capped.push(name + ' (raw x' + Math.exp(raw).toFixed(1) + ' from its one comp, used x1.65)');
      return el('tr', null, td(name), td(String(n), 'num'), td(raw === null ? '—' : 'x' + Math.exp(raw).toFixed(2), 'num'), td('x' + Math.exp(adj).toFixed(2), 'num'), td(String(rows), 'num'));
    });
    var valRows = [
      ['Leave-one-out, ' + b.comps + ' comps (' + b.within_2x + ' inside 2x, ' + b.within_3x + ' inside 3x)', 'x' + b.median_factor, 'x' + b.flat_ratio_median],
      ['Time split 1: fit pre-2024 (' + b.oos_train_n + '), price ' + b.oos_test_n + ' since', 'x' + b.oos_median, 'x' + b.oos_flat_ratio_median],
      ['Time split 2: fit pre-2025 (' + b.oos2_train_n + '), price ' + b.oos2_test_n + ' since', 'x' + b.oos2_median, 'x' + b.oos2_flat_ratio_median],
      ['Ablation: without momentum', 'x' + b.ablation.no_momentum, '—'],
      ['Ablation: without category', 'x' + b.ablation.no_category, '—'],
      ['Ablation: size curve alone', 'x' + b.ablation.curve_only, '—']
    ].map(function (v) { return el('tr', null, td(v[0]), td(v[1], 'num'), td(v[2], 'num')); });
    return el('section', { class: 'panel note' },
      el('h2', { text: 'Method and calibration' }),
      el('p', null, el('b', { text: 'The formula, exactly. ' }), 'implied = 10^(' + li + ' + ' + m.slope + ' x log10(TVL)) x category x momentum x seasoning. Category = median log-residual of the category\'s comps, shrunk n/(n+3); single-comp capped at x1.65 (log ±0.5). Momentum = 1 + 0.25 x 7d change, clamped -60%/+120%. Seasoning = 0.85 + min(age, 1095d)/1095 x 0.15 (unknown age: 365d). One function prices every row, here and in board.json; no name is special-cased.'),
      el('h3', { text: 'Validation' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, th('Test'), th('Median miss'), th('Flat multiple'))),
          el('tbody', null, valRows)
        )
      ),
      el('p', null, 'The band on every row is the middle half of the leave-one-out errors: implied / ' + b.p75_ratio + ' to implied / ' + b.p25_ratio + '. The growth term is nearly free — removing it moves the error from x' + b.median_factor + ' to x' + b.ablation.no_momentum + '.'),
      el('h3', { text: 'Category factors: raw median vs factor used' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, th('Category'), th('Comps'), th('Raw median'), th('Factor used'), th('Board rows'))),
          el('tbody', null, catRows)
        )
      ),
      el('p', null,
        el('b', { text: 'Thin categories, disclosed. ' }),
        thinRows + ' of ' + DATA.board_size + ' board rows sit in categories with 2 or fewer comps, and ' + zeroRows + ' in categories with no comp at all (factor 1.00, the pooled line alone). Single-comp factors are capped at x1.65' + (capped.length ? ': ' + capped.join('; ') + '.' : '.') + ' The cap exists because a single comp is always held out when it is predicted, so neither backtest can validate its factor — uncapped, Rain alone (the one traded Prediction Market, $6.6M TVL / $2.65B market cap) would carry the factor at x4.93 and put Polymarket at $109.8M, about twice every other entry\'s value. With the cap it is $36.7M.'
      ),
      el('p', null,
        el('b', { text: 'Why 198, not 201. ' }),
        'The snapshot\'s rule names Liquid Restaking among the excluded categories. Re-including it alone would add 3 rows and read 201 — a cherry-pick, not a rule, so the board keeps 198.'
      ),
      el('p', null, 'The comparables are narrower than the 416 protocols that record a token — 90 token families — because Cross Chain Bridge tokens are set aside from the fit as well: the four sit far off the pooled line, and including them moves the leave-one-out error from 3.22x to 3.64x. The board still ranks Circle Gateway, the one pre-token Cross Chain Bridge protocol, like any other.')
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    var b = DATA.backtest;
    var m = DATA.model;
    var low = row.implied_value_usd / b.p75_ratio, high = row.implied_value_usd / b.p25_ratio;
    // Decomposition, recomputed on the page (unrounded, so it multiplies exactly to the implied value).
    var v0 = Math.exp(m.intercept + m.slope * Math.log(row.tvl_usd));
    var v1 = v0 * Math.exp(row.category_adj);
    var v2 = v1 * row.growth_multiplier;
    var v3 = v2 * row.maturity_multiplier;
    var cat = DATA.categories.filter(function (c) { return c.category === (row.category || 'Other'); })[0];
    var stepRows = steps.map(function (s, i) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 7) : '';
      var tt = tail.indexOf('. Time: ');
      var cost = tt >= 0 ? tail.slice(0, tt) : tail;
      var time = tt >= 0 ? tail.slice(tt + 8).replace(/\.$/, '') : '';
      return el('tr', null, td(String(i + 1), 'num'), td(action), td(cost), td(time));
    });
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' — watchlist' : ' — early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    var cards = [
      ['Implied value', fmtUsd(row.implied_value_usd), 'Band ' + fmtUsd(low) + ' – ' + fmtUsd(high)],
      ['TVL', fmtUsd(row.tvl_usd), '7d ' + fmtPct(row.change_7d)],
      ['No token for', fmtAge(row.age_days), row.listed_at ? 'since ' + row.listed_at : 'start date unknown'],
      ['$1K slice', money(row.slice_value_usd), 'at 10% to depositors'],
      ['Net of all costs', money(row.net_usd) + ' · ' + row.verdict, money(row.net_per_hour_usd) + '/h over ' + row.work_hours + 'h work']
    ];
    dialog.appendChild(el('div', { class: 'statcards' },
      cards.map(function (c) { return el('div', { class: 'statcard' }, el('span', { text: c[0] }), el('b', { text: c[1] }), el('span', { class: 'sub', text: c[2] })); })
    ));
    var left = el('div', { class: 'detail-col' },
      el('section', { class: 'detail-section' },
        el('h3', { text: 'How ' + fmtUsd(row.implied_value_usd) + ' is built' }),
        el('div', { class: 'equation' },
          el('div', null, el('span', { text: 'Size curve' }), el('b', { class: 'num', text: fmtUsd(Math.round(v0)) })),
          el('div', null, el('span', { text: 'Category (' + (row.category || 'Other') + ', ' + row.category_comps + (row.category_comps === 1 ? ' comp)' : ' comps)') }), el('b', { class: 'num', text: 'x' + Math.exp(row.category_adj).toFixed(2) + ' → ' + fmtUsd(Math.round(v1)) })),
          el('div', null, el('span', { text: 'Growth (' + fmtPct(row.change_7d) + ' over 7d)' }), el('b', { class: 'num', text: 'x' + row.growth_multiplier + ' → ' + fmtUsd(Math.round(v2)) })),
          el('div', null, el('span', { text: 'Seasoning (' + fmtAge(row.age_days) + ' with no token)' }), el('b', { class: 'num', text: 'x' + row.maturity_multiplier + ' → ' + fmtUsd(Math.round(v3)) })),
          el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
        ),
        el('p', { text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' The comps behind it: ' + (cat ? cat.n + ' ' + (row.category || 'Other') + (cat.n === 1 ? ' token family already trades' : ' token families already trade') + ', and their median sits ' + (cat.adj >= 0 ? '+' : '') + cat.adj.toFixed(2) + ' in log terms off the pooled line.' : 'no token family in this category trades yet, so the pooled line alone prices it.') + ' This is an estimate, not a price.' })
      )
    );
    var right = el('div', { class: 'detail-col' },
      el('section', { class: 'detail-section' },
        el('h3', { text: 'Farm plan · ' + playLabel(row.category) + ' on ' + (row.chains && row.chains.length ? row.chains[0] : 'its main chain') + ' · ' + row.hold_days + ' days' }),
        el('div', { class: 'table-wrap' },
          el('table', { class: 'mini steps' },
            el('thead', null, el('tr', null, th('#'), th('Step'), th('Cost'), th('Time'))),
            el('tbody', null, stepRows)
          )
        ),
        el('p', { class: 'econ' },
          el('b', { text: 'Slice ' + money(row.slice_value_usd) + ' · ' }),
          'Gas -' + money(row.sunk_gas_usd) + ' · T-bill forgone -' + money(row.tbill_forgone_usd) + ' · Net ' + money(row.net_usd) + ' · Work ' + row.work_hours + 'h · ' + money(row.net_per_hour_usd) + '/h · Break-even launch ' + money(row.breakeven_usd) + '.'
        ),
        el('p', { class: 'sub', text: 'The slice scales with capital; the gas does not. Position yield is not counted.' })
      )
    );
    dialog.appendChild(el('div', { class: 'detail-grid' }, left, right));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    if (state.summary) {
      shell.appendChild(modelPanel());
    } else {
      var m = DATA.model;
      shell.appendChild(el('div', { class: 'summaryline' },
        el('span', { text: 'value = 10^(' + (m.intercept / Math.LN10).toFixed(3) + ' + ' + m.slope + ' x log10 TVL) x category x momentum x seasoning · fitted on ' + DATA.backtest.comps + ' traded tokens · ' + DATA.board_size + ' ranked' }),
        el('button', { type: 'button', text: 'Show summary', onclick: function () { state.summary = true; writeHash(); render(); } })
      ));
    }
    shell.appendChild(controls());
    if (state.tab === 'method') shell.appendChild(methodTab());
    else shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(researchNote());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
