#!/usr/bin/env node
"use strict";
/*
 * ネウチ！ — 人の価値観を読む逆オークションゲーム
 * 依存ライブラリゼロのゲームサーバー (Node.js v18+ 推奨 / 動作確認 v22)
 *
 *   起動:  node server.js            (ポート3000)
 *          PORT=8080 node server.js  (ポート指定)
 *
 * ブラウザで http://<サーバーのIP>:3000 を開くと遊べます。
 */

const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const SPEED = process.env.SPEED || "normal"; // "fast" はテスト用

// ============================================================
// タイマー設定 (秒)
// ============================================================
const T = SPEED === "fast"
  ? { news: 0.2, bid: 1.2, reveal: 0.3, payout: 0.2, guess: 1.0, botMin: 0.05, botMax: 0.6 }
  : { news: 7, bid: 30, reveal: 9, payout: 4, guess: 30, botMin: 3, botMax: 20 };

const TOTAL_ROUNDS = Number(process.env.ROUNDS || 10);
const START_MONEY = 1000;
const BASE_FEE = 5;
const BASE_INCOME = 10;
const GUESS_BONUS = 100;
const MAX_PLAYERS = 30;

// ============================================================
// 商品データベース  [名前, タグ[], 基本値, レア度]
// レア度: C=コモン R=レア S=スーパーレア
// ============================================================
const ITEMS_RAW = [
  // 定番・食べ物
  ["カレーライス", ["食べ物", "定番"], 40, "C"],
  ["ラーメン", ["食べ物", "定番"], 45, "C"],
  ["おにぎり", ["食べ物", "定番"], 25, "C"],
  ["高級寿司", ["食べ物", "高級"], 90, "R"],
  ["メロン一玉", ["食べ物", "高級"], 70, "R"],
  ["駄菓子詰め合わせ", ["食べ物", "かわいい"], 30, "C"],
  ["巨大パフェ", ["食べ物", "巨大"], 55, "C"],
  ["宇宙食セット", ["食べ物", "宇宙", "技術"], 60, "R"],
  ["幻のキノコ", ["食べ物", "謎", "自然"], 65, "R"],
  ["金箔ソフトクリーム", ["食べ物", "高級", "ネタ"], 50, "C"],
  ["一生分のコーヒー", ["食べ物", "巨大"], 85, "R"],
  ["伝説のカレーのレシピ", ["食べ物", "謎", "芸術"], 75, "R"],
  // 動物・かわいい
  ["猫", ["動物", "かわいい", "定番"], 60, "C"],
  ["柴犬", ["動物", "かわいい", "定番"], 60, "C"],
  ["ハムスター", ["動物", "かわいい"], 35, "C"],
  ["アルパカ", ["動物", "かわいい", "自然"], 55, "C"],
  ["ペンギンの群れ", ["動物", "かわいい", "巨大"], 80, "R"],
  ["伝説の白い鹿", ["動物", "謎", "自然"], 95, "S"],
  ["おしゃべりインコ", ["動物", "かわいい", "ネタ"], 45, "C"],
  ["カピバラ温泉付き", ["動物", "かわいい", "高級"], 85, "R"],
  ["深海の新種生物", ["動物", "謎", "自然"], 70, "R"],
  ["招き猫(本物)", ["動物", "謎", "芸術"], 65, "R"],
  // 高級・芸術
  ["ダイヤモンド", ["高級", "定番"], 100, "R"],
  ["純金の延べ棒", ["高級"], 95, "R"],
  ["有名画家の絵画", ["芸術", "高級"], 90, "R"],
  ["古代の壺", ["芸術", "謎"], 60, "C"],
  ["オーケストラ貸切券", ["芸術", "高級"], 75, "R"],
  ["天才彫刻家の失敗作", ["芸術", "ネタ", "謎"], 40, "C"],
  ["幻のバイオリン", ["芸術", "高級", "謎"], 110, "S"],
  ["巨大な氷の彫刻", ["芸術", "巨大"], 50, "C"],
  ["書道家の魂の一筆", ["芸術"], 55, "C"],
  ["虹色に光る鉱石", ["高級", "謎", "自然"], 80, "R"],
  // 空想・宇宙
  ["宇宙旅行チケット", ["宇宙", "空想", "高級"], 120, "S"],
  ["月の土地権利書", ["宇宙", "空想"], 70, "R"],
  ["流れ星の欠片", ["宇宙", "謎"], 65, "R"],
  ["ドラゴンの卵", ["空想", "動物", "謎"], 100, "S"],
  ["魔法のじゅうたん", ["空想", "乗り物"], 85, "R"],
  ["タイムマシン(試作品)", ["空想", "技術", "ガラクタ"], 90, "R"],
  ["人魚の鱗", ["空想", "謎", "かわいい"], 60, "C"],
  ["小さな妖精の家", ["空想", "かわいい", "芸術"], 70, "R"],
  ["火星の石", ["宇宙", "自然"], 75, "R"],
  ["ブラックホールの写真(直筆サイン入り)", ["宇宙", "ネタ", "芸術"], 55, "C"],
  ["賢者の石(たぶん偽物)", ["空想", "謎", "ネタ"], 45, "C"],
  ["雲の上の別荘", ["空想", "高級", "自然"], 115, "S"],
  // ガラクタ・ネタ
  ["壊れたテレビ", ["ガラクタ", "ネタ"], 8, "C"],
  ["片方だけの靴下", ["ガラクタ", "ネタ"], 5, "C"],
  ["謎の箱", ["謎", "ネタ"], 40, "C"],
  ["錆びた鍵", ["ガラクタ", "謎"], 15, "C"],
  ["動かないロボット", ["ガラクタ", "技術", "ネタ"], 20, "C"],
  ["10年前の福袋(未開封)", ["ガラクタ", "謎", "ネタ"], 30, "C"],
  ["折れた名刀", ["ガラクタ", "芸術", "謎"], 35, "C"],
  ["空気の缶詰", ["ネタ", "ガラクタ"], 10, "C"],
  ["巨大な段ボール城", ["ガラクタ", "巨大", "芸術"], 25, "C"],
  ["絡まったイヤホン100本", ["ガラクタ", "ネタ", "巨大"], 12, "C"],
  ["前の持ち主の日記", ["ガラクタ", "謎"], 18, "C"],
  ["呪われてそうな人形", ["ガラクタ", "謎", "かわいい"], 22, "C"],
  // 仕事・技術
  ["社長のイス", ["仕事", "高級", "ネタ"], 65, "C"],
  ["最新スマートフォン", ["技術", "定番"], 70, "C"],
  ["自作最強パソコン", ["技術"], 80, "R"],
  ["AIアシスタント執事", ["技術", "空想", "高級"], 95, "R"],
  ["有給休暇1年分", ["仕事", "空想"], 110, "S"],
  ["会議を秒で終わらせる木槌", ["仕事", "ネタ", "謎"], 50, "C"],
  ["伝説のプログラマーのキーボード", ["技術", "仕事", "謎"], 60, "R"],
  ["ロボット掃除機軍団", ["技術", "巨大", "かわいい"], 65, "R"],
  ["空飛ぶドローン便", ["技術", "乗り物"], 55, "C"],
  ["定時退社の魔法", ["仕事", "空想", "ネタ"], 75, "R"],
  // 乗り物・自然・巨大
  ["無人島", ["自然", "巨大", "高級"], 120, "S"],
  ["クラシックカー", ["乗り物", "高級", "芸術"], 90, "R"],
  ["豪華客船クルーズ", ["乗り物", "高級", "巨大"], 100, "S"],
  ["ママチャリ(最強改造済)", ["乗り物", "ネタ", "技術"], 35, "C"],
  ["熱気球", ["乗り物", "自然"], 60, "C"],
  ["私設ロープウェイ", ["乗り物", "巨大", "自然"], 70, "R"],
  ["温泉が湧く庭", ["自然", "高級"], 95, "R"],
  ["樹齢1000年の盆栽", ["自然", "芸術", "謎"], 85, "R"],
  ["満開の桜の山", ["自然", "巨大", "芸術"], 90, "R"],
  ["オーロラ観測小屋", ["自然", "宇宙", "高級"], 80, "R"],
  ["世界一大きいかぼちゃ", ["自然", "巨大", "ネタ"], 40, "C"],
  ["蛍の舞う小川", ["自然", "かわいい"], 55, "C"],
  // 定番・その他
  ["宝くじ(抽選前)", ["謎", "定番"], 50, "C"],
  ["四つ葉のクローバー1万本", ["自然", "巨大", "かわいい"], 45, "C"],
  ["世界地図(未発見の島付き)", ["謎", "冒険", "芸術"], 70, "R"],
  ["等身大の騎士の鎧", ["芸術", "巨大", "ネタ"], 55, "C"],
  ["からくり時計台", ["技術", "芸術", "巨大"], 75, "R"],
  ["王様の冠(レプリカ)", ["高級", "ネタ", "芸術"], 45, "C"],
  ["本物の海賊の宝の地図", ["謎", "冒険", "高級"], 105, "S"],
  ["おばあちゃんの梅干し(50年物)", ["食べ物", "謎", "定番"], 35, "C"],
  ["雪山の山小屋", ["自然", "冒険"], 65, "C"],
  ["熱帯魚の水槽(部屋ごと)", ["動物", "巨大", "高級"], 70, "R"],
  ["世界一周航空券", ["乗り物", "冒険", "高級"], 115, "S"],
  ["静寂(1時間)", ["空想", "ネタ", "謎"], 30, "C"],
  ["雨上がりの虹の写真集", ["自然", "芸術", "かわいい"], 40, "C"],
  ["巨大迷路つきの庭園", ["巨大", "自然", "芸術"], 80, "R"],
  ["秘密基地の設計図", ["冒険", "謎", "かわいい"], 50, "C"],
  ["伝書鳩ネットワーク", ["動物", "技術", "ネタ"], 45, "C"],
  ["未来の新聞(日付だけ見えない)", ["謎", "空想", "ネタ"], 85, "R"],
];

