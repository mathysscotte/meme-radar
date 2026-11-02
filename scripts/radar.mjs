#!/usr/bin/env node
// Meme Radar robot. GitHub Actions runs it every 5 minutes.
// 1. Reads the previous feed from the live site, to know what was already seen and notified.
// 2. Collects Solana news (publisher RSS + Google News), Solana meme prices (DexScreener) and CoinGecko trending.
// 3. Scores every item, translates new titles to French, and pushes the critical ones to the phone through ntfy.
// 4. Writes site/feed.json, which the web app reads.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const env = process.env;
const SITE_URL = (env.SITE_URL || "").replace(/\/+$/, "");
const NTFY_TOPIC = (env.NTFY_TOPIC || "").trim();
const NTFY_SERVER = (env.NTFY_SERVER || "https://ntfy.sh").replace(/\/+$/, "");
const TG_TOKEN = (env.TELEGRAM_TOKEN || "").trim();
const TG_CHAT = (env.TELEGRAM_CHAT_ID || "").trim();
const NOTIFY_MIN = Number(env.NOTIFY_MIN || 3); // 3 = critical only, 2 = important and up
const NOTIFY_MAX = Number(env.NOTIFY_MAX || 4); // most notifications sent in one run
const NOTIFY_GENERAL = env.NOTIFY_GENERAL === "1"; // also notify critical news outside Solana
const DRY_RUN = env.DRY_RUN === "1";
const FIXTURES = env.FIXTURES || "";
const OUT = env.OUT || "site/feed.json";
const NOW = Number(env.NOW || Date.now());
const H = 3600000;

// The 20 Solana meme coins followed (CoinGecko id, ticker, name, Solana mint), checked against CoinGecko.
export const COINS = [
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
];
const SOL_MINT = "So11111111111111111111111111111111111111112";

const GN = (q, lang = "en") => lang === "fr"
  ? "https://news.google.com/rss/search?q=" + encodeURIComponent(q + " when:1d") + "&hl=fr&gl=FR&ceid=FR:fr"
  : "https://news.google.com/rss/search?q=" + encodeURIComponent(q + " when:1d") + "&hl=en-US&gl=US&ceid=US:en";
// Publisher feeds first (direct links), Google News searches after (they catch the rest within minutes).
const FEEDS = [
  ["Cointelegraph", "https://cointelegraph.com/rss/tag/solana"],
  ["Cointelegraph", "https://cointelegraph.com/rss"],
  ["CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss/"],
  ["Decrypt", "https://decrypt.co/feed"],
  ["The Block", "https://www.theblock.co/rss.xml"],
  ["CryptoSlate", "https://cryptoslate.com/feed/"],
  ["Blockworks", "https://blockworks.co/feed"],
  ["crypto.news", "https://crypto.news/feed/"],
  ["CoinGape", "https://coingape.com/feed/"],
  ["Google News", GN("solana memecoin")],
  ["Google News", GN('"pump.fun"')],
  ["Google News", GN("memecoin launch")],
  ["Google News", GN("Trump memecoin")],
  ["Google News", GN("solana")],
  ["Google News", GN('meme coin listing Binance OR Coinbase OR Upbit OR Robinhood')],
  ["Google News", GN("memecoin solana", "fr")],
];

/* ---------------- small helpers ---------------- */
const log = (...a) => console.log("[radar]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
const normTitle = (s) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç" };
function decode(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => (ENT[n.toLowerCase()] != null ? ENT[n.toLowerCase()] : m))
    .replace(/\s+/g, " ")
    .trim();
}

