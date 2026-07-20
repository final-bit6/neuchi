"use strict";
const Buffer = require("buffer").Buffer;
const config = require("./config");

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
    if (f.op === 0x8) { this.close(); return; }
    if (f.op === 0x9) { this._raw(0xA, f.payload); return; }
    if (f.op === 0xA) return;
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

module.exports = { WSConn };