const RARITY_NAME = { C: "コモン", R: "レア", S: "スーパーレア" };
const RARITY_WEIGHT = { C: 6, R: 3, S: 1 };

// ============================================================
// ペルソナ (価値観カード)
//   mult: タグ→倍率 / rarityMult: レア度→倍率 / special
// ============================================================
const PERSONAS = [
  { id: "cat",    name: "動物マニア",     desc: "動物タグ ×3",                       mult: { 動物: 3 } },
  { id: "eater",  name: "食いしん坊",     desc: "食べ物タグ ×2.5",                   mult: { 食べ物: 2.5 } },
  { id: "roman",  name: "ロマンチスト",   desc: "空想・宇宙タグ ×2",                 mult: { 空想: 2, 宇宙: 2 } },
  { id: "real",   name: "現実主義者",     desc: "定番×2 / 空想・ネタ×0.5",           mult: { 定番: 2, 空想: 0.5, ネタ: 0.5 } },
  { id: "junk",   name: "ジャンク収集家", desc: "ガラクタタグ ×5",                   mult: { ガラクタ: 5 } },
  { id: "rich",   name: "成金",           desc: "スーパーレア×2 / コモン×0.5",       mult: {}, rarityMult: { S: 2, C: 0.5 } },
  { id: "mini",   name: "ミニマリスト",   desc: "巨大×0.2 / 最終所持3個以下なら全部×1.5", mult: { 巨大: 0.2 }, special: "mini" },
  { id: "artist", name: "芸術家肌",       desc: "芸術タグ ×3",                       mult: { 芸術: 3 } },
  { id: "advent", name: "冒険家",         desc: "冒険×3 / 自然×2",                   mult: { 冒険: 3, 自然: 2 } },
  { id: "tech",   name: "テック好き",     desc: "技術タグ ×3",                       mult: { 技術: 3 } },
  { id: "big",    name: "でっかい主義",   desc: "巨大タグ ×3",                       mult: { 巨大: 3 } },
  { id: "myst",   name: "ミステリー好き", desc: "謎タグ ×3",                         mult: { 謎: 3 } },
  { id: "cute",   name: "かわいい至上",   desc: "かわいいタグ ×2.5",                 mult: { かわいい: 2.5 } },
  { id: "royal",  name: "高級志向",       desc: "高級タグ ×2.5",                     mult: { 高級: 2.5 } },
];