let fixtureMap = null;
async function fixture(url) {
  fixtureMap = fixtureMap || JSON.parse(await readFile(join(FIXTURES, "map.json"), "utf8"));
  for (const [needle, file] of Object.entries(fixtureMap)) {
    if (url.includes(needle)) {
      if (file === 404) { const e = new Error("HTTP 404"); e.status = 404; throw e; }
      return readFile(join(FIXTURES, file), "utf8");
    }
  }
  const e = new Error("HTTP 404 (no fixture) " + url); e.status = 404; throw e;
}
async function get(url, { json = false, timeout = 12000 } = {}) {
  const text = FIXTURES ? await fixture(url) : await (async () => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(url, { signal: ctl.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; MemeRadar/1.0)", accept: json ? "application/json" : "application/rss+xml, application/xml;q=0.9, */*;q=0.8" } });
      if (!r.ok) { const e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
      return await r.text();
    } finally { clearTimeout(timer); }
  })();
  return json ? JSON.parse(text) : text;
}

/* ---------------- formatting (French, for signals and notifications) ---------------- */
const NF1 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const NF0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const NFS4 = new Intl.NumberFormat("fr-FR", { maximumSignificantDigits: 4 });
const NNBSP = " ";
const SUB = "₀₁₂₃₄₅₆₇₈₉";
export function fmtPct(x) {
  if (x == null || !isFinite(x)) return "—";
  const a = Math.abs(x);
  return (x >= 0.05 ? "+" : x <= -0.05 ? "−" : "") + (a >= 100 ? NF0.format(a) : NF1.format(a)) + NNBSP + "%";
}
export function fmtPrice(p) {
  if (p == null || !isFinite(p) || p <= 0) return "—";
  if (p >= 1000) return NF0.format(p) + NNBSP + "$";
  if (p >= 0.0001) return NFS4.format(p) + NNBSP + "$";
  let zeros = Math.ceil(-Math.log10(p)) - 1;
  let sig = Math.round(p * Math.pow(10, zeros + 4));
  if (sig >= 10000) { sig = Math.round(sig / 10); zeros -= 1; }
  if (sig > 0 && sig < 1000) { sig *= 10; zeros += 1; }
  return "0,0" + String(zeros).split("").map((d) => SUB[+d]).join("") + String(sig).replace(/0+$/, "") + NNBSP + "$";
}
export function fmtUsd(v) {
  if (v == null || !isFinite(v)) return "—";
  if (v >= 1e9) return NF1.format(v / 1e9) + NNBSP + "Md$";
  if (v >= 1e6) return (v / 1e6 >= 100 ? NF0.format(v / 1e6) : NF1.format(v / 1e6)) + NNBSP + "M$";
  if (v >= 1e3) return NF0.format(v / 1e3) + NNBSP + "k$";
  return NF0.format(v) + NNBSP + "$";
}

/* ---------------- news ---------------- */
function tag(block, name) {
  const m = block.match(new RegExp("<" + name + "\\b[^>]*>([\\s\\S]*?)</" + name + ">", "i"));
  return m ? m[1] : "";
}
export function parseFeed(xml, srcName) {
  const out = [];
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    let title = decode(tag(b, "title"));
    let link = decode(tag(b, "link"));
    if (!/^https?:/i.test(link)) { const m = b.match(/<link[^>]*href="([^"]+)"/i); link = m ? decode(m[1]) : ""; }
    const date = decode(tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date"));
    let src = srcName;
    if (srcName === "Google News") {
      const s = decode(tag(b, "source"));
      const cut = title.lastIndexOf(" - ");
      if (cut > 20) { src = s || title.slice(cut + 3); title = title.slice(0, cut); }
      else if (s) src = s;
    }
    if (!title || title.length < 12 || !/^https?:/i.test(link)) continue;
    let t = Date.parse(date);
    if (!isFinite(t)) t = NOW;
    if (t > NOW + 10 * 60000) t = NOW;
    out.push({ id: "n" + hash(normTitle(title)), kind: "news", t, title, url: link, src: src.slice(0, 40), gnews: srcName === "Google News" });
  }
  return out;
}

const RX = {
  memeWords: /\b(bonk|dogwifhat|fartcoin|popcat|pudgy penguins|pengu|moo ?deng|pnut|peanut the squirrel|book of meme|goatseus|gigachad|ponke|chill ?guy|jelly-?my-?jelly|useless coin|melania|pump\.fun|pumpfun|pumpswap|letsbonk|bonk\.fun|moonshot)\b/gi,
  memeSyms: /\b(PUMP|TRUMP|PENGU|BONK|WIF|USELESS|FARTCOIN|MELANIA|JELLYJELLY|BOME|PNUT|POPCAT|MEW|MOODENG|GIGA|GOAT|PONKE|CHILLGUY)\b/g,
  memeGeneric: /\b(meme ?coins?|memecoins?|mème|memes? crypto)\b/i,
  solW: /\b(solana|pump\.?fun|pumpswap|raydium|jupiter|phantom wallet|meteora|letsbonk|bonk\.fun|moonshot|jito|firedancer|helius|solflare|anza|solana mobile)\b/i,
  solA: /\b(SOL|SVM)\b/,
  celeb: /\b(Trump|Melania|Barron|Elon Musk|Musk|Kanye|Milei|Bukele|Snoop Dogg|Drake|Logan Paul|MrBeast|Andrew Tate|Iggy Azalea|Caitlyn Jenner|Hawk Tuah)\b/,
  launch: /\b(launch(?:es|ed|ing)?|unveil(?:s|ed)?|debut(?:s|ed)?|releases?|released|introduc(?:es|ed)|rolls? out|lance|lancé|lancement|dévoile)\b/i,
  tokenWord: /\b(meme ?coins?|memecoins?|tokens?|coin|jeton|crypto-monnaie)\b/i,
  exch: /\b(Binance|Coinbase|Upbit|Bithumb|Robinhood|OKX|Bybit|Kraken|Bitget|KuCoin|Gate\.io|HTX|MEXC|Hyperliquid|Revolut|Crypto\.com)\b/i,
  listWord: /\b(lists?|listed|listings?|delists?|delisted|delisting|will (?:add|list|support)|adds? (?:support|trading)|launch(?:es|ed)? (?:trading|perpetuals?|futures)|perpetuals?|perps|spot trading|launchpool|cotation|liste)\b/i,
  listing: /\b(listings?|delisting|delist(?:s|ed)?|cotation)\b/i,
  hack: /\b(hack(?:s|ed|er|ers)?|exploit(?:s|ed)?|drain(?:s|ed|er)?|rug ?pull(?:s|ed)?|rugged|scam(?:s|mer|mers)?|stolen|theft|breach(?:es|ed)?|phishing|compromised|insider (?:trading|selling)|honeypot|snipers?|bundled|piratage|piraté|arnaque)\b/i,
  outage: /\b(outage|halt(?:s|ed)?|downtime|degraded|stall(?:s|ed)?|congestion|panne)\b/i,
  reguA: /\b(SEC|CFTC|ETFs?|DOJ|FBI|MiCA|AMF|FCA)\b/,
  reguW: /\b(lawsuits?|sues?|sued|suing|regulat(?:or|ors|ion|ions|ory)|bans?|banned|court|judge|congress|senate|indict(?:ed|ment)|arrest(?:ed|s)?|probe|investigation|sanction(?:s|ed)?|interdiction|procès|plainte|tribunal)\b/i,
  macroA: /\b(Fed|FOMC|Powell|CPI|PCE|DXY|BCE|ECB)\b/,
  macroW: /\b(rate (?:cut|cuts|hike|hikes)|interest rates?|inflation|jobs report|payrolls|unemployment|tariffs?|recession|treasury yields?|stimulus|taux directeurs?)\b/i,
  flow: /\b(whales?|liquidat(?:ed|ion|ions)|short squeeze|open interest|inflows?|outflows?|buybacks?|burn(?:s|ed)?|unlocks?|unlocked|airdrops?|smart money|dumps?|accumulat(?:e|es|ed|ing|ion)|baleines?)\b/i,
  infl: /\b(Elon Musk|Musk|Trump|Melania|Saylor|CZ|Changpeng Zhao|Vitalik|Justin Sun|Yakovenko|Ansem|Murad)\b/,
  mkt: /\b(bitcoin|btc|ethereum|solana|crypto market|altcoins?|all-time high|record high|crash(?:es|ed)?|plunge[sd]?|surge[sd]?|soar(?:s|ed)?|jumps?|rall(?:y|ies|ied)|tumble[sd]?|slump(?:s|ed)?|slides?|sell-?off)\b/i,
};
const MEME_LABEL = [[/^bonk$/i, "BONK"], [/dogwifhat/i, "WIF"], [/fartcoin/i, "FARTCOIN"], [/popcat/i, "POPCAT"], [/pengu|pudgy/i, "PENGU"], [/moo ?deng/i, "MOODENG"], [/pnut|peanut/i, "PNUT"], [/book of meme/i, "BOME"], [/goatseus/i, "GOAT"], [/gigachad/i, "GIGA"], [/ponke/i, "PONKE"], [/chill ?guy/i, "CHILLGUY"], [/jelly/i, "JELLYJELLY"], [/useless/i, "USELESS"], [/melania/i, "MELANIA"], [/pump\.?fun|pumpswap/i, "pump.fun"], [/letsbonk|bonk\.fun/i, "letsbonk"], [/moonshot/i, "Moonshot"]];
function memeMatches(text) {
  const out = [];
  const add = (l) => { if (l && !out.includes(l) && out.length < 3) out.push(l); };
  for (const m of text.matchAll(RX.memeSyms)) add(m[1]);
  for (const m of text.matchAll(RX.memeWords)) { const lab = MEME_LABEL.find(([r]) => r.test(m[1])); add(lab ? lab[1] : m[1]); }
  return out;
}
export const levelOf = (s) => (s >= 5 ? 3 : s >= 3 ? 2 : s >= 1 ? 1 : 0);
export function scoreNews(it) {
  const text = it.title;
  const tags = [];
  let s = 0;
  const memes = memeMatches(text);
  if (memes.length) { s += 3; for (const m of memes.slice(0, 2)) tags.push({ k: "meme", label: m }); }
  else if (RX.memeGeneric.test(text)) { s += 1; tags.push({ k: "meme", label: "Meme" }); }
  // A famous person launching a coin: the alert this app exists for, Solana mentioned or not.
  const launch = RX.celeb.test(text) && RX.launch.test(text) && RX.tokenWord.test(text);
  if (launch) { s += 6; tags.unshift({ k: "launch", label: "Lancement" }); }
  const ex = RX.exch.test(text);
  if (ex && RX.listWord.test(text)) { s += 3; tags.push({ k: "listing", label: "Listing" }); }
  else if (RX.listing.test(text)) { s += 2; tags.push({ k: "listing", label: "Listing" }); }
  else if (ex) s += 1;
  if (RX.hack.test(text)) { s += 3; tags.push({ k: "hack", label: "Hack / rug" }); }
  const solHit = RX.solW.test(text) || RX.solA.test(text);
  if (solHit && RX.outage.test(text)) { s += 4; tags.push({ k: "hack", label: "Panne" }); }
  if (RX.reguA.test(text) || RX.reguW.test(text)) { s += 2; tags.push({ k: "regu", label: "Régulation" }); }
  if (RX.macroA.test(text) || RX.macroW.test(text)) { s += 3; tags.push({ k: "macro", label: "Macro" }); }
  const inf = text.match(RX.infl);
  if (inf && !launch) { s += 2; tags.push({ k: "infl", label: inf[1] }); }
  if (RX.flow.test(text)) { s += 1; tags.push({ k: "flow", label: "Baleines / flux" }); }
  if (RX.mkt.test(text)) s += 1;
  it.sol = !!(memes.length || solHit || launch);
  if (!it.sol) tags.unshift({ k: "off", label: "Hors Solana" });
  else if (!memes.length && !launch) { s += 1; tags.push({ k: "sol", label: "Solana" }); }
  it.score = Math.min(10, s);
  it.level = levelOf(it.score);
  it.tags = tags.slice(0, 4);
  return it;
}
const looksFrench = (s) => (s.match(/\b(le|la|les|des|du|une|est|pour|dans|avec|sur|sont|après|selon|aux)\b/gi) || []).length >= 2;

async function collectNews() {
  const seen = new Set(), items = [];
  const results = await Promise.allSettled(FEEDS.map(([name, url]) => get(url).then((xml) => parseFeed(xml, name))));
  let ok = 0;
  results.forEach((r, i) => {
    if (r.status !== "fulfilled") { log("source en échec :", FEEDS[i][0], String(r.reason && r.reason.message || r.reason).slice(0, 80)); return; }
    ok++;
    for (const it of r.value) {
      if (NOW - it.t > 36 * H) continue;
      const k = normTitle(it.title).slice(0, 70);
      if (seen.has(k)) continue;
      seen.add(k);
      items.push(scoreNews(it));
    }
  });
  log("news :", items.length, "titres depuis", ok, "/", FEEDS.length, "sources");
  return { items, sourcesOk: ok };
}

/* ---------------- prices (DexScreener) ---------------- */
async function collectMarkets() {
  const addrs = COINS.map((c) => c[3]).concat(SOL_MINT);
  const data = await get("https://api.dexscreener.com/tokens/v1/solana/" + addrs.join(","), { json: true });
  const pairs = Array.isArray(data) ? data : (data && data.pairs) || [];
  const best = new Map();
  for (const p of pairs) {
    const a = p && p.baseToken && p.baseToken.address;
    if (!a || !addrs.includes(a)) continue;
    if (!best.has(a) || ((p.liquidity && p.liquidity.usd) || 0) > ((best.get(a).liquidity && best.get(a).liquidity.usd) || 0)) best.set(a, p);
  }
  const snap = (p) => p && {
    price: Number(p.priceUsd) || null,
    m5: p.priceChange && p.priceChange.m5, h1: p.priceChange && p.priceChange.h1, h6: p.priceChange && p.priceChange.h6, h24: p.priceChange && p.priceChange.h24,
    vol24: p.volume && p.volume.h24, vol1: p.volume && p.volume.h1, liq: p.liquidity && p.liquidity.usd, mcap: p.marketCap || p.fdv || null,
    buys1: p.txns && p.txns.h1 && p.txns.h1.buys, sells1: p.txns && p.txns.h1 && p.txns.h1.sells, url: p.url || null,
  };
  const coins = COINS.map(([id, sym, name, addr]) => Object.assign({ id, sym, name, addr }, snap(best.get(addr)) || {}));
  const sol = Object.assign({ id: "solana", sym: "SOL", name: "Solana", addr: SOL_MINT }, snap(best.get(SOL_MINT)) || {});
  log("prix :", coins.filter((c) => c.price).length, "/", COINS.length, "memes, SOL", sol.price ? "ok" : "absent");
  return { coins, sol };
}

const SIG_TEXT = {
  pump: (c) => c.sym + " " + fmtPct(c.h1) + " en 1" + NNBSP + "h", dump: (c) => c.sym + " " + fmtPct(c.h1) + " en 1" + NNBSP + "h",
  fastup: (c) => c.sym + " " + fmtPct(c.m5) + " en 5" + NNBSP + "min", fastdown: (c) => c.sym + " " + fmtPct(c.m5) + " en 5" + NNBSP + "min",
  pump24: (c) => c.sym + " " + fmtPct(c.h24) + " en 24" + NNBSP + "h", dump24: (c) => c.sym + " " + fmtPct(c.h24) + " en 24" + NNBSP + "h",
};
const SIG_LABEL = { pump: "Pump 1 h", dump: "Dump 1 h", fastup: "Mouvement éclair", fastdown: "Mouvement éclair", pump24: "Pump 24 h", dump24: "Dump 24 h", trend: "Tendance" };
const COOLDOWN = { pump: 2 * H, dump: 2 * H, fast: 0.5 * H, pump24: 12 * H, dump24: 12 * H, trend: 6 * H };
const group = (sig) => (sig === "fastup" || sig === "fastdown" ? "fast" : sig);

function priceSignals(coins, sol, sigs, quiet) {
  const out = [];
  const consider = (c, sig, val, base, step) => {
    const k = c.id + ":" + group(sig), prev = sigs[k];
    if (prev && NOW - prev.t < COOLDOWN[group(sig)] && !(Math.abs(val) >= Math.abs(prev.val) + step)) return;
    sigs[k] = { t: NOW, val };
    if (quiet) return; // first run: remember the state, say nothing
    const it = {
      id: "s" + hash(k + ":" + Math.floor(NOW / 60000)), kind: "signal", sig, sym: c.sym, coin: c.id, val, t: NOW, src: "Signal marché", url: c.url || null,
      title: SIG_TEXT[sig](c), desc: "Prix " + fmtPrice(c.price) + " · 24" + NNBSP + "h " + fmtPct(c.h24) + " · Vol. 24" + NNBSP + "h " + fmtUsd(c.vol24) + " · Liq. " + fmtUsd(c.liq),
      score: base, level: levelOf(base), sol: true, tags: [{ k: "signal", label: SIG_LABEL[sig] }],
    };
    it.titleFr = it.title;
    out.push(it);
  };
  for (const c of coins) {
    if (!c.price || (c.liq || 0) < 50000) continue; // too thin to mean anything
    if (c.h1 != null && Math.abs(c.h1) >= 8) consider(c, c.h1 > 0 ? "pump" : "dump", c.h1, Math.abs(c.h1) >= 15 ? 5 : 4, 8);
    if (c.m5 != null && Math.abs(c.m5) >= 8) consider(c, c.m5 > 0 ? "fastup" : "fastdown", c.m5, 5, 8);
    if (c.h24 != null && (c.h24 >= 40 || c.h24 <= -30)) consider(c, c.h24 > 0 ? "pump24" : "dump24", c.h24, 4, 30);
  }
  // SOL itself: a sharp move of the base coin moves every Solana meme.
  if (sol && sol.price) {
    if (sol.h1 != null && Math.abs(sol.h1) >= 4) consider(sol, sol.h1 > 0 ? "pump" : "dump", sol.h1, 5, 3);
    if (sol.m5 != null && Math.abs(sol.m5) >= 2.5) consider(sol, sol.m5 > 0 ? "fastup" : "fastdown", sol.m5, 5, 2.5);
    if (sol.h24 != null && Math.abs(sol.h24) >= 10) consider(sol, sol.h24 > 0 ? "pump24" : "dump24", sol.h24, 4, 8);
  }
  return out;
}

/* ---------------- CoinGecko trending, Solana only ---------------- */
async function collectTrending(chains) {
  const data = await get("https://api.coingecko.com/api/v3/search/trending", { json: true });
  const list = ((data && data.coins) || []).map((x) => x && x.item).filter(Boolean).map((i) => ({
    id: i.id, sym: String(i.symbol || "").toUpperCase(), name: i.name, rank: i.market_cap_rank || null,
    price: i.data && Number(i.data.price) || null, h24: i.data && i.data.price_change_percentage_24h && i.data.price_change_percentage_24h.usd,
  }));
  const known = new Set(COINS.map((c) => c[0]));
  let looked = 0;
  for (const c of list) {
    if (known.has(c.id)) { chains[c.id] = { sol: true, meme: true }; continue; }
    if (chains[c.id] || looked >= 4) continue;
    looked++;
    try {
      const d = await get("https://api.coingecko.com/api/v3/coins/" + encodeURIComponent(c.id) + "?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false", { json: true });
      const plats = d.platforms || {};
      chains[c.id] = { sol: d.asset_platform_id === "solana" || Object.prototype.hasOwnProperty.call(plats, "solana"), meme: (d.categories || []).some((x) => /meme/i.test(String(x))) };
      await sleep(400);
    } catch (e) { log("chaîne inconnue pour", c.id, e.message); }
  }
  return list.filter((c) => chains[c.id] && chains[c.id].sol).map((c) => Object.assign(c, { meme: !!chains[c.id].meme }));
}

/* ---------------- French titles (MyMemory, free) ---------------- */
async function translate(items, budget) {
  let done = 0;
  for (const it of items) {
    if (done >= budget) break;
    if (it.titleFr || it.kind !== "news") continue;
    if (looksFrench(it.title)) { it.titleFr = it.title; continue; }
    try {
      const j = await get("https://api.mymemory.translated.net/get?langpair=en%7Cfr&q=" + encodeURIComponent(it.title.slice(0, 480)), { json: true, timeout: 9000 });
      const t = j && j.responseData && decode(j.responseData.translatedText);
      const status = Number(j && j.responseStatus);
      if (status === 200 && t && !/MYMEMORY WARNING|QUERY LENGTH|INVALID LANGUAGE/i.test(t)) { it.titleFr = t; done++; }
      else if (/MYMEMORY WARNING/i.test(t || "") || status === 429) { log("traduction : quota du jour atteint"); break; }
    } catch (e) { log("traduction en échec :", e.message); break; }
    await sleep(150);
  }
  return done;
}

/* ---------------- ntfy ---------------- */
const LEVEL_TXT = ["INFO", "À SUIVRE", "IMPORTANT", "CRITIQUE"];
function notification(it) {
  const launch = it.tags.some((t) => t.k === "launch"), hack = it.tags.some((t) => t.k === "hack");
  return {
    topic: NTFY_TOPIC,
    title: (launch ? "Lancement de coin" : it.kind === "signal" ? "Signal marché" : LEVEL_TXT[it.level].charAt(0) + LEVEL_TXT[it.level].slice(1).toLowerCase()) + (it.src && it.kind !== "signal" ? " · " + it.src : ""),
    message: it.titleFr || it.title,
    priority: launch || hack ? 5 : 4,
    tags: [launch ? "rocket" : hack ? "rotating_light" : it.kind === "signal" ? (it.val > 0 ? "chart_with_upwards_trend" : "chart_with_downwards_trend") : "loudspeaker"],
    click: it.url || (SITE_URL ? SITE_URL + "/" : undefined),
    actions: SITE_URL ? [{ action: "view", label: "Ouvrir Meme Radar", url: SITE_URL + "/" }] : undefined,
  };
}
const EMOJI = { rocket: "🚀", rotating_light: "🚨", chart_with_upwards_trend: "📈", chart_with_downwards_trend: "📉", loudspeaker: "📢", white_check_mark: "✅", bell: "🔔" };
const htmlEsc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// The same alert, written as a Telegram message (HTML formatting).
function telegramText(p) {
  const site = SITE_URL ? SITE_URL + "/" : "";
  const links = [];
  if (p.click && p.click !== site) links.push('<a href="' + htmlEsc(p.click) + '">' + (/dexscreener/.test(p.click) ? "Voir le graphique" : /coingecko/.test(p.click) ? "Voir sur CoinGecko" : "Lire l'article") + "</a>");
  if (site) links.push('<a href="' + htmlEsc(site) + '">Ouvrir Meme Radar</a>');
  return (EMOJI[(p.tags || [])[0]] || "📢") + " <b>" + htmlEsc(p.title) + "</b>\n" + htmlEsc(p.message) + (links.length ? "\n" + links.join(" · ") : "");
}
// Sends one alert to every channel that is set up: ntfy (NTFY_TOPIC) and/or Telegram (TELEGRAM_TOKEN + TELEGRAM_CHAT_ID).
async function push(payload) {
  const useNtfy = !!NTFY_TOPIC, useTg = !!(TG_TOKEN && TG_CHAT);
  if (!useNtfy && !useTg) return false;
  if (DRY_RUN || FIXTURES) {
    if (useNtfy) log("NOTIF ntfy (test, non envoyée) :", JSON.stringify(Object.assign({}, payload, { topic: "***" })));
    if (useTg) log("NOTIF Telegram (test, non envoyée) :", JSON.stringify(telegramText(payload)));
    return true;
  }
  let ok = false;
  if (useNtfy) {
    try {
      const r = await fetch(NTFY_SERVER + "/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.assign({}, payload, { topic: NTFY_TOPIC })) });
      if (r.ok) ok = true; else log("ntfy a refusé la notif :", r.status);
    } catch (e) { log("ntfy injoignable :", e.message); }
  }
  if (useTg) {
    try {
      const r = await fetch("https://api.telegram.org/bot" + TG_TOKEN + "/sendMessage", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: TG_CHAT, text: telegramText(payload), parse_mode: "HTML", disable_web_page_preview: !/^https?:/.test(payload.click || "") || /dexscreener|coingecko|github\.io/.test(payload.click || "") }),
      });
      if (r.ok) ok = true; else log("Telegram a refusé le message :", r.status, (await r.text()).slice(0, 160).replace(TG_TOKEN, "***"));
    } catch (e) { log("Telegram injoignable :", String(e.message).replace(TG_TOKEN, "***")); }
  }
  return ok;
}

/* ---------------- main ---------------- */
async function loadPrevious() {
  if (!SITE_URL) return { prev: null, firstDeploy: false, reachable: false };
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return { prev: await get(SITE_URL + "/feed.json?t=" + NOW, { json: true }), firstDeploy: false, reachable: true }; }
    catch (e) {
      if (e.status === 404) return { prev: null, firstDeploy: true, reachable: true };
      log("flux précédent illisible :", e.message);
      await sleep(2000);
    }
  }
  return { prev: null, firstDeploy: false, reachable: false };
}

