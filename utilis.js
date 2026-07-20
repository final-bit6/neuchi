"use strict";
const crypto = require("crypto");
const { RARITY_WEIGHT, ITEMS_RAW } = require("./data");

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
  const deck = [];
  ITEMS_RAW.forEach(([name, tags, base, rarity], idx) => {
    deck.push({ idx, name, tags, base, rarity, w: RARITY_WEIGHT[rarity] });
  });
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

module.exports = { rid, randInt, pick, shuffle, weightedItemDeck, laneCountFor };