// ============================================================
// 市場イベント (ニュース)
// ============================================================
const EVENTS = [
  { id: "gourmet", name: "グルメブーム",       desc: "食べ物タグの価値 ×2",                    tagMult: { 食べ物: 2 } },
  { id: "pet",     name: "ペットブーム",       desc: "動物×2・かわいい×1.5",                   tagMult: { 動物: 2, かわいい: 1.5 } },
  { id: "bubble",  name: "バブル景気",         desc: "全商品×2! ただし入札参加費も×2",         allMult: 2, feeMult: 2 },
  { id: "crash",   name: "大不況",             desc: "全商品×0.5・今回の配当なし",             allMult: 0.5, income0: true },
  { id: "inflate", name: "インフレ",           desc: "入札は10G単位のみ(バッティング注意!)",   bidStep: 10 },
  { id: "blackfr", name: "ブラックフライデー", desc: "入札参加費が無料!",                      feeFree: true },
  { id: "dark",    name: "闇オークション",     desc: "入札額は公開されない(落札者のみ発表)",   dark: true },
  { id: "space",   name: "宇宙時代",           desc: "宇宙・空想タグ ×3",                      tagMult: { 宇宙: 3, 空想: 3 } },
  { id: "art",     name: "芸術の秋",           desc: "芸術タグ ×2.5",                          tagMult: { 芸術: 2.5 } },
  { id: "junkre",  name: "ガラクタ再評価",     desc: "ガラクタタグ ×3",                        tagMult: { ガラクタ: 3 } },
  { id: "luxe",    name: "高級品ブーム",       desc: "高級タグ ×2",                            tagMult: { 高級: 2 } },
  { id: "techrev", name: "テック革命",         desc: "技術タグ ×2.5",                          tagMult: { 技術: 2.5 } },
  { id: "calm",    name: "平常運転",           desc: "特に変化なし。静かな市場…",              },
  { id: "eco",     name: "自然回帰",           desc: "自然タグ ×2.5",                          tagMult: { 自然: 2.5 } },
];

const BOT_NAMES = ["たぬき", "きつね", "ふくろう", "うさぎ", "かめ", "りす", "はりねずみ", "あざらし", "ぺんぎん", "こあら",
  "らっこ", "ひつじ", "やぎ", "もぐら", "しまうま", "きりん", "ぱんだ", "こじか", "いるか", "みみずく",
  "おこじょ", "てん", "いたち", "かわうそ", "ももんが", "むささび", "やまね", "とかげ", "ひばり", "つばめ"];

const EMOTES = ["😆", "😱", "🔥", "👏", "🤔", "💰", "🙈", "⚡"];

// ============================================================
// ユーティリティ
// ============================================================
const rid = (n = 8) => crypto.randomBytes(n).toString("hex");
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function weightedItemDeck() {
  // レア度で重み付けした出現デッキ (毎試合シャッフル)
  const deck = [];
  ITEMS_RAW.forEach(([name, tags, base, rarity], idx) => {
    deck.push({ idx, name, tags, base, rarity, w: RARITY_WEIGHT[rarity] });
  });
  // 重み付きシャッフル: w に比例したキーでソート
  return deck
    .map((it) => ({ it, key: Math.pow(Math.random(), 1 / it.w) }))
    .sort((a, b) => b.key - a.key)
    .map((x) => x.it);
}

function laneCountFor(n) {
  if (n <= 6) return 1;
  if (n <= 12) return 2;
  if (n <= 20) return 3;
  if (n <= 26) return 4;
  return 5;
}

// ============================================================
// プレイヤー / ルーム
// ============================================================
let nextPlayerNum = 1;

class Player {
  constructor(name, isBot = false) {
    this.id = "p" + nextPlayerNum++;
    this.token = rid(12);
    this.name = String(name || "名無し").slice(0, 12);
    this.isBot = isBot;
    this.sock = null;          // WSConn (人間のみ)
    this.connected = isBot;    // botは常時接続扱い
    this.money = START_MONEY;
    this.personas = [];        // persona objects
    this.items = [];           // {name, tags, rarity, effBase, round}
    this.bid = null;           // {lane, amount} | "pass" | null
    this.guess = null;         // {target, personaId}
    this.guessHit = false;
  }
}