async function main() {
  const { prev, firstDeploy, reachable } = await loadPrevious();
  const st = (prev && prev.state) || {};
  const seenAt = Object.assign({}, st.seen || {});
  const notified = new Set(st.notified || []);
  const sigs = Object.assign({}, st.sigs || {});
  const chains = Object.assign({}, st.chains || {});
  // Without the previous state we can't tell new from old: collect, but stay silent this run.
  const quiet = !prev;

  const news = await collectNews();
  let markets = { coins: (prev && prev.coins) || [], sol: (prev && prev.sol) || null };
  try { markets = await collectMarkets(); } catch (e) { log("DexScreener en échec :", e.message); }
  let trending = (prev && prev.trending) || [];
  try { trending = await collectTrending(chains); } catch (e) { log("tendances CoinGecko en échec :", e.message); }

  const prevItems = new Map(((prev && prev.items) || []).map((i) => [i.id, i]));
  const fresh = [];
  for (const it of news.items) {
    if (prevItems.has(it.id)) continue;
    // Keep Solana stories, and critical ones from elsewhere for the app's "hors Solana" option.
    if (!it.sol && it.level < 3) { seenAt[it.id] = seenAt[it.id] || NOW; continue; }
    if (seenAt[it.id]) continue; // dropped out of the list earlier, came back through another source
    seenAt[it.id] = NOW;
    fresh.push(it);
  }
  const signals = priceSignals(markets.coins, markets.sol, sigs, quiet);

  // New Solana coins entering CoinGecko trending (compared with the previous run).
  const prevTrend = new Set((st.trendIds || []));
  if (!quiet && prevTrend.size) {
    for (const c of trending) {
      if (prevTrend.has(c.id)) continue;
      const k = c.id + ":trend", p = sigs[k];
      if (p && NOW - p.t < COOLDOWN.trend) continue;
      sigs[k] = { t: NOW, val: 0 };
      const base = c.meme ? 4 : 3;
      signals.push({ id: "s" + hash(k + ":" + Math.floor(NOW / 60000)), kind: "signal", sig: "trend", sym: c.sym, coin: c.id, val: c.h24, t: NOW, src: "Signal marché",
        url: "https://www.coingecko.com/en/coins/" + c.id, title: c.sym + " entre dans les tendances CoinGecko", titleFr: c.sym + " entre dans les tendances CoinGecko",
        desc: c.name + (c.rank ? " · rang #" + c.rank : "") + " · 24" + NNBSP + "h " + fmtPct(c.h24) + " · prix " + fmtPrice(c.price),
        score: base, level: levelOf(base), sol: true, tags: [{ k: "signal", label: "Tendance" }] });
    }
  }

  // Translate the newest first; titles already translated are kept from the previous feed.
  const toTranslate = fresh.slice().sort((a, b) => b.t - a.t);
  for (const it of prevItems.values()) if (it.kind === "news" && !it.titleFr && NOW - it.t < 12 * H) toTranslate.push(it);
  const translated = await translate(toTranslate, 30);

  // Notifications: new, recent, important enough, and never sent before.
  let sent = 0;
  if (firstDeploy) {
    await push({ topic: NTFY_TOPIC, title: "Meme Radar est connecté", message: "Tu recevras ici les alertes critiques sur les memes Solana : lancements de coins, listings, hacks et gros mouvements de prix.", tags: ["white_check_mark"], priority: 3, click: SITE_URL ? SITE_URL + "/" : undefined });
  }
  if (!quiet) {
    const candidates = fresh.concat(signals)
      .filter((it) => it.level >= NOTIFY_MIN && (it.sol || NOTIFY_GENERAL) && !notified.has(it.id) && NOW - it.t < 3 * H)
      .sort((a, b) => b.score - a.score || b.t - a.t);
    for (const it of candidates.slice(0, NOTIFY_MAX)) { if (await push(notification(it))) { notified.add(it.id); sent++; } }
    if (candidates.length > NOTIFY_MAX) {
      await push({ topic: NTFY_TOPIC, title: "Meme Radar", message: "+" + (candidates.length - NOTIFY_MAX) + " autres alertes importantes dans le fil.", tags: ["bell"], priority: 3, click: SITE_URL ? SITE_URL + "/" : undefined });
      for (const it of candidates.slice(NOTIFY_MAX)) notified.add(it.id);
    }
  }

  // Merge and write the feed.
  const items = [...prevItems.values()].concat(fresh, signals)
    .filter((i) => NOW - i.t < 48 * H)
    .sort((a, b) => b.t - a.t)
    .slice(0, 250)
    .map(({ gnews, ...i }) => i);
  for (const [k, t] of Object.entries(seenAt)) if (NOW - t > 4 * 24 * H) delete seenAt[k];
  for (const [k, v] of Object.entries(sigs)) if (NOW - v.t > 24 * H) delete sigs[k];
  const chainKeys = Object.keys(chains);
  for (const k of chainKeys.slice(0, Math.max(0, chainKeys.length - 400))) delete chains[k];
  const feed = {
    v: 1,
    updatedAt: new Date(NOW).toISOString(),
    site: SITE_URL || null,
    sources: { news: news.sourcesOk + "/" + FEEDS.length },
    items,
    coins: markets.coins,
    sol: markets.sol,
    trending,
    state: { seen: seenAt, notified: [...notified].slice(-400), sigs, chains, trendIds: trending.map((c) => c.id) },
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(feed));
  log("fil écrit :", items.length, "éléments,", fresh.length, "nouveaux,", signals.length, "signaux,", translated, "traduits,", sent, "notifs envoyées",
    quiet ? (reachable ? "(premier passage : notifs en silence)" : "(site illisible : notifs en silence)") : "");
}

main().catch((e) => { console.error("[radar] échec :", e); process.exit(1); });
