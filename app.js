'use strict';
const VERSION = 'v1 · Nov 2026';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('jm-' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('jm-' + k, JSON.stringify(v)); } catch (e) {} }
};
const CT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const ct = (d) => d ? CT.format(new Date(d)) + ' CT' : '—';
const fmt = (n, dp = 2) => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const pct = (n, dp = 2) => (n == null || isNaN(n)) ? '—' : fmt(n, dp) + '%';
const sign = (n) => n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
const arrow = (n) => n > 0 ? '▲' : n < 0 ? '▼' : '•';
const plus = (n, dp = 2) => (n == null) ? '—' : (n > 0 ? '+' : '') + fmt(n, dp);
const SYM = { JMD: 'J$', USD: 'US$', GBP: '£', CAD: 'C$', EUR: '€' };
const NAMES = { USD: 'US dollar', GBP: 'British pound', CAD: 'Canadian dollar', EUR: 'Euro', JMD: 'Jamaican dollar' };
const money = (n, cur, dp = 2) => (SYM[cur] || '') + fmt(n, dp);

const S = { rates: null, boj: null, jse: null, live: null, cur: 'all', mkt: 'all', q: '', watch: new Set(store.get('watch', [])) };

async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return r.json();
}

/* ---------- Tabs ---------- */
function showTab(name, push = true) {
  $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $$('.tab').forEach((t) => { const on = t.id === 'tab-' + name; t.hidden = !on; t.classList.toggle('on', on); });
  if (push) history.replaceState(null, '', '#' + name);
  window.scrollTo(0, 0);
}
$$('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

/* ---------- Theme ---------- */
function syncTheme() {
  const dark = document.documentElement.classList.contains('dark');
  const b = $('#themeBtn'); b.setAttribute('aria-pressed', dark); b.textContent = dark ? 'Light mode' : 'Dark mode';
  document.querySelector('meta[name=theme-color]').content = dark ? '#0b0b0b' : '#0b6b34';
}
$('#themeBtn').addEventListener('click', () => {
  const dark = document.documentElement.classList.toggle('dark'); store.set('theme', dark ? 'dark' : 'light');
  try { localStorage.setItem('jm-theme', dark ? 'dark' : 'light'); } catch (e) {}
  syncTheme();
});

/* ---------- Rates ---------- */
function renderBoj() {
  const b = S.boj, r = S.rates, el = $('#bojCards');
  if (!b) { el.innerHTML = '<div class="card">Could not load Bank of Jamaica data. <a href="https://boj.org.jm/" target="_blank" rel="noopener">See boj.org.jm</a></div>'; return; }
  const cards = [];
  if (b.policy) cards.push(`<div class="card kpi"><div class="k">BOJ policy rate</div><div class="v">${pct(b.policy.rate)}</div><div class="d">Set ${esc(b.policy.since)}. Next decision ${esc(b.policy.next)}. <a href="${esc(b.policy.source)}" target="_blank" rel="noopener">Source</a></div></div>`);
  if (b.cd30) cards.push(`<div class="card kpi"><div class="k">BOJ 30-day CD</div><div class="v">${pct(b.cd30.rate)}</div><div class="d">Fixed rate offered at the ${esc(b.cd30.date)} auction. <a href="${esc(b.cd30.source)}" target="_blank" rel="noopener">Source</a></div></div>`);
  if (r && r.tbills) { const t = r.tbills.items[0]; cards.push(`<div class="card kpi"><div class="k">91-day T-bill</div><div class="v">${pct(t.avg)}</div><div class="d">Average yield, ${esc(r.tbills.auction)} auction. <a href="${esc(r.tbills.source)}" target="_blank" rel="noopener">Source</a></div></div>`); }
  if (b.inflation) cards.push(`<div class="card kpi"><div class="k">Inflation</div><div class="v">${pct(b.inflation.rate, 1)}</div><div class="d">12 months to ${esc(b.inflation.month)}. BOJ target ${b.target ? b.target[0] + '–' + b.target[1] + '%' : '4–6%'}. <a href="${esc(b.inflation.source)}" target="_blank" rel="noopener">Source</a></div></div>`);
  el.innerHTML = cards.join('');
}
function renderTbills() {
  const t = S.rates && S.rates.tbills; if (!t) return;
  $('#tbDate').textContent = '· auction ' + t.auction;
  $('#tbCard').innerHTML = `<table class="tbl"><tr><th>Term</th><th>Matures</th><th class="n">Average yield</th></tr>${t.items.map((i) => `<tr><td>${esc(i.term)}</td><td>${esc(i.matures)}</td><td class="n"><b>${pct(i.avg, 3)}</b></td></tr>`).join('')}</table>
  <p class="fine">Government of Jamaica Treasury bills, J$ only. Next auction: ${esc(t.next)}. <a href="${esc(t.source)}" target="_blank" rel="noopener">BOJ auction results</a></p>`;
}
function renderRates() {
  const list = $('#rateList'); if (!S.rates) { list.innerHTML = '<div class="card empty">Could not load rates. Check your connection and open More → Check for new data.</div>'; return; }
  let items = S.rates.rates.filter((r) => S.cur === 'all' || r.cur === S.cur);
  const by = $('#rateSort').value;
  items.sort((a, b) => by === 'provider' ? a.provider.localeCompare(b.provider) : ((b.value ?? -1) - (a.value ?? -1)) || ((b.g12 ?? -99) - (a.g12 ?? -99)));
  list.innerHTML = items.map((r) => {
    const has = r.value != null;
    const big = has ? `<div class="big">${pct(r.value)}<small>${esc(r.label)}</small></div>` : `<div class="big na">${r.kind === 'none' ? 'See provider' : esc(r.label)}</div>`;
    const growth = (r.g12 != null || r.ytd != null) ? `<div class="meta">Past growth: 12 months <b>${pct(r.g12)}</b> · this year <b>${pct(r.ytd)}</b></div>` : '';
    const asof = r.asOf ? `As of <b>${esc(r.asOf)}</b>` : 'No current rate published on the provider’s public page';
    return `<article class="card rate"><div class="hd"><div><div class="prov">${esc(r.provider)}</div><div class="prod">${esc(r.product)}</div></div>${big}</div>
      <div><span class="tag ${r.cur}">${r.cur === 'JMD' ? 'J$' : 'US$'}</span>${r.min ? `<span class="tag">Min ${esc(r.min)}</span>` : ''}</div>
      ${growth}${r.note ? `<div class="meta">${esc(r.note)}</div>` : ''}
      <div class="srcline meta">${asof} · <a href="${esc(r.source)}" target="_blank" rel="noopener">${has || r.kind !== 'none' ? 'Source' : 'Open provider site'}</a></div></article>`;
  }).join('') || '<div class="card empty">No options match.</div>';
  const tax = S.rates.tax;
  if (tax) $('#taxNote').innerHTML = `<b>Tax on interest:</b> ${esc(tax.text)} Sources: ${tax.sources.map((s, i) => `<a href="${esc(s)}" target="_blank" rel="noopener">PwC ${i + 1}</a>`).join(', ')}.`;
  $('#ratesUpdated').textContent = 'Rates list last checked ' + ct(S.rates.fetched) + '. Funds marked with a yield publish one; others show past growth only. Growth is not a promise of future returns.';
}
$$('[data-cur]').forEach((b) => b.addEventListener('click', () => { S.cur = b.dataset.cur; $$('[data-cur]').forEach((x) => x.classList.toggle('on', x === b)); renderRates(); }));
$('#rateSort').addEventListener('change', renderRates);

/* ---------- Stocks ---------- */
function renderStocks() {
  const j = S.jse;
  if (!j) { $('#jseMeta').innerHTML = 'Could not load stock prices. <a href="https://www.jamstockex.com/trading/trade-quotes/" target="_blank" rel="noopener">See jamstockex.com</a>'; return; }
  const d = new Date(j.tradeDate + 'T12:00:00');
  $('#jseMeta').innerHTML = `Closing prices for <b>${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</b>. Last updated ${ct(j.fetched)}. <a href="${esc(j.source)}" target="_blank" rel="noopener">Source: Jamaica Stock Exchange</a>`;
  $('#idxList').innerHTML = j.indices.map((i) => `<div class="card ix"><div class="nm">${esc(i.name)}</div><div class="val">${fmt(i.value)}<span class="chg ${sign(i.change)}">${arrow(i.change)} ${plus(i.change)} (${plus(i.pct)}%)</span></div></div>`).join('');
  const traded = j.stocks.filter((s) => s.vol > 0 && s.pct != null && !s.suspended);
  const g = [...traded].filter((s) => s.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, 5);
  const l = [...traded].filter((s) => s.pct < 0).sort((a, b) => a.pct - b.pct).slice(0, 5);
  const mini = (arr) => arr.length ? arr.map((s) => `<div class="m"><b>${esc(s.sym)}</b><span>${money(s.close, s.cur)}</span><span class="${sign(s.pct)}">${plus(s.pct)}%</span></div>`).join('') : '<div class="m empty">None today</div>';
  $('#gainers').innerHTML = mini(g); $('#losers').innerHTML = mini(l);
  renderStockList();
}
function renderStockList() {
  const j = S.jse; if (!j) return;
  const q = S.q.trim().toLowerCase();
  let arr = j.stocks.filter((s) => {
    if (S.mkt === 'watch' && !S.watch.has(s.sym)) return false;
    if (['Main', 'Junior', 'USD'].includes(S.mkt) && s.market !== S.mkt) return false;
    return !q || s.sym.toLowerCase().includes(q) || s.name.toLowerCase().includes(q);
  });
  $('#stockCount').textContent = S.mkt === 'watch' && !S.watch.size ? 'Your watchlist is empty. Tap the ☆ next to any stock to add it.' : `${arr.length} of ${j.stocks.length} listings`;
  const cap = 200;
  $('#stockList').innerHTML = arr.slice(0, cap).map((s) => {
    const w = S.watch.has(s.sym);
    return `<div class="st" data-sym="${esc(s.sym)}"><div class="line">
      <button type="button" class="star ${w ? 'on' : ''}" aria-pressed="${w}" aria-label="${w ? 'Remove ' : 'Add '}${esc(s.sym)} ${w ? 'from' : 'to'} watchlist">${w ? '★' : '☆'}</button>
      <button type="button" class="who" aria-expanded="false"><span class="sym">${esc(s.sym)}</span> <span class="tag">${esc(s.market)}</span><span class="nm">${esc(s.name)}</span></button>
      <div class="px">${money(s.close, s.cur)}<span class="chg ${sign(s.chg)}">${arrow(s.chg)} ${plus(s.chg)}${s.pct != null ? ` (${plus(s.pct)}%)` : ''}</span></div></div>
      <div class="det"><dl>
        <dt>Last trade</dt><dd>${money(s.last, s.cur)}</dd>
        <dt>Bid / Ask</dt><dd>${money(s.bid, s.cur)} / ${money(s.ask, s.cur)}</dd>
        <dt>Volume</dt><dd>${fmt(s.vol, 0)} shares</dd>
        <dt>52-week range</dt><dd>${money(s.lo52, s.cur)} – ${money(s.hi52, s.cur)}</dd>
        <dt>Type</dt><dd>${esc(s.type)}${s.suspended ? ' · trading suspended' : ''}</dd>
      </dl>${s.id ? `<a href="https://www.jamstockex.com/trading/instruments/?instrument=${esc(s.id)}" target="_blank" rel="noopener">Company page on jamstockex.com</a>` : ''}</div></div>`;
  }).join('') || '<div class="empty">No stocks match your search.</div>';
}
$('#stockList').addEventListener('click', (e) => {
  const row = e.target.closest('.st'); if (!row) return;
  const sym = row.dataset.sym;
  if (e.target.closest('.star')) {
    S.watch.has(sym) ? S.watch.delete(sym) : S.watch.add(sym); store.set('watch', [...S.watch]); renderStockList(); return;
  }
  if (e.target.closest('.who')) { row.classList.toggle('open'); $('.who', row).setAttribute('aria-expanded', row.classList.contains('open')); }
});
$('#stockSearch').addEventListener('input', (e) => { S.q = e.target.value; renderStockList(); });
$$('[data-mkt]').forEach((b) => b.addEventListener('click', () => { S.mkt = b.dataset.mkt; $$('[data-mkt]').forEach((x) => x.classList.toggle('on', x === b)); renderStockList(); }));

/* ---------- Exchange ---------- */
async function loadLive() {
  const note = $('#liveFxNote');
  const tryer = async () => {
    try {
      const d = await getJSON('https://open.er-api.com/v6/latest/USD');
      if (d.result !== 'success') throw new Error('bad');
      return { usd: d.rates, time: d.time_last_update_unix * 1000, src: 'ExchangeRate-API (open.er-api.com)', url: 'https://www.exchangerate-api.com/' };
    } catch (e) {
      const d = await getJSON('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json');
      const up = {}; Object.keys(d.usd).forEach((k) => { up[k.toUpperCase()] = d.usd[k]; });
      return { usd: up, time: new Date(d.date + 'T00:00:00Z').getTime(), src: 'Free Currency Exchange Rates API (jsDelivr)', url: 'https://github.com/fawazahmed0/exchange-api', dateOnly: true };
    }
  };
  try {
    S.live = await tryer(); store.set('live', S.live);
  } catch (e) {
    S.live = store.get('live', null);
    if (S.live) S.live.stale = true;
  }
  renderLive(); convert(); renderCalc();
}
function liveJmdPer(c) { // J$ per 1 unit of c
  if (!S.live) return null; const u = S.live.usd; if (!u.JMD || !u[c]) return null;
  return u.JMD / u[c];
}
function renderLive() {
  const t = $('#liveFx'), note = $('#liveFxNote');
  if (!S.live) { t.innerHTML = '<tr><td>Live rates are not available right now. Check your connection.</td></tr>'; note.textContent = ''; return; }
  t.innerHTML = '<tr><th>Currency</th><th class="n">J$ per 1</th></tr>' + ['USD', 'GBP', 'CAD', 'EUR'].map((c) => `<tr><td>${SYM[c]} ${NAMES[c]}</td><td class="n"><b>${fmt(liveJmdPer(c), 4)}</b></td></tr>`).join('');
  note.innerHTML = `Mid-market rate from <a href="${S.live.url}" target="_blank" rel="noopener">${esc(S.live.src)}</a>, updated ${S.live.dateOnly ? new Date(S.live.time).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }) : ct(S.live.time)}.${S.live.stale ? ' <b>Offline: showing the last rates saved on this device.</b>' : ''} Checked ${ct(Date.now())}.`;
}
function renderBojFx() {
  const f = S.boj && S.boj.fx;
  if (!f) { $('#bojFx').innerHTML = '<tr><td>BOJ rates not available. <a href="https://boj.org.jm/" target="_blank" rel="noopener">See boj.org.jm</a></td></tr>'; return; }
  $('#bojFxDate').textContent = '· ' + f.date;
  $('#bojFx').innerHTML = '<tr><th>Currency</th><th class="n">BOJ buys at</th><th class="n">BOJ sells at</th></tr>' + Object.entries(f.rates).map(([c, v]) => `<tr><td>${SYM[c] || ''} ${NAMES[c] || c}</td><td class="n">${fmt(v.buy, 4)}</td><td class="n"><b>${fmt(v.sell, 4)}</b></td></tr>`).join('');
  $('#bojFxNote').innerHTML = `${esc(f.note)} J$ per 1 unit. Read ${ct(f.read)}. <a href="${esc(f.source)}" target="_blank" rel="noopener">Source: Bank of Jamaica</a>${f.more ? ` · <a href="${esc(f.more)}" target="_blank" rel="noopener">Daily FX trading summary</a>` : ''}`;
}
function jmdPer(c, src) {
  if (c === 'JMD') return 1;
  if (src === 'live') return liveJmdPer(c);
  const f = S.boj && S.boj.fx && S.boj.fx.rates[c]; if (!f) return null;
  return src === 'bojbuy' ? f.buy : f.sell;
}
function convert() {
  const amt = parseFloat($('#fxAmt').value), from = $('#fxFrom').value, to = $('#fxTo').value, src = $('#fxSrc').value;
  const a = jmdPer(from, src), b = jmdPer(to, src), out = $('#fxOut');
  if (isNaN(amt)) { out.innerHTML = 'Enter an amount'; return; }
  if (a == null || b == null) { out.innerHTML = '<small>That rate isn’t available right now. Try another “Rate to use”.</small>'; return; }
  const res = amt * a / b;
  const label = src === 'live' ? 'live mid-market rate' : src === 'bojsell' ? 'BOJ sell rate' : 'BOJ buy rate';
  out.innerHTML = `${money(amt, from)} = ${money(res, to)}<small>1 ${from} = ${fmt(a / b, 4)} ${to}, using the ${label}</small>`;
}
['#fxAmt', '#fxFrom', '#fxTo', '#fxSrc'].forEach((s) => $(s).addEventListener('input', convert));
$('#fxSwap').addEventListener('click', () => { const f = $('#fxFrom').value; $('#fxFrom').value = $('#fxTo').value; $('#fxTo').value = f; convert(); });
$('#fxRefresh').addEventListener('click', loadLive);

/* ---------- Calculator ---------- */
function fillPick() {
  const sel = $('#cPick'); if (!S.rates) return;
  const opts = [];
  (S.rates.tbills?.items || []).forEach((t) => opts.push({ v: t.avg, cur: 'JMD', n: `GOJ ${t.term} T-bill – ${pct(t.avg, 3)} (${S.rates.tbills.auction})` }));
  if (S.boj?.cd30) opts.push({ v: S.boj.cd30.rate, cur: 'JMD', n: `BOJ 30-day CD – ${pct(S.boj.cd30.rate)} (${S.boj.cd30.date})` });
  S.rates.rates.filter((r) => r.value != null).forEach((r) => opts.push({ v: r.value, cur: r.cur, n: `${r.product} – ${pct(r.value)} (${r.asOf})` }));
  sel.innerHTML = '<option value="">Type my own rate</option>' + opts.map((o, i) => `<option value="${i}" data-v="${o.v}" data-cur="${o.cur}">${esc(o.n)}</option>`).join('');
}
$('#cPick').addEventListener('change', (e) => {
  const o = e.target.selectedOptions[0]; if (!o || !o.dataset.v) return;
  $('#cRate').value = Number(o.dataset.v).toFixed(2); $('#cCur').value = o.dataset.cur; renderCalc();
});
function renderCalc() {
  const P = parseFloat($('#cAmt').value), r = parseFloat($('#cRate').value) / 100, m = parseInt($('#cMonths').value, 10);
  const cur = $('#cCur').value, tax = parseFloat($('#cTax').value) / 100, comp = $('#cComp').value;
  const out = $('#cOut');
  if ([P, r, m].some((x) => isNaN(x)) || P < 0 || m < 1) { out.innerHTML = '<div class="hl"><div class="k">Enter an amount, a rate and months</div></div>'; return; }
  let gross;
  if (comp === 'simple') gross = P * r * m / 12;
  else { const net = r / 12 * (1 - tax); const g = r / 12; gross = 0; let bal = P; for (let i = 0; i < m; i++) { const it = bal * g; gross += it; bal += it * (1 - tax); } }
  const taxAmt = gross * tax, net = gross - taxAmt, end = P + net;
  const other = cur === 'USD' ? liveJmdPer('USD') : (liveJmdPer('USD') ? 1 / liveJmdPer('USD') : null);
  const conv = other ? `<div><div class="k">Ending balance in ${cur === 'USD' ? 'J$' : 'US$'} (today’s live rate)</div><div class="v">${money(end * other, cur === 'USD' ? 'JMD' : 'USD')}</div></div>` : '';
  out.innerHTML = `<div class="hl"><div class="k">You could have after ${m} month${m === 1 ? '' : 's'}</div><div class="v">${money(end, cur)}</div></div>
    <div><div class="k">Interest before tax</div><div class="v">${money(gross, cur)}</div></div>
    <div><div class="k">Tax withheld (${fmt(tax * 100, tax * 100 % 1 ? 1 : 0)}%)</div><div class="v">${money(taxAmt, cur)}</div></div>
    <div><div class="k">Interest after tax</div><div class="v">${money(net, cur)}</div></div>${conv}`;
  const t = S.rates?.tax;
  $('#cTaxNote').innerHTML = (t ? esc(t.text) + ' ' + t.sources.map((s, i) => `<a href="${esc(s)}" target="_blank" rel="noopener">Source ${i + 1}</a>`).join(' · ') + '. ' : '') + 'Fund yields move daily and are not guaranteed. Fees may also apply.';
}
['#cAmt', '#cRate', '#cMonths', '#cCur', '#cTax', '#cComp'].forEach((s) => $(s).addEventListener('input', () => { if (s === '#cRate') $('#cPick').value = ''; renderCalc(); }));

/* ---------- More ---------- */
function renderMore() {
  $('#ver').textContent = VERSION;
  const li = [];
  li.push(`<li><b>Stocks:</b> ${S.jse ? `closing prices for ${esc(S.jse.tradeDate)}, saved ${ct(S.jse.fetched)}` : 'not loaded'}. Refreshed automatically each weekday after the JSE closes.</li>`);
  li.push(`<li><b>Bank of Jamaica:</b> ${S.boj ? 'read ' + ct(S.boj.fetched) : 'not loaded'}. Refreshed automatically each weekday.</li>`);
  li.push(`<li><b>Fund rates:</b> ${S.rates ? 'checked ' + ct(S.rates.fetched) : 'not loaded'}. Proven, Scotia, Barita, GK, JMMB and Sagicor refresh automatically when their pages allow it. Each rate shows its own “as of” date.</li>`);
  li.push(`<li><b>Live exchange rates:</b> loaded straight to this device when you open the Exchange tab.</li>`);
  $('#freshList').innerHTML = li.join('');
  const src = [
    ['Jamaica Stock Exchange – trade quotes', 'https://www.jamstockex.com/trading/trade-quotes/'],
    ['Bank of Jamaica – home page rates', 'https://boj.org.jm/'],
    ['Bank of Jamaica – Treasury bill notices', 'https://boj.org.jm/category/notices/treasury-bills/'],
    ['Bank of Jamaica – policy decisions', 'https://boj.org.jm/core-functions/monetary-policy/policy-schedule/summary-of-decisions/'],
    ['ExchangeRate-API (live rates)', 'https://www.exchangerate-api.com/'],
    ['Free Currency Exchange Rates API (backup)', 'https://github.com/fawazahmed0/exchange-api'],
    ['PwC Worldwide Tax Summaries – Jamaica', 'https://taxsummaries.pwc.com/jamaica/individual/income-determination']
  ];
  if (S.rates) { const seen = new Set(); S.rates.rates.forEach((r) => { if (!seen.has(r.source)) { seen.add(r.source); src.push([r.provider, r.source]); } }); }
  $('#srcList').innerHTML = src.map(([n, u]) => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(n)}</a></li>`).join('');
}
$('#reloadAll').addEventListener('click', () => { loadAll(); loadLive(); });
$('#clearData').addEventListener('click', () => {
  if (!confirm('Clear your watchlist and settings on this device?')) return;
  Object.keys(localStorage).filter((k) => k.startsWith('jm-')).forEach((k) => localStorage.removeItem(k));
  S.watch = new Set(); renderStockList(); alert('Cleared.');
});
let deferred;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; $('#installBtn').hidden = false; });
$('#installBtn').addEventListener('click', async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $('#installBtn').hidden = true; });

/* ---------- Load ---------- */
async function loadAll() {
  const [rates, boj, jse] = await Promise.allSettled([getJSON('data/rates.json'), getJSON('data/boj.json'), getJSON('data/jse.json')]);
  S.rates = rates.value || S.rates; S.boj = boj.value || S.boj; S.jse = jse.value || S.jse;
  renderBoj(); renderTbills(); renderRates(); renderStocks(); renderBojFx(); fillPick(); convert(); renderCalc(); renderMore();
}
syncTheme();
const start = (location.hash || '').slice(1);
if (['rates', 'stocks', 'fx', 'calc', 'more'].includes(start)) showTab(start, false);
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (['rates', 'stocks', 'fx', 'calc', 'more'].includes(h)) showTab(h, false); });
loadAll(); loadLive();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