class Room {
  constructor(code) {
    this.code = code;
    this.players = [];         // Player[]
    this.hostId = null;
    this.phase = "lobby";      // lobby|news|bidding|reveal|payout|guess|final
    this.round = 0;
    this.deck = [];
    this.eventDeck = [];
    this.carryOver = [];       // {item, carryMult}
    this.lanes = [];           // 現ラウンドの出品 [{item, effBase, minBid, carryMult}]
    this.event = null;
    this.timer = null;
    this.deadline = 0;
    this.log = [];
    this.lastActivity = Date.now();
  }
  humanCount() { return this.players.filter((p) => !p.isBot).length; }
  activePlayers() { return this.players; }
  addLog(msg) {
    this.log.push(msg);
    if (this.log.length > 60) this.log.shift();
  }
}

const rooms = new Map(); // code -> Room

function makeRoomCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let c;
  do { c = Array.from({ length: 4 }, () => pick(chars.split(""))).join(""); } while (rooms.has(c));
  return c;
}

// ============================================================
// 価値計算
// ============================================================
function personaMultFor(player, tags, rarity) {
  let m = 1;
  const hits = [];
  for (const pr of player.personas) {
    if (pr.rarityMult && pr.rarityMult[rarity]) {
      m *= pr.rarityMult[rarity];
      hits.push(`${pr.name}:${RARITY_NAME[rarity]}×${pr.rarityMult[rarity]}`);
    }
    for (const tag of tags) {
      if (pr.mult && pr.mult[tag] != null) {
        m *= pr.mult[tag];
        hits.push(`${pr.name}:${tag}×${pr.mult[tag]}`);
      }
    }
  }
  return { m, hits };
}

function marketMultFor(event, tags) {
  let m = event && event.allMult ? event.allMult : 1;
  if (event && event.tagMult) for (const t of tags) if (event.tagMult[t]) m *= event.tagMult[t];
  return m;
}

function collectionMultFor(player, tags) {
  // 所持商品のタグ数: あるタグが3個以上→×1.5 / 5個以上→×2 (該当タグの最大値を採用)
  const counts = {};
  for (const it of player.items) for (const t of it.tags) counts[t] = (counts[t] || 0) + 1;
  let best = 1;
  for (const t of tags) {
    const c = counts[t] || 0;
    if (c >= 5) best = Math.max(best, 2);
    else if (c >= 3) best = Math.max(best, 1.5);
  }
  return best;
}

function finalAssets(player) {
  const isMini = player.personas.some((p) => p.special === "mini");
  const miniBonus = isMini && player.items.length <= 3 && player.items.length > 0 ? 1.5 : 1;
  let itemTotal = 0;
  const detail = [];
  for (const it of player.items) {
    const { m } = personaMultFor(player, it.tags, it.rarity);
    const cm = collectionMultFor(player, it.tags);
    const v = Math.round(it.effBase * m * cm * miniBonus);
    itemTotal += v;
    detail.push({ name: it.name, effBase: it.effBase, persona: m, coll: cm, mini: miniBonus, value: v });
  }
  return { money: player.money, itemTotal, total: player.money + itemTotal, detail, guessHit: player.guessHit };
}

function liveEstimate(player) {
  // 途中順位のぼかし用: 現金 + effBase×ペルソナ倍率
  let t = player.money;
  for (const it of player.items) t += Math.round(it.effBase * personaMultFor(player, it.tags, it.rarity).m);
  return t;
}

// ============================================================
// WebSocket (自前実装・依存ゼロ)
// ============================================================
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

class WSConn {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.fragOp = null;
    this.fragChunks = [];
    this.alive = true;
    this.onmessage = null;
    this.onclose = null;
    socket.on("data", (d) => this._feed(d));
    const bye = () => { if (this.alive) { this.alive = false; this.onclose && this.onclose(); } };
    socket.on("close", bye);
    socket.on("error", bye);
    socket.on("end", bye);
  }
  _feed(data) {
    this.buf = Buffer.concat([this.buf, data]);
    while (true) {
      const f = this._parseOne();
      if (!f) break;
      this._handle(f);
    }
  }
  _parseOne() {
    const b = this.buf;
    if (b.length < 2) return null;
    const fin = (b[0] & 0x80) !== 0;
    const op = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (b.length < 4) return null;
      len = b.readUInt16BE(2); off = 4;
    } else if (len === 127) {
      if (b.length < 10) return null;
      const big = b.readBigUInt64BE(2);
      if (big > 10n * 1024n * 1024n) { this.close(); return null; }
      len = Number(big); off = 10;
    }
    let mask = null;
    if (masked) {
      if (b.length < off + 4) return null;
      mask = b.slice(off, off + 4); off += 4;
    }
    if (b.length < off + len) return null;
    let payload = b.slice(off, off + len);
    this.buf = b.slice(off + len);
    if (mask) {
      const un = Buffer.alloc(len);
      for (let i = 0; i < len; i++) un[i] = payload[i] ^ mask[i % 4];
      payload = un;
    }
    return { fin, op, payload };
  }
  _handle(f) {
    if (f.op === 0x8) { this.close(); return; }             // close
    if (f.op === 0x9) { this._raw(0xA, f.payload); return; } // ping→pong
    if (f.op === 0xA) return;                                // pong
    if (f.op === 0x1 || f.op === 0x2 || f.op === 0x0) {
      if (f.op !== 0x0 && !f.fin) { this.fragOp = f.op; this.fragChunks = [f.payload]; return; }
      if (f.op === 0x0) {
        this.fragChunks.push(f.payload);
        if (!f.fin) return;
        f = { op: this.fragOp, payload: Buffer.concat(this.fragChunks) };
        this.fragOp = null; this.fragChunks = [];
      }
      if (f.op === 0x1 && this.onmessage) {
        let msg = null;
        try { msg = JSON.parse(f.payload.toString("utf8")); } catch { return; }
        this.onmessage(msg);
      }
    }
  }
  _raw(op, payload) {
    if (!this.alive || this.socket.destroyed) return;
    const len = payload.length;
    let head;
    if (len < 126) head = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    try { this.socket.write(Buffer.concat([head, payload])); } catch { /* ignore */ }
  }
  send(obj) { this._raw(0x1, Buffer.from(JSON.stringify(obj), "utf8")); }
  close() {
    if (!this.alive) return;
    this.alive = false;
    try { this._raw(0x8, Buffer.alloc(0)); this.socket.end(); } catch { /* ignore */ }
    this.onclose && this.onclose();
  }
}

