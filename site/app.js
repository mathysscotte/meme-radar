// Meme Radar web app. Reads the robot's feed.json (news, signals, trending) and live DexScreener prices.
(() => {
  "use strict";

  const COINS = [
    ["pump-fun", "PUMP", "Pump.fun", "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn"],
    ["official-trump", "TRUMP", "Official Trump", "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN"],
    ["pudgy-penguins", "PENGU", "Pudgy Penguins", "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv"],
    ["bonk", "BONK", "Bonk", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"],
    ["dogwifcoin", "WIF", "dogwifhat", "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"],
    ["useless-3", "USELESS", "Useless Coin", "Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk"],
    ["fartcoin", "FARTCOIN", "Fartcoin", "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump"],
    ["melania-meme", "MELANIA", "Melania Meme", "FUAfBo2jgks6gB4Z4LfZkqSZgzNucisEHqnNebaRxM1P"],
    ["comedian", "BAN", "Comedian", "9PR7nCP9DpcUotnDPVLUBUZKu5WAYkwrCUx9wDnSpump"],
    ["jelly-my-jelly", "JELLYJELLY", "Jelly-My-Jelly", "FeR8VBqNRSUD5NtXAj2n3j1dAHkZHfyDktKuLXD4pump"],
    ["book-of-meme", "BOME", "Book of Meme", "ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82"],
    ["peanut-the-squirrel", "PNUT", "Peanut the Squirrel", "2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump"],
    ["popcat", "POPCAT", "Popcat", "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr"],
    ["cat-in-a-dogs-world", "MEW", "cat in a dogs world", "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5"],
    ["moo-deng", "MOODENG", "Moo Deng", "ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY"],
    ["gigachad-2", "GIGA", "Gigachad", "63LfDmNb3MQ8mw9MtZ2To9bEA2M71kZUUGq5tiJxcqj9"],
    ["goatseus-maximus", "GOAT", "Goatseus Maximus", "CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump"],
    ["ponke", "PONKE", "PONKE", "5z3EqYQo9HiCEs3R84RCDMu2n7anpDMxRhdK8PSWmrRC"],
    ["chill-guy", "CHILLGUY", "Just a chill guy", "Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump"],
    ["act-i-the-ai-prophecy", "ACT", "Act I The AI Prophecy", "GJAFwWjJ3vnTsrQVabjBVK2TYB1YtRCQXRDfDgUnpump"],
  ].map(([id, sym, name, addr]) => ({ id, sym, name, addr }));
  const SOL = { id: "solana", sym: "SOL", name: "Solana", addr: "So11111111111111111111111111111111111111112" };
  const ALL = COINS.concat(SOL);
  const BY_ADDR = new Map(ALL.map((c) => [c.addr, c]));
  const DEX_URL = "https://api.dexscreener.com/tokens/v1/solana/" + ALL.map((c) => c.addr).join(",");
  const FEED_URL = "feed.json";
  const LEVEL_TXT = ["INFO", "À SUIVRE", "IMPORTANT", "CRITIQUE"];
  const NNBSP = " ";
  const $ = (id) => document.getElementById(id);
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c]);

  /* ---------- this device's preferences (best effort) ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem("mr:" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("mr:" + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };
  const settings = Object.assign({ sound: false, level: 3, fast: 6, wake: false, general: false }, store.get("settings", {}) || {});
  const favs = new Set((store.get("favs", []) || []).filter((id) => COINS.some((c) => c.id === id)));
  const seenStored = store.get("seen", null);
  const seen = new Set(Array.isArray(seenStored) ? seenStored : []);
  let firstEver = !Array.isArray(seenStored);
  let tab = store.get("tab", "feed"); if (!["feed", "coins", "settings"].includes(tab)) tab = "feed";
  let filter = store.get("filter", "all");
  let coinSort = store.get("coinSort", "h1"); if (!["h1", "h24", "vol24", "mcap"].includes(coinSort)) coinSort = "h1";
  let coinQuery = "", openCoin = null;
  const showVO = new Set();
  const saveSettings = () => store.set("settings", settings);
  const saveSeen = () => store.set("seen", [...seen].slice(-900));

  /* ---------- formatting (fr-FR) ---------- */
  const NF0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  const NF1 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const NF23 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  const NFS4 = new Intl.NumberFormat("fr-FR", { maximumSignificantDigits: 4 });
  const SUB = "₀₁₂₃₄₅₆₇₈₉";
  function fmtPrice(p) {
    if (p == null || !isFinite(p) || p <= 0) return "—";
    if (p >= 1000) return NF0.format(p) + NNBSP + "$";
    if (p >= 1) return NF23.format(p) + NNBSP + "$";
    if (p >= 0.0001) return NFS4.format(p) + NNBSP + "$";
    // Tiny prices, written the way DEX screens do: 0,0₅1234 = five zeros after the comma.
    let zeros = Math.ceil(-Math.log10(p)) - 1;
    let sig = Math.round(p * Math.pow(10, zeros + 4));
    if (sig >= 10000) { sig = Math.round(sig / 10); zeros -= 1; }
    if (sig > 0 && sig < 1000) { sig *= 10; zeros += 1; }
    return "0,0" + String(zeros).split("").map((d) => SUB[+d]).join("") + String(sig).replace(/0+$/, "") + NNBSP + "$";
  }
  function fmtPct(x) {
    if (x == null || !isFinite(x)) return "—";
    const a = Math.abs(x);
    return (x >= 0.05 ? "+" : x <= -0.05 ? "−" : "") + (a >= 100 ? NF0.format(a) : NF1.format(a)) + NNBSP + "%";
  }
  function fmtUsd(v) {
    if (v == null || !isFinite(v)) return "—";
    if (v >= 1e9) { const md = v / 1e9; return (md >= 100 ? NF0.format(md) : NF1.format(md)) + NNBSP + "Md$"; }
    if (v >= 1e6) { const m = v / 1e6; return (m >= 100 ? NF0.format(m) : NF1.format(m)) + NNBSP + "M$"; }
    if (v >= 1e3) return NF0.format(v / 1e3) + NNBSP + "k$";
    return NF0.format(v) + NNBSP + "$";
  }
  const dirCls = (x) => (x == null || !isFinite(x) ? "flat" : x >= 0.05 ? "up" : x <= -0.05 ? "down" : "flat");
  const fmtHMS = (t) => new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  function ago(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 5) return "maintenant";
    if (s < 60) return "il y a " + s + NNBSP + "s";
    const m = Math.floor(s / 60);
    if (m < 10) return "il y a " + m + NNBSP + "min " + String(s % 60).padStart(2, "0") + NNBSP + "s";
    if (m < 60) return "il y a " + m + NNBSP + "min";
    const h = Math.floor(m / 60);
    if (h < 24) return "il y a " + h + NNBSP + "h" + (m % 60 ? " " + String(m % 60).padStart(2, "0") : "");
    const d = Math.floor(h / 24);
    return d === 1 ? "hier" : "il y a " + d + NNBSP + "j";
  }
  function dayLabel(t) {
    const d = new Date(t), today = new Date(), y = new Date(); y.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return "Aujourd'hui";
    if (d.toDateString() === y.toDateString()) return "Hier";
    return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  }
  function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

  /* ---------- data ---------- */
  let feed = { items: [], trending: [], coins: [], sol: null, updatedAt: 0 };
  let feedLoaded = false, feedErr = null, feedOkAt = 0;
  const live = new Map();
  let liveOkAt = 0, liveErr = null;
  const liveItems = [];
  const fastSeen = new Map();
  const firstSeenAt = new Map();

  function coinData(c) {
    const l = live.get(c.addr);
    if (l) return Object.assign({}, c, l, { liveAt: liveOkAt });
    const snap = c.id === "solana" ? feed.sol : (feed.coins || []).find((x) => x && x.addr === c.addr);
    return Object.assign({}, c, snap || {}, { liveAt: 0 });
  }

  async function loadFeed() {
    try {
      const r = await fetch(FEED_URL + "?t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) throw new Error(r.status === 404 ? "Le robot n'a pas encore publié de fil." : "HTTP " + r.status);
      const f = await r.json();
      feed = { items: Array.isArray(f.items) ? f.items.filter((i) => i && i.id && i.t) : [], trending: f.trending || [], coins: f.coins || [], sol: f.sol || null, updatedAt: Date.parse(f.updatedAt) || 0 };
      feedOkAt = Date.now(); feedErr = null;
      const now = Date.now();
      const fresh = [];
      for (const it of feed.items) {
        if (seen.has(it.id)) { if (!firstSeenAt.has(it.id)) firstSeenAt.set(it.id, 0); continue; }
        seen.add(it.id);
        firstSeenAt.set(it.id, firstEver || !feedLoaded ? 0 : now);
        if (!firstEver) fresh.push(it);
      }
      if (fresh.length || firstEver) saveSeen();
      firstEver = false;
      feedLoaded = true;
      if (fresh.length) noteFresh(fresh);
    } catch (e) { feedErr = e.message || String(e); }
    scheduleRender();
  }
  async function loadLive() {
    try {
      const r = await fetch(DEX_URL, { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const data = await r.json();
      const pairs = Array.isArray(data) ? data : (data && data.pairs) || [];
      const best = new Map();
      for (const p of pairs) {
        const a = p && p.baseToken && p.baseToken.address;
        if (!a || !BY_ADDR.has(a)) continue;
        const liq = (p.liquidity && p.liquidity.usd) || 0;
        if (!best.has(a) || liq > ((best.get(a).liquidity && best.get(a).liquidity.usd) || 0)) best.set(a, p);
      }
      const now = Date.now();
      for (const [a, p] of best) {
        const snap = {
          price: Number(p.priceUsd) || null, m5: p.priceChange && p.priceChange.m5, h1: p.priceChange && p.priceChange.h1, h6: p.priceChange && p.priceChange.h6, h24: p.priceChange && p.priceChange.h24,
          vol24: p.volume && p.volume.h24, vol1: p.volume && p.volume.h1, liq: p.liquidity && p.liquidity.usd, mcap: p.marketCap || p.fdv || null,
          buys1: p.txns && p.txns.h1 && p.txns.h1.buys, sells1: p.txns && p.txns.h1 && p.txns.h1.sells, url: p.url || null,
        };
        live.set(a, snap);
        detectFast(BY_ADDR.get(a), snap, now);
      }
      liveOkAt = now; liveErr = null;
    } catch (e) { liveErr = e.message || String(e); }
    scheduleRender();
  }
  // A sharp 5-minute move seen while the app is open becomes a live item in the feed.
  function detectFast(c, s, now) {
    if (!c || s.m5 == null || !s.price || (s.liq || 0) < 50000) return;
    const thr = c.id === "solana" ? 2 : favs.has(c.id) ? Math.max(3, settings.fast - 2) : settings.fast;
    if (Math.abs(s.m5) < thr) return;
    const k = c.id + (s.m5 > 0 ? ":up" : ":down");
    if (now - (fastSeen.get(k) || 0) < 15 * 60000) return;
    fastSeen.set(k, now);
    const lvl = Math.abs(s.m5) >= thr * 2 ? 3 : 2;
    const it = {
      id: "l" + hash(k + now), kind: "live", sig: s.m5 > 0 ? "fastup" : "fastdown", sym: c.sym, coin: c.id, val: s.m5, t: now, src: "En direct",
      title: c.sym + " " + fmtPct(s.m5) + " en 5" + NNBSP + "min", desc: "Prix " + fmtPrice(s.price) + " · 1" + NNBSP + "h " + fmtPct(s.h1) + " · Vol. 1" + NNBSP + "h " + fmtUsd(s.vol1),
      url: s.url, level: lvl, score: lvl === 3 ? 5 : 4, sol: true, tags: [{ k: "signal", label: "Éclair (direct)" }],
    };
    liveItems.unshift(it);
    liveItems.splice(40);
    firstSeenAt.set(it.id, now);
    noteFresh([it]);
  }

  /* ---------- filters ---------- */
  const hasTag = (k) => (i) => (i.tags || []).some((t) => t.k === k);
  const favSyms = () => new Set(COINS.filter((c) => favs.has(c.id)).map((c) => c.sym));
  const isFav = (i) => (i.coin && favs.has(i.coin)) || (i.tags || []).some((t) => t.k === "meme" && favSyms().has(t.label));
  const FILTERS = [
    { id: "all", label: "Tout", pred: () => true },
    { id: "imp", label: "Importantes", pred: (i) => (i.score || 0) >= 3 },
    { id: "launch", label: "Lancements", pred: hasTag("launch") },
    { id: "sig", label: "Signaux", pred: (i) => i.kind !== "news" },
    { id: "listing", label: "Listings", pred: hasTag("listing") },
    { id: "hack", label: "Hacks & pannes", pred: hasTag("hack") },
    { id: "regu", label: "Régulation", pred: hasTag("regu") },
    { id: "macro", label: "Macro", pred: hasTag("macro") },
    { id: "fav", label: "Mes coins", pred: isFav },
  ];
  if (!FILTERS.some((f) => f.id === filter)) filter = "all";
  const shown = (i) => i.kind !== "news" || !!i.sol || (settings.general && i.level >= 3);
  const allItems = () => feed.items.concat(liveItems).filter(shown);

  /* ---------- alerts while the app is open ---------- */
  let audio = null, toastTimer = null, lastAlertAt = 0;
  function noteFresh(items) {
    const n = Date.now();
    const hits = items.filter((it) => shown(it) && (it.score || 0) >= settings.level && n - it.t < 45 * 60000).sort((a, b) => b.score - a.score);
    if (!hits.length) return;
    showToast(hits[0], hits.length - 1);
    if (settings.sound && n - lastAlertAt > 8000) { lastAlertAt = n; ping(hits[0].level); }
  }
  function ensureAudio() {
    try { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; audio = audio || new AC(); if (audio.state === "suspended") audio.resume().catch(() => {}); }
    catch (e) { audio = null; }
  }
  function ping(level) {
    if (!audio) return;
    try {
      const t0 = audio.currentTime;
      const blip = (at, f1, f2) => {
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = "sine"; o.frequency.setValueAtTime(f1, at); o.frequency.exponentialRampToValueAtTime(f2, at + 0.12);
        g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.22, at + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.42);
        o.connect(g).connect(audio.destination); o.start(at); o.stop(at + 0.45);
      };
      blip(t0, 988, 1318);
      if (level >= 3) blip(t0 + 0.2, 1318, 1760);
    } catch (e) { /* audio unavailable */ }
  }
  const titleOf = (it) => it.titleFr || it.title;
  function showToast(it, more) {
    const el = $("toast");
    el.innerHTML = '<span class="t-k">' + sigBars(it.level) + " " + LEVEL_TXT[it.level || 0] + (it.src ? " · " + esc(it.src) : "") + "</span>" +
      '<span class="t-h">' + esc(titleOf(it)) + "</span>" + (more > 0 ? '<span class="t-m">+' + more + " autre" + (more > 1 ? "s" : "") + " dans le fil</span>" : "");
    el.dataset.k = hash(it.id);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 7000);
  }
  let wakeLock = null;
  async function setWake(on) {
    const note = $("wake-note");
    try {
      if (on) {
        if (!navigator.wakeLock) throw new Error("unsupported");
        if (!wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); }
        note.textContent = "Activé tant que l'app est ouverte.";
      } else { if (wakeLock) await wakeLock.release(); wakeLock = null; note.textContent = "Pratique pour surveiller le fil."; }
    } catch (e) { wakeLock = null; note.textContent = "Pas disponible sur ce téléphone."; }
  }

  /* ---------- rendering ---------- */
  const sigBars = (l) => '<span class="sig" data-l="' + (l || 0) + '" aria-hidden="true"><i></i><i></i><i></i></span>';
  let queued = false;
  function scheduleRender() { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; render(); }); }
  function render() {
    const n = Date.now();
    renderStatus(n); renderFresh(n); renderPulse(); renderMovers(); renderChips(); renderFeed(n); renderCoins();
  }
  function renderStatus(n) {
    let s = "loading", label = "Connexion…";
    if (!navigator.onLine) { s = "offline"; label = "Hors ligne"; }
    else if (feedLoaded) {
      if (feed.updatedAt && n - feed.updatedAt > 20 * 60000) { s = "late"; label = "Robot en retard"; }
      else { s = "live"; label = "En direct"; }
    } else if (feedErr) { s = "late"; label = "Fil indisponible"; }
    const el = $("status");
    if (el.dataset.s !== s) el.dataset.s = s;
    if ($("status-txt").textContent !== label) $("status-txt").textContent = label;
    $("top").dataset.live = s === "live" ? "1" : "0";
  }
  function renderFresh(n) {
    const parts = [];
    if (feed.updatedAt) parts.push("Robot " + ago(n - feed.updatedAt));
    if (liveOkAt) parts.push("prix " + ago(n - liveOkAt));
    const s = parts.length ? parts.join(" · ") : feedErr ? "Fil indisponible" : "Chargement…";
    if ($("fresh").textContent !== s) $("fresh").textContent = s;
  }
  function renderPulse() {
    const list = COINS.map(coinData);
    let cap = 0, w = 0, vol = 0, vol1 = 0;
    for (const c of list) { if (c.mcap) { cap += c.mcap; if (c.h24 != null) w += c.mcap * c.h24; } vol += c.vol24 || 0; vol1 += c.vol1 || 0; }
    const sol = coinData(SOL);
    const cells = [
      { k: "Memes Solana", v: cap ? fmtUsd(cap) : "—", d: cap ? w / cap : null, sfx: " 24" + NNBSP + "h" },
      { k: "SOL", v: fmtPrice(sol.price), d: sol.h24, sfx: " 24" + NNBSP + "h" },
      { k: "Volume memes", v: vol ? fmtUsd(vol) : "—", note: vol1 ? "1" + NNBSP + "h : " + fmtUsd(vol1) : "24" + NNBSP + "h" },
    ];
    const html = cells.map((c) => '<div class="stat"><div class="k">' + c.k + '</div><div class="v">' + esc(c.v) + '</div><div class="d ' + (c.d != null ? dirCls(c.d) : "") + '">' + (c.d != null ? fmtPct(c.d) + c.sfx : esc(c.note || " ")) + "</div></div>").join("");
    if ($("pulse").innerHTML !== html) $("pulse").innerHTML = html;
  }
  function renderMovers() {
    const list = COINS.map(coinData).filter((c) => c.h1 != null).sort((a, b) => Math.abs(b.h1) - Math.abs(a.h1)).slice(0, 12);
    const html = list.length ? list.map((c) => '<button type="button" class="mv ' + dirCls(c.h1) + '" data-coin="' + esc(c.id) + '">' + esc(c.sym) + "<b>" + fmtPct(c.h1) + "</b></button>").join("")
      : '<span class="mv-empty">Les plus gros mouvements s\'afficheront ici.</span>';
    if ($("movers").innerHTML !== html) $("movers").innerHTML = html;
  }
  function renderChips() {
    const all = allItems();
    const html = FILTERS.map((f) => { const c = f.id === "all" ? all.length : all.filter(f.pred).length; return '<button type="button" class="chip" data-f="' + f.id + '" aria-pressed="' + (f.id === filter) + '">' + f.label + (c ? '<span class="n">' + c + "</span>" : "") + "</button>"; }).join("");
    if ($("chips").innerHTML !== html) $("chips").innerHTML = html;
  }
  function rowHtml(it, n) {
    const lv = it.level || 0, k = hash(it.id);
    const fs = firstSeenAt.get(it.id) || 0;
    const isNew = fs && n - fs < 180000;
    const fr = it.kind === "news" && it.titleFr && it.titleFr !== it.title ? it.titleFr : null;
    const shownTitle = fr || it.title;
    const lang = it.kind === "news" ? (fr || /[éèàçù]/.test(it.title) ? ' lang="fr"' : ' lang="en"') : "";
    const title = it.url ? '<a class="hl" href="' + esc(it.url) + '" target="_blank" rel="noopener noreferrer"' + lang + ">" + esc(shownTitle) + "</a>" : '<span class="hl"' + lang + ">" + esc(shownTitle) + "</span>";
    const vo = fr ? '<button type="button" class="vo" data-vo="' + k + '" aria-pressed="' + showVO.has(k) + '" aria-label="Afficher le titre original en anglais">VO</button>' : "";
    const orig = fr && showVO.has(k) ? '<p class="orig" lang="en">' + esc(it.title) + "</p>" : "";
    const tags = (it.tags || []).map((t) => '<span class="tag t-' + esc(t.k) + '">' + esc(t.label) + "</span>").concat(isFav(it) ? ['<span class="tag t-fav">Ton coin</span>'] : []).join("");
    return '<article class="item lvl-' + lv + (it.kind !== "news" ? " is-signal" : "") + '" data-k="' + k + '">' +
      '<div class="when"><time class="hms" datetime="' + new Date(it.t).toISOString() + '">' + fmtHMS(it.t) + '</time><span class="ago" data-ts="' + it.t + '">' + ago(n - it.t) + "</span></div>" +
      '<div class="body"><div class="meta"><span class="src">' + esc(it.src || "") + "</span>" + sigBars(lv) + '<span class="lv">' + LEVEL_TXT[lv] + "</span>" + (isNew ? '<span class="new">NOUVEAU</span>' : "") + vo + "</div>" +
      title + orig + (it.desc ? '<p class="desc">' + esc(it.desc) + "</p>" : "") + (tags ? '<div class="tags">' + tags + "</div>" : "") + "</div></article>";
  }
  let lastFeedHtml = "";
  function renderFeed(n) {
    const f = FILTERS.find((x) => x.id === filter) || FILTERS[0];
    const items = allItems().filter(f.pred).sort((a, b) => b.t - a.t || (b.score || 0) - (a.score || 0)).slice(0, 180);
    let html = "";
    if (!items.length) {
      if (!feedLoaded && !feedErr) html = '<div class="skel"><div><span style="width:80%"></span><span style="width:60%"></span></div><div><span style="width:35%"></span><span style="width:92%"></span><span style="width:70%"></span></div></div>'.repeat(4);
      else if (feedErr && !feedLoaded) html = '<p class="empty">Le fil n\'est pas encore disponible (' + esc(feedErr) + "). Le robot publie toutes les 5 minutes : réessaie dans un instant.</p>";
      else if (filter === "fav" && !favs.size) html = '<p class="empty">Ajoute des coins à « Mes coins » avec l\'étoile, dans l\'onglet Memes Solana.</p>';
      else html = '<p class="empty">Rien dans ce filtre pour le moment. Les nouvelles entrées s\'afficheront ici dès qu\'elles tombent.</p>';
    } else {
      let lastDay = "";
      for (const it of items) {
        const dk = new Date(it.t).toDateString();
        if (dk !== lastDay) { html += '<div class="day">' + esc(dayLabel(it.t)) + "</div>"; lastDay = dk; }
        html += rowHtml(it, n);
      }
    }
    if (html === lastFeedHtml) return;
    // Keep the row under the reader's eyes in place when new rows land above it.
    const box = $("feed");
    let anchorK = null, anchorTop = 0;
    if (tab === "feed" && window.scrollY > 140) for (const r of box.querySelectorAll(".item[data-k]")) { const top = r.getBoundingClientRect().top; if (top >= 110) { anchorK = r.dataset.k; anchorTop = top; break; } }
    box.innerHTML = html; lastFeedHtml = html;
    if (anchorK) { const el = box.querySelector('.item[data-k="' + anchorK + '"]'); if (el) { const d = el.getBoundingClientRect().top - anchorTop; if (Math.abs(d) > 1) window.scrollBy(0, d); } }
  }
  function coinRow(c) {
    const fav = favs.has(c.id), open = openCoin === c.id;
    let more = "";
    if (open) {
      const dd = (k, v, cls) => "<div><dt>" + k + '</dt><dd class="' + (cls || "") + '">' + v + "</dd></div>";
      more = '<div class="c-more"><dl>' + dd("5 min", fmtPct(c.m5), dirCls(c.m5)) + dd("6 h", fmtPct(c.h6), dirCls(c.h6)) + dd("Volume 24 h", fmtUsd(c.vol24)) + dd("Volume 1 h", fmtUsd(c.vol1)) +
        dd("Liquidité", fmtUsd(c.liq)) + dd("Capitalisation", fmtUsd(c.mcap)) + dd("Achats / ventes 1 h", c.buys1 != null ? NF0.format(c.buys1) + " / " + NF0.format(c.sells1 || 0) : "—") +
        dd("Prix relevé", c.liveAt ? "en direct" : feed.updatedAt ? "par le robot" : "—") + "</dl>" +
        (c.url ? '<a href="' + esc(c.url) + '" target="_blank" rel="noopener noreferrer">Voir le graphique ' + esc(c.sym) + " sur DexScreener</a>" : "") + "</div>";
    }
    return '<li class="coin" data-id="' + esc(c.id) + '"><button type="button" class="star" data-star="' + esc(c.id) + '" aria-pressed="' + fav + '" aria-label="' + (fav ? "Retirer " : "Suivre ") + esc(c.sym) + '"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3.2l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.5l6-.8z"/></svg></button>' +
      '<button type="button" class="c-main" data-open="' + esc(c.id) + '" aria-expanded="' + open + '"><span class="c-name"><b>' + esc(c.sym) + "</b><span>" + esc(c.name) + '</span></span><span class="c-price">' + fmtPrice(c.price) + '</span><span class="c-ch ' + dirCls(c.h1) + '">' + fmtPct(c.h1) + '</span><span class="c-ch ' + dirCls(c.h24) + '">' + fmtPct(c.h24) + "</span></button>" + more + "</li>";
  }
  let lastCoinsHtml = "", lastTrendHtml = "";
  function renderCoins() {
    for (const b of $("coin-sort").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.v === coinSort));
    const th = (feed.trending || []).map((c) => '<a href="https://www.coingecko.com/en/coins/' + encodeURIComponent(c.id) + '" target="_blank" rel="noopener noreferrer"><span class="nm">' + esc(c.sym) + '</span><span class="ch ' + dirCls(c.h24) + '">' + fmtPct(c.h24) + '</span><span class="rk">' + (c.rank ? "rang #" + NF0.format(c.rank) : esc(c.name)) + "</span></a>").join("");
    if (th !== lastTrendHtml) { $("trend").innerHTML = th; lastTrendHtml = th; }
    $("trend-wrap").hidden = !th;
    const q = coinQuery.trim().toLowerCase();
    const list = COINS.map(coinData).filter((c) => !q || c.sym.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
    list.sort((a, b) => (b[coinSort] == null ? -Infinity : b[coinSort]) - (a[coinSort] == null ? -Infinity : a[coinSort]));
    const mine = list.filter((c) => favs.has(c.id)), rest = list.filter((c) => !favs.has(c.id));
    let html = "";
    if (mine.length) html += '<li class="grp">Mes coins</li>' + mine.map(coinRow).join("") + '<li class="grp">Tous les memes Solana</li>';
    html += rest.map(coinRow).join("");
    if (!list.length) html = '<li class="empty">Aucun coin ne correspond à « ' + esc(coinQuery) + " ».</li>";
    if (html !== lastCoinsHtml) { $("coins").innerHTML = html; lastCoinsHtml = html; }
  }

  /* ---------- interactions ---------- */
  function setTab(t) {
    tab = t; store.set("tab", t);
    for (const b of document.querySelectorAll(".tab")) b.setAttribute("aria-selected", String(b.dataset.tab === t));
    $("view-feed").hidden = t !== "feed"; $("view-coins").hidden = t !== "coins"; $("view-settings").hidden = t !== "settings";
    $("market").hidden = t === "settings"; $("toast").hidden = true;
    window.scrollTo(0, 0); render();
  }
  function renderSettings() {
    $("set-sound").checked = !!settings.sound; $("set-wake").checked = !!settings.wake; $("set-general").checked = !!settings.general;
    for (const b of $("set-level").querySelectorAll("button")) b.setAttribute("aria-pressed", String(Number(b.dataset.v) === Number(settings.level)));
    for (const b of $("set-fast").querySelectorAll("button")) b.setAttribute("aria-pressed", String(Number(b.dataset.v) === Number(settings.fast)));
    $("ntfy-topic").value = store.get("ntfy", "") || "";
  }
  document.addEventListener("click", (ev) => {
    const tgt = ev.target instanceof Element ? ev.target : null;
    if (!tgt) return;
    if (settings.sound) ensureAudio();
    const tabBtn = tgt.closest(".tab"); if (tabBtn) return setTab(tabBtn.dataset.tab);
    const chip = tgt.closest(".chip"); if (chip) { filter = chip.dataset.f; store.set("filter", filter); return render(); }
    const vo = tgt.closest("[data-vo]"); if (vo) { const k = vo.dataset.vo; if (showVO.has(k)) showVO.delete(k); else showVO.add(k); return renderFeed(Date.now()); }
    const mv = tgt.closest(".mv[data-coin]"); if (mv) { openCoin = mv.dataset.coin; setTab("coins"); const li = document.querySelector('.coin[data-id="' + CSS.escape(openCoin) + '"]'); if (li) li.scrollIntoView({ block: "center" }); return; }
    const star = tgt.closest("[data-star]"); if (star) { const id = star.dataset.star; if (favs.has(id)) favs.delete(id); else favs.add(id); store.set("favs", [...favs]); return render(); }
    const open = tgt.closest("[data-open]"); if (open) { openCoin = openCoin === open.dataset.open ? null : open.dataset.open; return renderCoins(); }
    const seg = tgt.closest(".seg button");
    if (seg) {
      const g = seg.parentElement.id;
      if (g === "coin-sort") { coinSort = seg.dataset.v; store.set("coinSort", coinSort); renderCoins(); }
      if (g === "set-level") { settings.level = Number(seg.dataset.v); saveSettings(); renderSettings(); }
      if (g === "set-fast") { settings.fast = Number(seg.dataset.v); saveSettings(); renderSettings(); }
    }
  });
  $("toast").addEventListener("click", () => {
    const k = $("toast").dataset.k;
    if (tab !== "feed") setTab("feed");
    $("toast").hidden = true;
    let row = document.querySelector('.item[data-k="' + k + '"]');
    if (!row && filter !== "all") { filter = "all"; render(); row = document.querySelector('.item[data-k="' + k + '"]'); }
    if (row) { row.scrollIntoView({ block: "center" }); row.classList.remove("flash"); void row.offsetWidth; row.classList.add("flash"); }
  });
  let refreshing = false;
  $("refresh").addEventListener("click", async () => {
    if (refreshing) return;
    refreshing = true; $("refresh").classList.add("spin"); $("refresh").disabled = true;
    await Promise.allSettled([loadFeed(), loadLive()]);
    $("refresh").classList.remove("spin");
    setTimeout(() => { refreshing = false; $("refresh").disabled = false; }, 3000);
  });
  $("coin-q").addEventListener("input", (e) => { coinQuery = e.target.value; renderCoins(); });
  $("set-sound").addEventListener("change", (e) => { settings.sound = e.target.checked; saveSettings(); if (settings.sound) { ensureAudio(); ping(2); } });
  $("set-wake").addEventListener("change", (e) => { settings.wake = e.target.checked; saveSettings(); setWake(settings.wake); });
  $("set-general").addEventListener("change", (e) => { settings.general = e.target.checked; saveSettings(); render(); });
  $("ntfy-test").addEventListener("click", async () => {
    const topic = $("ntfy-topic").value.trim(), note = $("ntfy-note");
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(topic)) { note.textContent = "Entre le nom exact de ton canal (lettres, chiffres, tirets)."; return; }
    store.set("ntfy", topic);
    note.textContent = "Envoi…";
    try {
      const r = await fetch("https://ntfy.sh/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topic, title: "Meme Radar · test", message: "Si tu lis ça, les notifications marchent.", tags: ["white_check_mark"], priority: 3 }) });
      note.textContent = r.ok ? "Envoyée. Regarde ton iPhone." : "ntfy a refusé l'envoi (" + r.status + ").";
    } catch (e) { note.textContent = "Envoi impossible : vérifie ta connexion."; }
  });
  $("install-x").addEventListener("click", () => { $("install").hidden = true; store.set("installHidden", true); });

  /* ---------- clock and refresh loop ---------- */
  function tick() {
    const n = Date.now();
    $("clock").textContent = fmtHMS(n);
    for (const el of document.querySelectorAll("#feed [data-ts]")) { const s = ago(n - Number(el.dataset.ts)); if (el.textContent !== s) el.textContent = s; }
    renderFresh(n); renderStatus(n);
  }
  let lastFeedLoad = 0, lastLiveLoad = 0;
  function loop() {
    if (document.visibilityState !== "visible") return;
    const n = Date.now();
    if (n - lastFeedLoad >= 60000) { lastFeedLoad = n; loadFeed(); }
    if (n - lastLiveLoad >= 20000) { lastLiveLoad = n; loadLive(); }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { lastFeedLoad = 0; lastLiveLoad = 0; loop(); tick(); if (settings.wake && !wakeLock) setWake(true); }
  });
  window.addEventListener("online", () => { lastFeedLoad = 0; lastLiveLoad = 0; loop(); render(); });
  window.addEventListener("offline", render);

  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.navigator.standalone === true || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  $("install").hidden = !(ios && !standalone && !store.get("installHidden", false));

  renderSettings();
  if (settings.wake) setWake(true);
  setTab(tab);
  tick();
  setInterval(tick, 1000);
  setInterval(loop, 5000);
  loop();
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
