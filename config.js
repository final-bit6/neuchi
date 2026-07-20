"use strict";

const SPEED = process.env.SPEED || "normal";

// タイマー設定 (秒)
const T = SPEED === "fast"
  ? { news: 0.2, bid: 1.2, reveal: 0.3, payout: 0.2, guess: 1.0, botMin: 0.05, botMax: 0.6 }
  : { news: 7, bid: 30, reveal: 9, payout: 4, guess: 30, botMin: 3, botMax: 20 };

module.exports = {
  PORT: Number(process.env.PORT || 3000),
  T,
  TOTAL_ROUNDS: Number(process.env.ROUNDS || 10),
  START_MONEY: 1000,
  BASE_FEE: 5,
  BASE_INCOME: 10,
  GUESS_BONUS: 100,
  MAX_PLAYERS: 30,
  WS_GUID: "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
};