// ============================================================
// 送信ヘルパー
// ============================================================
function sendTo(player, obj) {
  if (player.sock && player.connected) player.sock.send(obj);
}
function broadcast(room, obj) {
  for (const p of room.players) sendTo(p, obj);
}
function lobbySnapshot(room) {
  return {
    t: "lobby",
    code: room.code,
    hostId: room.hostId,
    players: room.players.map((p) => ({ id: p.id, name: p.name, isBot: p.isBot, connected: p.connected })),
  };
}
function pushLobby(room) { broadcast(room, lobbySnapshot(room)); }

function tierOf(room, player) {
  const sorted = room.players.slice().sort((a, b) => liveEstimate(b) - liveEstimate(a));
  const i = sorted.indexOf(player);
  const n = sorted.length;
  if (i < Math.ceil(n / 3)) return "トップ集団";
  if (i < Math.ceil((2 * n) / 3)) return "中位グループ";
  return "追走グループ";
}

// ============================================================
// ゲーム進行
// ============================================================
function startGame(room) {
  room.phase = "news";
  room.round = 0;
  room.deck = weightedItemDeck();
  room.eventDeck = shuffle(EVENTS);
  room.carryOver = [];
  room.log = [];
  nextGuard(room);
  for (const p of room.players) {
    p.money = START_MONEY;
    p.items = [];
    p.bid = null;
    p.guess = null;
    p.guessHit = false;
  }
  // ペルソナ配布 (2枚・重複なし)
  for (const p of room.players) {
    const two = shuffle(PERSONAS).slice(0, 2);
    p.personas = two;
    sendTo(p, { t: "personas", personas: two.map((x) => ({ id: x.id, name: x.name, desc: x.desc })) });
  }
  broadcast(room, { t: "gameStart", rounds: TOTAL_ROUNDS, players: room.players.map((p) => ({ id: p.id, name: p.name, isBot: p.isBot })) });
  room.addLog("ゲーム開始! 価値観カードが配られた…");
  setTimeout(() => beginRound(room), 600);
}

function nextGuard(room) {
  if (room.timer) { clearTimeout(room.timer); room.timer = null; }
}

function schedule(room, sec, fn) {
  nextGuard(room);
  room.deadline = Date.now() + sec * 1000;
  room.timer = setTimeout(() => { room.timer = null; fn(); }, sec * 1000);
}

function beginRound(room) {
  room.round++;
  room.phase = "news";
  // イベント決定 (1ラウンド目は穏やかに)
  if (room.round === 1) {
    room.event = EVENTS.find((e) => e.id === "calm");
  } else {
    if (room.eventDeck.length === 0) room.eventDeck = shuffle(EVENTS);
    room.event = room.eventDeck.pop();
    if (room.event.id === "calm" && Math.random() < 0.6 && room.eventDeck.length) room.event = room.eventDeck.pop();
  }
  // レーン構成: 通常レーン + 持ち越し
  const laneN = laneCountFor(room.players.length);
  room.lanes = [];
  for (let i = 0; i < laneN; i++) {
    if (room.deck.length === 0) room.deck = weightedItemDeck();
    const item = room.deck.pop();
    room.lanes.push({ item, carryMult: 1 });
  }
  for (const c of room.carryOver.slice(0, 2)) room.lanes.push(c); // 持ち越しは最大2レーン追加
  room.carryOver = room.carryOver.slice(2);

  // 実効基本値と最低入札額
  for (const lane of room.lanes) {
    const mm = marketMultFor(room.event, lane.item.tags);
    lane.effBase = Math.max(1, Math.round(lane.item.base * mm * lane.carryMult));
    let mb = Math.max(1, Math.ceil(lane.effBase * 0.1));
    if (room.event.bidStep) mb = Math.ceil(mb / room.event.bidStep) * room.event.bidStep;
    lane.minBid = mb;
  }
  const fee = room.event.feeFree ? 0 : Math.round(BASE_FEE * (room.event.feeMult || 1));
  room.fee = fee;
  for (const p of room.players) p.bid = null;

  // 各プレイヤーに自分視点の価値を送信
  for (const p of room.players) {
    const lanesView = room.lanes.map((lane, i) => {
      const pm = personaMultFor(p, lane.item.tags, lane.item.rarity);
      return {
        lane: i,
        name: lane.item.name,
        tags: lane.item.tags,
        rarity: lane.item.rarity,
        rarityName: RARITY_NAME[lane.item.rarity],
        effBase: lane.effBase,
        minBid: lane.minBid,
        carry: lane.carryMult > 1 ? lane.carryMult : null,
        yourValue: Math.round(lane.effBase * pm.m),
        multHits: pm.hits,
      };
    });
    sendTo(p, {
      t: "news",
      round: room.round,
      totalRounds: TOTAL_ROUNDS,
      event: { name: room.event.name, desc: room.event.desc, dark: !!room.event.dark, bidStep: room.event.bidStep || 1 },
      fee,
      lanes: lanesView,
      money: p.money,
      tier: tierOf(room, p),
      newsSec: T.news,
      bidSec: T.bid,
    });
  }
  room.addLog(`R${room.round} ニュース: ${room.event.name}`);
  schedule(room, T.news, () => beginBidding(room));
}

