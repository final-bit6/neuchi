"use strict";
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const config = require("./config");
const data = require("./data");
const utils = require("./utils");
const { Player, Room, personaMultFor, marketMultFor, finalAssets, tierOf } = require("./gameLogic");
const { WSConn } = require("./wsServer");

const rooms = new Map();

function makeRoomCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let c;
  do { c = Array.from({ length: 4 }, () => utils.pick(chars.split(""))).join(""); } while (rooms.has(c));
  return c;
}

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

function startGame(room) {
  room.phase = "news";
  room.round = 0;
  room.deck = utils.weightedItemDeck();
  room.eventDeck = utils.shuffle(data.EVENTS);
  room.carryOver = [];
  room.log = [];
  nextGuard(room);
  for (const p of room.players) {
    p.money = config.START_MONEY;
    p.items = [];
    p.bid = null;
    p.guess = null;
    p.guessHit = false;
  }
  for (const p of room.players) {
    const two = utils.shuffle(data.PERSONAS).slice(0, 2);
    p.personas = two;
    sendTo(p, { t: "personas", personas: two.map((x) => ({ id: x.id, name: x.name, desc: x.desc })) });
  }
  broadcast(room, { t: "gameStart", rounds: config.TOTAL_ROUNDS, players: room.players.map((p) => ({ id: p.id, name: p.name, isBot: p.isBot })) });
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
  if (room.round === 1) {
    room.event = data.EVENTS.find((e) => e.id === "calm");
  } else {
    if (room.eventDeck.length === 0) room.eventDeck = utils.shuffle(data.EVENTS);
    room.event = room.eventDeck.pop();
    if (room.event.id === "calm" && Math.random() < 0.6 && room.eventDeck.length) room.event = room.eventDeck.pop();
  }
  const laneN = utils.laneCountFor(room.players.length);
  room.lanes = [];
  for (let i = 0; i < laneN; i++) {
    if (room.deck.length === 0) room.deck = utils.weightedItemDeck();
    const item = room.deck.pop();
    room.lanes.push({ item, carryMult: 1 });
  }
  for (const c of room.carryOver.slice(0, 2)) room.lanes.push(c);
  room.carryOver = room.carryOver.slice(2);

  for (const lane of room.lanes) {
    const mm = marketMultFor(room.event, lane.item.tags);
    lane.effBase = Math.max(1, Math.round(lane.item.base * mm * lane.carryMult));
    let mb = Math.max(1, Math.ceil(lane.effBase * 0.1));
    if (room.event.bidStep) mb = Math.ceil(mb / room.event.bidStep) * room.event.bidStep;
    lane.minBid = mb;
  }
  const fee = room.event.feeFree ? 0 : Math.round(config.BASE_FEE * (room.event.feeMult || 1));
  room.fee = fee;
  for (const p of room.players) p.bid = null;

  for (const p of room.players) {
    const lanesView = room.lanes.map((lane, i) => {
      const pm = personaMultFor(p, lane.item.tags, lane.item.rarity);
      return {
        lane: i,
        name: lane.item.name,
        tags: lane.item.tags,
        rarity: lane.item.rarity,
        rarityName: data.RARITY_NAME[lane.item.rarity],
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
      totalRounds: config.TOTAL_ROUNDS,
      event: { name: room.event.name, desc: room.event.desc, dark: !!room.event.dark, bidStep: room.event.bidStep || 1 },
      fee,
      lanes: lanesView,
      money: p.money,
      tier: tierOf(room, p),
      newsSec: config.T.news,
      bidSec: config.T.bid,
    });
  }
  room.addLog(`R${room.round} ニュース: ${room.event.name}`);
  schedule(room, config.T.news, () => beginBidding(room));
}

function beginBidding(room) {
  room.phase = "bidding";
  broadcast(room, { t: "bidStart", sec: config.T.bid });
  for (const p of room.players) {
    if (!p.isBot) continue;
    const delay = (config.T.botMin + Math.random() * (config.T.botMax - config.T.botMin)) * 1000;
    setTimeout(() => botBid(room, p), delay);
  }
  schedule(room, config.T.bid, () => resolveRound(room));
}

function botBid(room, bot) {
  if (room.phase !== "bidding" || bot.bid != null) return;
  const opts = room.lanes.map((lane, i) => {
    const v = lane.effBase * personaMultFor(bot, lane.item.tags, lane.item.rarity).m;
    return { i, v, lane };
  }).filter((o) => o.v >= o.lane.minBid * 1.1 && bot.money >= o.lane.minBid + room.fee);
  if (opts.length === 0 || Math.random() < 0.15) { bot.bid = "pass"; checkAllBids(room); return; }
  const totalW = opts.reduce((s, o) => s + o.v, 0);
  let r = Math.random() * totalW, chosen = opts[0];
  for (const o of opts) { r -= o.v; if (r <= 0) { chosen = o; break; } }
  const lane = chosen.lane;
  const cap = Math.min(bot.money - room.fee, Math.max(lane.minBid, Math.round(chosen.v * (0.15 + Math.random() * 0.3))));
  let amount = utils.randInt(lane.minBid, Math.max(lane.minBid, cap));
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
    for (const b of bids) b.p.money = Math.max(0, b.p.money - room.fee);
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
  broadcast(room, { t: "reveal", round: room.round, results, dark: !!room.event.dark, sec: config.T.reveal });
  schedule(room, config.T.reveal, () => payout(room));
}

function payout(room) {
  room.phase = "payout";
  const income = room.event.income0 ? 0 : config.BASE_INCOME;
  for (const p of room.players) p.money += income;
  for (const p of room.players) {
    sendTo(p, {
      t: "payout",
      income,
      money: p.money,
      tier: tierOf(room, p),
      items: p.items.map((it) => ({ name: it.name, tags: it.tags })),
      log: room.log.slice(-6),
      sec: config.T.payout,
    });
  }
  if (room.round >= config.TOTAL_ROUNDS) {
    schedule(room, config.T.payout, () => beginGuess(room));
  } else {
    schedule(room, config.T.payout, () => beginRound(room));
  }
}

function beginGuess(room) {
  room.phase = "guess";
  for (const p of room.players) p.guess = null;
  broadcast(room, {
    t: "guessStart",
    sec: config.T.guess,
    bonus: config.GUESS_BONUS,
    players: room.players.map((p) => ({ id: p.id, name: p.name })),
    personas: data.PERSONAS.map((x) => ({ id: x.id, name: x.name, desc: x.desc })),
  });
  for (const p of room.players) {
    if (!p.isBot) continue;
    setTimeout(() => {
      if (room.phase !== "guess" || p.guess) return;
      const others = room.players.filter((x) => x !== p);
      if (others.length) p.guess = { target: utils.pick(others).id, personaId: utils.pick(data.PERSONAS).id };
      checkAllGuesses(room);
    }, (config.T.botMin + Math.random() * (config.T.botMax - config.T.botMin)) * 1000);
  }
  schedule(room, config.T.guess, () => finishGame(room));
}

function checkAllGuesses(room) {
  if (room.phase !== "guess") return;
  const waiting = room.players.filter((p) => p.guess == null && p.connected);
  if (waiting.length === 0) { nextGuard(room); setTimeout(() => finishGame(room), 300); }
}

function finishGame(room) {
  if (room.phase !== "guess") return;
  room.phase = "final";
  for (const p of room.players) {
    if (!p.guess) continue;
    const target = room.players.find((x) => x.id === p.guess.target);
    if (target && target.personas.some((pr) => pr.id === p.guess.personaId)) {
      p.guessHit = true;
      p.money += config.GUESS_BONUS;
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
              personaName: (data.PERSONAS.find((x) => x.id === p.guess.personaId) || {}).name || "?",
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

function handleMessage(conn, state, msg) {
  const type = msg && msg.t;
  if (type === "hello") return handleHello(conn, state, msg);
  const room = state.room, player = state.player;
  if (!room || !player) return;
  room.lastActivity = Date.now();

  switch (type) {
    case "addBot": {
      if (player.id !== room.hostId || room.phase !== "lobby") return;
      if (room.players.length >= config.MAX_PLAYERS) return conn.send({ t: "error", msg: "満員です(最大30人)" });
      const used = new Set(room.players.map((p) => p.name));
      const name = data.BOT_NAMES.find((n) => !used.has("🤖" + n)) || "ボット" + utils.rid(2);
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
      if (!data.EMOTES.includes(e)) return;
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
    if (room.players.length >= config.MAX_PLAYERS) return conn.send({ t: "error", msg: "満員です(最大30人)" });
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
    if (room.phase === "bidding" && player.bid == null) { player.bid = "pass"; checkAllBids(room); }
    if (room.phase === "guess" && player.guess == null) { player.guess = { target: null, personaId: null }; checkAllGuesses(room); }
    if (room.humanCount() === 0 || room.players.every((p) => p.isBot || !p.connected)) {
      setTimeout(() => {
        if (room.players.every((p) => p.isBot || !p.connected)) { nextGuard(room); rooms.delete(room.code); }
      }, 5 * 60 * 1000);
    }
    pushLobby(room);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.lastActivity > 60 * 60 * 1000) { nextGuard(room); rooms.delete(code); }
  }
}, 10 * 60 * 1000);

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
  const accept = crypto.createHash("sha1").update(key + config.WS_GUID).digest("base64");
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

server.listen(config.PORT, () => {
  console.log(`Server running on port ${config.PORT}`);
});

module.exports = { server, rooms };
