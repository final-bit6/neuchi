"use strict";
const config = require("./config");
const data = require("./data");
const utils = require("./utils");

let nextPlayerNum = 1;

class Player {
  constructor(name, isBot = false) {
    this.id = "p" + nextPlayerNum++;
    this.token = utils.rid(12);
    this.name = String(name || "名無し").slice(0, 12);
    this.isBot = isBot;
    this.sock = null;
    this.connected = isBot;
    this.money = config.START_MONEY;
    this.personas = [];
    this.items = [];
    this.bid = null;
    this.guess = null;
    this.guessHit = false;
  }
}

class Room {
  constructor(code) {
    this.code = code;
    this.players = [];
    this.hostId = null;
    this.phase = "lobby";
    this.round = 0;
    this.deck = [];
    this.eventDeck = [];
    this.carryOver = [];
    this.lanes = [];
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

// 価値計算などのコア関数群
function personaMultFor(player, tags, rarity) {
  let m = 1;
  const hits = [];
  for (const pr of player.personas) {
    if (pr.rarityMult && pr.rarityMult[rarity]) {
      m *= pr.rarityMult[rarity];
      hits.push(`${pr.name}:${data.RARITY_NAME[rarity]}×${pr.rarityMult[rarity]}`);
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
  let t = player.money;
  for (const it of player.items) t += Math.round(it.effBase * personaMultFor(player, it.tags, it.rarity).m);
  return t;
}

function tierOf(room, player) {
  const sorted = room.players.slice().sort((a, b) => liveEstimate(b) - liveEstimate(a));
  const i = sorted.indexOf(player);
  const n = sorted.length;
  if (i < Math.ceil(n / 3)) return "トップ集団";
  if (i < Math.ceil((2 * n) / 3)) return "中位グループ";
  return "追走グループ";
}

module.exports = {
  Player, Room, personaMultFor, marketMultFor, finalAssets, tierOf
};