function beginBidding(room) {
  room.phase = "bidding";
  broadcast(room, { t: "bidStart", sec: T.bid });
  // bot入札スケジュール
  for (const p of room.players) {
    if (!p.isBot) continue;
    const delay = (T.botMin + Math.random() * (T.botMax - T.botMin)) * 1000;
    setTimeout(() => botBid(room, p), delay);
  }
  schedule(room, T.bid, () => resolveRound(room));
}

function botBid(room, bot) {
  if (room.phase !== "bidding" || bot.bid != null) return;
  // 各レーンの自分価値を評価し、期待の高いレーンへ低めに入札
  const opts = room.lanes.map((lane, i) => {
    const v = lane.effBase * personaMultFor(bot, lane.item.tags, lane.item.rarity).m;
    return { i, v, lane };
  }).filter((o) => o.v >= o.lane.minBid * 1.1 && bot.money >= o.lane.minBid + room.fee);
  if (opts.length === 0 || Math.random() < 0.15) { bot.bid = "pass"; checkAllBids(room); return; }
  // 価値に比例した重みでレーン選択
  const totalW = opts.reduce((s, o) => s + o.v, 0);
  let r = Math.random() * totalW, chosen = opts[0];
  for (const o of opts) { r -= o.v; if (r <= 0) { chosen = o; break; } }
  const lane = chosen.lane;
  const cap = Math.min(bot.money - room.fee, Math.max(lane.minBid, Math.round(chosen.v * (0.15 + Math.random() * 0.3))));
  let amount = randInt(lane.minBid, Math.max(lane.minBid, cap));
  const step = room.event.bidStep || 1;
  amount = Math.max(lane.minBid, Math.round(amount / step) * step);
  if (amount + room.fee > bot.money) { bot.bid = "pass"; checkAllBids(room); return; }
  bot.bid = { lane: chosen.i, amount };
  checkAllBids(room);
}

function checkAllBids(room) {
  if (room.phase !== "bidding") return;
  const waiting = room.players.filter((p) => p.bid == null && p.connected);
  broadcast(room, { t: "bidCount", done: room.players.length - waiting.length, total: room.players.length });
  if (waiting.length === 0) {
    nextGuard(room);
    setTimeout(() => resolveRound(room), 400);
  }
}

function resolveRound(room) {
  if (room.phase !== "bidding") return;
  room.phase = "reveal";
  const results = [];
  for (let i = 0; i < room.lanes.length; i++) {
    const lane = room.lanes[i];
    const bids = [];
    for (const p of room.players) {
      if (p.bid && p.bid !== "pass" && p.bid.lane === i) bids.push({ p, amount: p.bid.amount });
    }
    // 参加費徴収
    for (const b of bids) b.p.money = Math.max(0, b.p.money - room.fee);
    // 最安ユニーク判定
    const byAmount = new Map();
    for (const b of bids) {
      if (!byAmount.has(b.amount)) byAmount.set(b.amount, []);
      byAmount.get(b.amount).push(b);
    }
    const amounts = [...byAmount.keys()].sort((a, b2) => a - b2);
    let winner = null, price = 0, bustAt = null;
    for (const a of amounts) {
      const g = byAmount.get(a);
      if (g.length === 1) { winner = g[0].p; price = a; break; }
      if (bustAt == null) bustAt = a;
    }
    if (winner) {
      winner.money = Math.max(0, winner.money - price);
      winner.items.push({ name: lane.item.name, tags: lane.item.tags, rarity: lane.item.rarity, effBase: lane.effBase, round: room.round });
      room.addLog(`「${lane.item.name}」→ ${winner.name} が ${price}G で落札!`);
    } else if (bids.length > 0) {
      const nm = Math.min(3, lane.carryMult * 1.5);
      room.carryOver.push({ item: lane.item, carryMult: nm });
      room.addLog(`「${lane.item.name}」全員バッティングで無効! 価値×${nm.toFixed(1)}で持ち越し`);
    } else {
      room.addLog(`「${lane.item.name}」入札なしでお蔵入り…`);
    }
    results.push({
      lane: i,
      name: lane.item.name,
      effBase: lane.effBase,
      carry: lane.carryMult > 1 ? lane.carryMult : null,
      bids: room.event.dark
        ? bids.map((b) => ({ id: b.p.id, name: b.p.name, amount: null }))
        : bids.map((b) => ({ id: b.p.id, name: b.p.name, amount: b.amount })).sort((a, b2) => a.amount - b2.amount),
      winner: winner ? { id: winner.id, name: winner.name } : null,
      price: winner ? price : null,
      bust: !winner && bids.length > 0,
      noBids: bids.length === 0,
    });
  }
  broadcast(room, { t: "reveal", round: room.round, results, dark: !!room.event.dark, sec: T.reveal });
  schedule(room, T.reveal, () => payout(room));
}

