const FEED_ROWS = 6;
const RADIO_ROWS = 5;
function buildRows(parent, n, cls) {
const rows = [];
if (!parent) return rows;
for (let i = 0; i < n; i++) {
const d = document.createElement('div');
d.className = cls;
d.style.opacity = '0';
parent.appendChild(d);
rows.push(d);
}
return rows;
}
export function mkFeeds() {
const feeds = {
feed: buildRows(document.getElementById('killfeed'), FEED_ROWS, 'feed-row'),
radio: buildRows(document.getElementById('radiolog'), RADIO_ROWS, 'radio-row'), fi: 0, ri: 0,
};
return feeds;
}
function pushRow(rows, idx, text, cls) {
if (!rows.length) return idx;
const row = rows[idx];
row.textContent = text;
row.className = cls;
row.style.opacity = '1';
return (idx + 1) % rows.length;
}
export function addKill(feeds, killer, victim, headshot, weaponName) {
if (!feeds) return;
let text = killer + '  ✕  ' + victim;
if (weaponName) text += '  [' + weaponName + ']';
if (headshot) text += '  — HEADSHOT';
feeds.fi = pushRow(feeds.feed, feeds.fi, text, headshot ? 'feed-row hs' : 'feed-row');
}
export function addKillLine(feeds, text) {
if (!feeds || !text) return;
feeds.fi = pushRow(feeds.feed, feeds.fi, text, 'feed-row hs');
}
export function addRadio(feeds, text) {
if (!feeds) return;
feeds.ri = pushRow(feeds.radio, feeds.ri, '» ' + text, 'radio-row');
}
