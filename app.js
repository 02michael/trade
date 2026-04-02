const WALLETS = [
  { address: '0x7FF612044E30dA42624D3fDB627C42112CA1a6F0', label: 'W1' },
  { address: '0x8aE631E85aFe8A4881aCfFccBe320fAe3eF3Cc0a', label: 'W2' },
  { address: '0x761aED96b5Af61cF59Dd9315A642dDf0f0f0058a', label: 'W3' },
];
const API = 'https://api.hyperliquid.xyz/info';
const DEX = 'xyz';
let refreshTimer = null;
let markPrices = {};
let fundingRates = {};
 
function setStatus(s, t) {
  document.getElementById('statusDot').className = 'status-dot ' + s;
  document.getElementById('statusText').textContent = t;
}
 
async function apiPost(body) {
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('API ' + r.status);
  return r.json();
}
 
async function fetchMeta() {
  try {
    const d = await apiPost({ type: 'metaAndAssetCtxs', dex: DEX });
    markPrices = {}; fundingRates = {};
    d[0].universe.forEach((a, i) => {
      if (d[1][i]) {
        markPrices[a.name] = parseFloat(d[1][i].markPx) || 0;
        fundingRates[a.name] = d[1][i].funding != null ? parseFloat(d[1][i].funding) : null;
      }
    });
  } catch (e) { console.warn('Meta fail:', e); }
}
 
async function fetchPositions(addr) { return apiPost({ type: 'clearinghouseState', user: addr, dex: DEX }); }
 