function payout(room) {
  room.phase = "payout";
  const income = room.event.income0 ? 0 : BASE_INCOME;
  for (const p of room.players) p.money += income;
  for (const p of room.players) {
    sendTo(p, {
      t: "payout",
      income,
      money: p.money,
      tier: tierOf(room, p),
      items: p.items.map((it) => ({ name: it.name, tags: it.tags })),
      log: room.log.slice(-6),
      sec: T.payout,
    });
  }
  if (room.round >= TOTAL_ROUNDS) {
    schedule(room, T.payout, () => beginGuess(room));
  } else {
    schedule(room, T.payout, () => beginRound(room));
  }
}

function beginGuess(room) {
  room.phase = "guess";
  for (const p of room.players) p.guess = null;
  broadcast(room, {
    t: "guessStart",
    sec: T.guess,
    bonus: GUESS_BONUS,
    players: room.players.map((p) => ({ id: p.id, name: p.name })),
    personas: PERSONAS.map((x) => ({ id: x.id, name: x.name, desc: x.desc })),
  });
  for (const p of room.players) {
    if (!p.isBot) continue;
    setTimeout(() => {
      if (room.phase !== "guess" || p.guess) return;
      const others = room.players.filter((x) => x !== p);
      if (others.length) p.guess = { target: pick(others).id, personaId: pick(PERSONAS).id };
      checkAllGuesses(room);
    }, (T.botMin + Math.random() * (T.botMax - T.botMin)) * 1000);
  }
  schedule(room, T.guess, () => finishGame(room));
}

function checkAllGuesses(room) {
  if (room.phase !== "guess") return;
  const waiting = room.players.filter((p) => p.guess == null && p.connected);
  if (waiting.length === 0) { nextGuard(room); setTimeout(() => finishGame(room), 300); }
}

function finishGame(room) {
  if (room.phase !== "guess") return;
  room.phase = "final";
  // ペルソナ当て判定
  for (const p of room.players) {
    if (!p.guess) continue;
    const target = room.players.find((x) => x.id === p.guess.target);
    if (target && target.personas.some((pr) => pr.id === p.guess.personaId)) {
      p.guessHit = true;
      p.money += GUESS_BONUS;
    }
  }
  const rankings = room.players
    .map((p) => {
      const fa = finalAssets(p);
      return {
        id: p.id, name: p.name, isBot: p.isBot,
        money: fa.money, itemTotal: fa.itemTotal, total: fa.total,
        guessHit: p.guessHit,
        personas: p.personas.map((x) => ({ name: x.name, desc: x.desc })),
        items: fa.detail,
        guess: p.guess
          ? {
              targetName: (room.players.find((x) => x.id === p.guess.target) || {}).name || "?",
              personaName: (PERSONAS.find((x) => x.id === p.guess.personaId) || {}).name || "?",
            }
          : null,
      };
    })
    .sort((a, b) => b.total - a.total);
  broadcast(room, { t: "final", rankings });
  room.addLog(`優勝: ${rankings[0] ? rankings[0].name : "?"}`);
}

function backToLobby(room) {
  nextGuard(room);
  room.phase = "lobby";
  room.round = 0;
  room.carryOver = [];
  pushLobby(room);
}

// ============================================================
// メッセージ処理
// ============================================================
function handleMessage(conn, state, msg) {
  const type = msg && msg.t;
  if (type === "hello") return handleHello(conn, state, msg);
  const room = state.room, player = state.player;
  if (!room || !player) return;
  room.lastActivity = Date.now();

  switch (type) {
    case "addBot": {
      if (player.id !== room.hostId || room.phase !== "lobby") return;
      if (room.players.length >= MAX_PLAYERS) return conn.send({ t: "error", msg: "満員です(最大30人)" });
      const used = new Set(room.players.map((p) => p.name));
      const name = BOT_NAMES.find((n) => !used.has("🤖" + n)) || "ボット" + rid(2);
      const bot = new Player("🤖" + name, true);
      room.players.push(bot);
      pushLobby(room);
      break;
    }
    case "removeBot": {
      if (player.id !== room.hostId || room.phase !== "lobby") return;
      const i = room.players.findLastIndex((p) => p.isBot);
      if (i >= 0) room.players.splice(i, 1);
      pushLobby(room);
      break;
    }
    case "start": {
      if (player.id !== room.hostId || room.phase !== "lobby") return;
      if (room.players.length < 2) return conn.send({ t: "error", msg: "2人以上必要です(AIプレイヤー追加もできます)" });
      startGame(room);
      break;
    }
    case "bid": {
      if (room.phase !== "bidding" || player.bid != null) return;
      const lane = room.lanes[msg.lane];
      if (!lane) return;
      let amount = Math.floor(Number(msg.amount));
      if (!Number.isFinite(amount)) return;
      const step = room.event.bidStep || 1;
      if (amount % step !== 0) return conn.send({ t: "error", msg: `このラウンドは${step}G単位です` });
      if (amount < lane.minBid) return conn.send({ t: "error", msg: `最低入札額は${lane.minBid}Gです` });
      if (amount + room.fee > player.money) return conn.send({ t: "error", msg: "所持金が足りません(参加費込み)" });
      player.bid = { lane: msg.lane, amount };
      conn.send({ t: "bidAck", lane: msg.lane, amount });
      checkAllBids(room);
      break;
    }
    case "pass": {
      if (room.phase !== "bidding" || player.bid != null) return;
      player.bid = "pass";
      conn.send({ t: "bidAck", pass: true });
      checkAllBids(room);
      break;
    }
    case "guess": {
      if (room.phase !== "guess" || player.guess != null) return;
      if (msg.skip) { player.guess = { target: null, personaId: null }; }
      else {
        if (msg.target === player.id) return conn.send({ t: "error", msg: "自分は指名できません" });
        player.guess = { target: String(msg.target || ""), personaId: String(msg.personaId || "") };
      }
      conn.send({ t: "guessAck" });
      checkAllGuesses(room);
      break;
    }
    case "emote": {
      const e = String(msg.e || "");
      if (!EMOTES.includes(e)) return;
      broadcast(room, { t: "emote", id: player.id, name: player.name, e });
      break;
    }
    case "again": {
      if (player.id !== room.hostId || room.phase !== "final") return;
      backToLobby(room);
      break;
    }
  }
}