function fmt(n, d = 2) { if (n == null || isNaN(n)) return '—'; return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }
function fmtUsd(n) { if (n == null || isNaN(n)) return '—'; const v = Number(n); return (v >= 0 ? '+$' : '-$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtUsdShort(n) { if (n == null || isNaN(n)) return '—'; const v = Number(n); return (v >= 0 ? '+' : '-') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 }); }
function fmtRate(r) { if (r == null || isNaN(r)) return '—'; return (Number(r) * 100).toFixed(4) + '%'; }
function fmtTime(ms) { const d = new Date(ms); return String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'); }
 
async function openFundingModal(address, coin, walletLabel) {
  const overlay = document.getElementById('fundingModal');
  const body = document.getElementById('modalBody');
  document.getElementById('modalCoinTag').textContent = coin.replace(DEX + ':', '');
  document.getElementById('modalWalletTag').textContent = walletLabel;
  const totalEl = document.getElementById('modalTotalFunding');
  const countEl = document.getElementById('modalPaymentCount');
  const avgEl = document.getElementById('modalAvgFunding');
  totalEl.className = 'stat-value'; totalEl.textContent = '—';
  countEl.textContent = '—'; avgEl.className = 'stat-value'; avgEl.textContent = '—';
  body.innerHTML = '<div class="funding-loading">Loading funding data</div>';
  overlay.classList.add('open');
  try {
    const now = Date.now();
    const data = await apiPost({ type: 'userFunding', user: address, startTime: now - 7*24*60*60*1000, endTime: now });
    const filtered = (data || []).filter(e => e.delta && e.delta.coin === coin);
    if (!filtered.length) { body.innerHTML = '<div class="funding-empty">No funding payments in last 7 days</div>'; totalEl.textContent = '$0.00'; countEl.textContent = '0'; return; }
    filtered.sort((a, b) => b.time - a.time);
    let total = 0; for (const f of filtered) total += parseFloat(f.delta.usdc || '0');
    const avg = total / filtered.length;
    totalEl.className = 'stat-value ' + (total >= 0 ? 'pnl-positive' : 'pnl-negative');
    totalEl.textContent = fmtUsd(total);
    countEl.textContent = filtered.length.toString();
    avgEl.className = 'stat-value ' + (avg >= 0 ? 'pnl-positive' : 'pnl-negative');
    avgEl.textContent = fmtUsdShort(avg);
    let html = '<div class="funding-row f-header"><div>Time</div><div>Payment</div><div>Rate</div><div>Position</div></div>';
    for (const f of filtered) {
      const usdc = parseFloat(f.delta.usdc || '0');
      html += `<div class="funding-row"><div style="color:var(--text-dim)">${fmtTime(f.time)}</div><div class="${usdc >= 0 ? 'pnl-positive' : 'pnl-negative'}">${fmtUsdShort(usdc)}</div><div style="color:var(--text-dim)">${fmtRate(f.delta.fundingRate)}</div><div style="color:var(--text-dim)">${fmt(parseFloat(f.delta.szi), 4)}</div></div>`;
    }
    body.innerHTML = html;
  } catch (e) { body.innerHTML = `<div class="funding-empty" style="color:var(--red)">Error: ${e.message}</div>`; }
}
function closeFundingModal(ev) { if (ev && ev.target !== ev.currentTarget) return; document.getElementById('fundingModal').classList.remove('open'); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeFundingModal(); });
 
function renderWallet(wallet, data, error) {
  const addr = wallet.address;
  if (error) return { html: `<div class="wallet-section"><div class="wallet-header"><span class="wallet-index">${wallet.label}</span></div><div class="error-box">${error}</div></div>`, acctVal: 0, totalUpnl: 0 };
  if (!data) return { html: `<div class="wallet-section"><div class="wallet-header"><span class="wallet-index">${wallet.label}</span></div><div class="loading-skeleton"></div><div class="loading-skeleton" style="margin-top:6px;height:40px"></div></div>`, acctVal: 0, totalUpnl: 0 };
 
  const acctVal = parseFloat(data.marginSummary?.accountValue || '0');
  const positions = (data.assetPositions || []).filter(p => parseFloat(p.position?.szi || '0') !== 0);
  if (!positions.length && acctVal < 0.01) return { html: '', acctVal: 0, totalUpnl: 0 };
 
  let ph = '', walletUpnl = 0;
  if (!positions.length) {
    ph = '<div class="no-positions"><div class="icon">∅</div>No open positions</div>';
  } else {
    ph = '<div class="positions-grid"><div class="position-row header-row"><div>Asset</div><div>Side</div><div>Size</div><div>Entry</div><div>Mark</div><div>uPnL</div><div>Liq</div><div>Rate</div><div>Funded</div><div>Lev</div></div>';
    for (const p of positions) {
      const pos = p.position, coin = pos.coin, szi = parseFloat(pos.szi);
      const isLong = szi > 0, side = isLong ? 'LONG' : 'SHORT', sc = isLong ? 'long' : 'short';
      const entry = parseFloat(pos.entryPx), mark = markPrices[coin] || parseFloat(pos.markPx || '0');
      const upnl = parseFloat(pos.unrealizedPnl); walletUpnl += upnl;
      const pc = upnl >= 0 ? 'pnl-positive' : 'pnl-negative';
      const lev = pos.leverage?.value || '—', notional = Math.abs(szi) * mark;
      const dc = coin.replace(DEX + ':', '');
      const liqPx = parseFloat(pos.liquidationPx || '0');
      let ldc = 'liq-safe', lds = '—';
      if (liqPx > 0 && mark > 0) { const pct = Math.abs((mark - liqPx) / mark) * 100; lds = pct.toFixed(1) + '%'; if (pct < 5) ldc = 'liq-danger'; else if (pct < 15) ldc = 'liq-warn'; }
      const mu = parseFloat(pos.marginUsed || '0'); let rs = '—', rc = '';
      if (mu > 0) { const r = (upnl / mu) * 100; rs = (r >= 0 ? '+' : '') + r.toFixed(2) + '%'; rc = r >= 0 ? 'pnl-positive' : 'pnl-negative'; }
      const fr = fundingRates[coin]; let fs = '—', fst = 'color:var(--text-dim)', fa = '';
      if (fr != null) { const fp = fr * 100; fs = (fp >= 0 ? '+' : '') + fp.toFixed(4) + '%'; fst = fr >= 0 ? 'color:var(--green)' : 'color:var(--red)'; const an = fr * 24 * 365 * 100; fa = (an >= 0 ? '+' : '') + an.toFixed(1) + '% /yr'; }
      const cf = parseFloat(pos.cumFunding?.sinceOpen || '0')*-1, cc = cf >= 0 ? 'pnl-positive' : 'pnl-negative';
      const ea = addr.replace(/'/g, "\\'"), ec = coin.replace(/'/g, "\\'"), el = wallet.label.replace(/'/g, "\\'");
      ph += `<div class="position-row">
        <div data-label="Asset" class="coin-name">${dc}</div>
        <div data-label="Side"><span class="side-badge ${sc}">${side}</span></div>
        <div data-label="Size" class="mono">${fmt(Math.abs(szi), 4)}<br><span style="color:var(--text-muted);font-size:9px">$${fmt(notional, 0)}</span></div>
        <div data-label="Entry" class="mono">$${fmt(entry, 2)}</div>
        <div data-label="Mark" class="mono">$${fmt(mark, 2)}</div>
        <div data-label="uPnL" class="mono ${pc}">${fmtUsd(upnl)}<div class="upnl-pct ${rc}">${rs}</div></div>
        <div data-label="Liq" class="liq-cell"><span class="liq-price">$${fmt(liqPx, 2)}</span><div class="liq-dist ${ldc}">${lds} away</div></div>
        <div data-label="Rate" class="rate-cell"><span style="${fst}">${fs}</span><div class="rate-annual">${fa}</div></div>
        <div data-label="Funded" class="funded-cell"><span class="cum-funding ${cc}">${fmtUsd(cf)}</span><button class="funding-btn" title="Funding history" onclick="openFundingModal('${ea}','${ec}','${el}')">⋯</button></div>
        <div data-label="Leverage"><span class="leverage-chip">${lev}×</span></div>
      </div>`;
    }
    ph += '</div>';
  }
  return { html: `<div class="wallet-section"><div class="wallet-header"><span class="wallet-index">${wallet.label}</span><span class="wallet-equity"><span class="label">Equity</span>$${fmt(acctVal)}</span></div>${ph}</div>`, acctVal, totalUpnl: walletUpnl };
}
 
async function fetchAll() {
  setStatus('loading', 'fetching');
  try { await fetchMeta(); } catch (_) {}
  const results = await Promise.allSettled(WALLETS.map(w => fetchPositions(w.address)));
  let html = '', totalEquity = 0, totalUpnl = 0;
  results.forEach((r, i) => {
    const out = r.status === 'fulfilled' ? renderWallet(WALLETS[i], r.value, null) : renderWallet(WALLETS[i], null, r.reason?.message || 'Fetch failed');
    html += out.html; totalEquity += out.acctVal; totalUpnl += out.totalUpnl;
  });
  document.getElementById('walletContainer').innerHTML = html;
  const hero = document.getElementById('equityHero'), hv = document.getElementById('heroValue');
  if (totalEquity > 0.01) { hv.textContent = '$' + fmt(totalEquity); const isDown = totalUpnl < 0; hero.classList.toggle('down', isDown); document.body.classList.toggle('state-down', isDown); }
  else { hv.textContent = '—'; hero.classList.remove('down'); document.body.classList.remove('state-down'); }
  setStatus('', new Date().toLocaleTimeString('en-US', { hour12: false }));
}
 
function setRefreshInterval() {
  if (refreshTimer) clearInterval(refreshTimer);
  const s = parseInt(document.getElementById('refreshInterval').value);
  if (s > 0) refreshTimer = setInterval(fetchAll, s * 1000);
}
 
fetchAll();
setRefreshInterval();