function handleHello(conn, state, msg) {
  const name = String(msg.name || "").trim().slice(0, 12);
  // 再接続 (token)
  if (msg.token) {
    for (const room of rooms.values()) {
      const p = room.players.find((x) => x.token === msg.token);
      if (p) {
        if (p.sock && p.sock.alive) p.sock.close();
        p.sock = conn; p.connected = true;
        state.room = room; state.player = p;
        conn.send({ t: "welcome", token: p.token, code: room.code, youId: p.id, name: p.name, rejoined: true });
        if (room.phase === "lobby") conn.send(lobbySnapshot(room));
        else {
          conn.send({ t: "personas", personas: p.personas.map((x) => ({ id: x.id, name: x.name, desc: x.desc })) });
          conn.send({ t: "resync", phase: room.phase, round: room.round, money: p.money, msg: "再接続しました。次のラウンドから参加できます" });
        }
        pushLobby(room);
        return;
      }
    }
    // token無効→新規として続行
  }
  if (!name) return conn.send({ t: "error", msg: "名前を入力してください" });

  let room;
  if (msg.create) {
    room = new Room(makeRoomCode());
    rooms.set(room.code, room);
  } else {
    room = rooms.get(String(msg.room || "").toUpperCase());
    if (!room) return conn.send({ t: "error", msg: "その合言葉のルームが見つかりません" });
    if (room.phase !== "lobby") return conn.send({ t: "error", msg: "ゲーム進行中のため参加できません" });
    if (room.players.length >= MAX_PLAYERS) return conn.send({ t: "error", msg: "満員です(最大30人)" });
  }
  const player = new Player(name, false);
  player.sock = conn; player.connected = true;
  room.players.push(player);
  if (!room.hostId) room.hostId = player.id;
  state.room = room; state.player = player;
  conn.send({ t: "welcome", token: player.token, code: room.code, youId: player.id, name: player.name });
  pushLobby(room);
}

function handleDisconnect(state) {
  const room = state.room, player = state.player;
  if (!room || !player) return;
  player.connected = false;
  player.sock = null;
  if (room.phase === "lobby") {
    room.players = room.players.filter((p) => p !== player);
    if (room.hostId === player.id) {
      const nh = room.players.find((p) => !p.isBot);
      room.hostId = nh ? nh.id : null;
    }
    if (room.players.every((p) => p.isBot)) rooms.delete(room.code);
    else pushLobby(room);
  } else {
    // ゲーム中は自動パス扱い (再接続可)
    if (room.phase === "bidding" && player.bid == null) { player.bid = "pass"; checkAllBids(room); }
    if (room.phase === "guess" && player.guess == null) { player.guess = { target: null, personaId: null }; checkAllGuesses(room); }
    if (room.humanCount() === 0 || room.players.every((p) => p.isBot || !p.connected)) {
      // 人間が全員落ちたらルーム破棄 (5分猶予)
      setTimeout(() => {
        if (room.players.every((p) => p.isBot || !p.connected)) { nextGuard(room); rooms.delete(room.code); }
      }, 5 * 60 * 1000);
    }
    pushLobby(room);
  }
}

// 古いルームの掃除
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.lastActivity > 60 * 60 * 1000) { nextGuard(room); rooms.delete(code); }
  }
}, 10 * 60 * 1000);

// ============================================================
// HTTP + WebSocketサーバー
// ============================================================
const INDEX_PATH = path.join(__dirname, "public", "index.html");

const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    fs.readFile(INDEX_PATH, (err, data) => {
      if (err) { res.writeHead(500); res.end("index.html not found"); return; }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(data);
    });
  } else if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
  } else {
    res.writeHead(404); res.end("not found");
  }
});

server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  if (!key || (req.headers["upgrade"] || "").toLowerCase() !== "websocket") {
    socket.destroy(); return;
  }
  const accept = crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n` +
    "\r\n"
  );
  socket.setNoDelay(true);
  const conn = new WSConn(socket);
  const state = { room: null, player: null };
  conn.onmessage = (msg) => {
    try { handleMessage(conn, state, msg); }
    catch (e) { console.error("handleMessage error:", e); }
  };
  conn.onclose = () => handleDisconnect(state);
});

server.listen(PORT, () => {
  console.log("========================================");
  console.log("  ネウチ！ サーバー起動");
  console.log(`  http://localhost:${PORT}`);
  console.log("  同じネットワークの人は http://<このPCのIP>:" + PORT);
  console.log("========================================");
});

module.exports = { server, rooms }; // テスト用
