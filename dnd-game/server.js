// D20 Tavern — multiplayer D20 tabletop RPG server.
// All dice are rolled on the server so nobody can fake a roll.
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

const server = http.createServer(app);
const io = new Server(server);

// ---------- Rule presets ("game modes") ----------
const PRESETS = {
  classic: {
    label: 'D&D คลาสสิก',
    statMode: 'score', // stat score 1-30, modifier = floor((score-10)/2)
    stats: ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'],
    defaultStat: 10,
    defaultHp: 12,
  },
  simple: {
    label: 'D20 แบบง่าย',
    statMode: 'none', // no stats; DM gives bonuses per action
    stats: [],
    defaultStat: 0,
    defaultHp: 10,
  },
  custom: {
    label: 'กำหนดเอง',
    statMode: 'direct', // stat value IS the modifier
    stats: ['พลัง', 'ความไว', 'สมอง', 'เสน่ห์'],
    defaultStat: 0,
    defaultHp: 10,
  },
};

const THEMES = ['แฟนตาซี', 'ไซไฟ', 'สยองขวัญ', 'โลกปัจจุบัน', 'ไซเบอร์พังก์', 'อื่นๆ'];

const rooms = new Map();
const LIMITS = { name: 40, text: 600, scene: 2000, log: 300 };

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const int = (v, min, max, def) => {
  const x = Number.parseInt(v, 10);
  if (Number.isNaN(x)) return def;
  return Math.max(min, Math.min(max, x));
};
const uid = () => crypto.randomBytes(8).toString('hex');
const d = (sides) => crypto.randomInt(1, sides + 1);

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 5 }, () => A[crypto.randomInt(A.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function defaultSettings(presetKey = 'classic') {
  const p = PRESETS[presetKey] || PRESETS.classic;
  return {
    preset: PRESETS[presetKey] ? presetKey : 'classic',
    theme: THEMES[0],
    statMode: p.statMode,
    stats: [...p.stats],
    defaultDC: 12,
    critRules: true, // nat 20 = critical success, nat 1 = critical failure
    allowAdvantage: true,
    requireApproval: true, // DM must approve every action before a roll
    playersCanFreeRoll: true,
    houseRules: '',
  };
}

function newCharacter(room, name) {
  const s = room.settings;
  const p = PRESETS[s.preset] || PRESETS.classic;
  const stats = {};
  for (const k of s.stats) stats[k] = s.statMode === 'score' ? 10 : 0;
  return { name, cls: '', hp: p.defaultHp, maxHp: p.defaultHp, stats, notes: '', inventory: '' };
}

function statMod(room, player, stat) {
  if (!stat || !player?.char) return 0;
  const v = player.char.stats?.[stat];
  if (v === undefined) return 0;
  return room.settings.statMode === 'score' ? Math.floor((v - 10) / 2) : v;
}

function addLog(room, entry) {
  room.log.push({ id: uid(), ts: Date.now(), visibility: 'all', ...entry });
  if (room.log.length > LIMITS.log) room.log.splice(0, room.log.length - LIMITS.log);
}

// ---------- Per-viewer state (hides DM-only info from players) ----------
function viewFor(room, viewerId) {
  const isDM = viewerId === room.dmId;
  const visible = (e) =>
    isDM || e.visibility === 'all' || (e.visibility === 'self' && e.playerId === viewerId);
  return {
    code: room.code,
    you: viewerId,
    isDM,
    dmId: room.dmId,
    settings: room.settings,
    presets: Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, v.label])),
    themes: THEMES,
    scene: room.scene,
    players: Object.values(room.players).map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      isDM: p.id === room.dmId,
      char: p.char,
    })),
    actions: room.actions
      .filter((a) => isDM || a.playerId === viewerId || a.status !== 'pending')
      .map((a) => (!isDM && a.hiddenDC && a.status === 'approved' ? { ...a, dc: null } : a)),
    questions: room.questions.filter((q) => isDM || q.public || q.playerId === viewerId),
    log: room.log.filter(visible),
  };
}

function broadcast(room) {
  for (const p of Object.values(room.players)) {
    if (p.socketId) io.to(p.socketId).emit('state', viewFor(room, p.id));
  }
}

// ---------- Dice ----------
function rollDice({ sides, count = 1, mod = 0, mode = 'normal' }) {
  sides = int(sides, 2, 100, 20);
  count = int(count, 1, 20, 1);
  mod = int(mod, -50, 50, 0);
  if (sides === 20 && count === 1 && (mode === 'adv' || mode === 'dis')) {
    const a = d(20);
    const b = d(20);
    const kept = mode === 'adv' ? Math.max(a, b) : Math.min(a, b);
    return { sides, count, mod, mode, dice: [a, b], kept, natural: kept, total: kept + mod };
  }
  const dice = Array.from({ length: count }, () => d(sides));
  const sum = dice.reduce((x, y) => x + y, 0);
  return { sides, count, mod, mode: 'normal', dice, kept: sum, natural: count === 1 ? dice[0] : null, total: sum + mod };
}

function judge(room, roll, dc) {
  if (room.settings.critRules && roll.sides === 20 && roll.natural === 20) return 'crit_success';
  if (room.settings.critRules && roll.sides === 20 && roll.natural === 1) return 'crit_fail';
  return roll.total >= dc ? 'success' : 'fail';
}

// ---------- Socket handlers ----------
io.on('connection', (socket) => {
  let room = null;
  let me = null;

  const fail = (msg) => socket.emit('toast', { type: 'error', msg });
  const isDM = () => room && me && room.dmId === me.id;
  const guard = (needDM, fn) => (payload = {}, ack) => {
    try {
      if (!room || !me) return fail('ยังไม่ได้เข้าห้อง');
      if (needDM && !isDM()) return fail('คำสั่งนี้สำหรับ DM เท่านั้น');
      fn(payload || {});
      broadcast(room);
      if (typeof ack === 'function') ack({ ok: true });
    } catch (err) {
      console.error(err);
      fail('เกิดข้อผิดพลาด');
    }
  };

  function attach(r, player) {
    if (room && me && room !== r) leave();
    room = r;
    me = player;
    player.socketId = socket.id;
    player.connected = true;
    socket.join(r.code);
  }

  function leave() {
    if (!room || !me) return;
    if (me.socketId === socket.id) {
      me.connected = false;
      me.socketId = null;
    }
    broadcast(room);
  }

  socket.on('create_room', (payload = {}, ack) => {
    const name = clip(payload.name, LIMITS.name) || 'DM';
    const playerId = clip(payload.playerId, 32) || uid();
    const code = newCode();
    const r = {
      code,
      dmId: playerId,
      createdAt: Date.now(),
      settings: defaultSettings(payload.preset),
      scene: { title: 'บทนำ', text: 'DM กำลังเตรียมฉากแรก...' },
      players: {},
      actions: [],
      questions: [],
      log: [],
    };
    rooms.set(code, r);
    const p = { id: playerId, name, connected: true, socketId: null, char: null };
    r.players[playerId] = p;
    attach(r, p);
    addLog(r, { kind: 'system', text: `${name} สร้างห้องและเป็น DM` });
    broadcast(r);
    if (typeof ack === 'function') ack({ ok: true, code, playerId });
  });

  socket.on('join_room', (payload = {}, ack) => {
    const code = clip(payload.code, 8).toUpperCase();
    const r = rooms.get(code);
    if (!r) return typeof ack === 'function' && ack({ ok: false, msg: 'ไม่พบห้องนี้' });
    const playerId = clip(payload.playerId, 32) || uid();
    let p = r.players[playerId];
    const name = clip(payload.name, LIMITS.name) || p?.name || 'นักผจญภัย';
    if (!p) {
      if (Object.keys(r.players).length >= 12) return typeof ack === 'function' && ack({ ok: false, msg: 'ห้องเต็มแล้ว (12 คน)' });
      p = { id: playerId, name, connected: true, socketId: null, char: newCharacter(r, name) };
      r.players[playerId] = p;
      addLog(r, { kind: 'system', text: `${name} เข้าร่วมการผจญภัย` });
    } else {
      p.name = name;
    }
    attach(r, p);
    broadcast(r);
    if (typeof ack === 'function') ack({ ok: true, code, playerId });
  });

  socket.on('leave_room', () => {
    leave();
    if (room) socket.leave(room.code);
    room = null;
    me = null;
  });

  // ----- DM: rules / scene -----
  socket.on('update_settings', guard(true, (p) => {
    const s = room.settings;
    if (p.preset && PRESETS[p.preset] && p.preset !== s.preset) {
      const fresh = defaultSettings(p.preset);
      Object.assign(s, { preset: fresh.preset, statMode: fresh.statMode, stats: fresh.stats });
      for (const pl of Object.values(room.players)) {
        if (!pl.char) continue;
        const stats = {};
        for (const k of s.stats) stats[k] = s.statMode === 'score' ? 10 : 0;
        pl.char.stats = stats;
      }
      addLog(room, { kind: 'system', text: `DM เปลี่ยนรูปแบบเกมเป็น "${PRESETS[s.preset].label}"` });
    }
    if (Array.isArray(p.stats) && s.preset === 'custom') {
      const names = [...new Set(p.stats.map((x) => clip(x, 16)).filter(Boolean))].slice(0, 8);
      if (names.length) {
        s.stats = names;
        for (const pl of Object.values(room.players)) {
          if (!pl.char) continue;
          const stats = {};
          for (const k of names) stats[k] = pl.char.stats?.[k] ?? 0;
          pl.char.stats = stats;
        }
      }
    }
    if (p.theme !== undefined) s.theme = clip(p.theme, 30) || s.theme;
    if (p.defaultDC !== undefined) s.defaultDC = int(p.defaultDC, 1, 40, s.defaultDC);
    for (const k of ['critRules', 'allowAdvantage', 'requireApproval', 'playersCanFreeRoll']) {
      if (typeof p[k] === 'boolean') s[k] = p[k];
    }
    if (p.houseRules !== undefined) s.houseRules = clip(p.houseRules, LIMITS.scene);
  }));

  socket.on('set_scene', guard(true, (p) => {
    room.scene = { title: clip(p.title, 80) || 'ฉากใหม่', text: clip(p.text, LIMITS.scene) };
    addLog(room, { kind: 'scene', title: room.scene.title, text: room.scene.text });
  }));

  socket.on('narrate', guard(true, (p) => {
    const text = clip(p.text, LIMITS.text);
    if (text) addLog(room, { kind: 'narrate', text });
  }));

  socket.on('dm_hp', guard(true, (p) => {
    const target = room.players[p.playerId];
    if (!target?.char) return;
    const delta = int(p.delta, -999, 999, 0);
    target.char.hp = Math.max(0, Math.min(target.char.maxHp, target.char.hp + delta));
    addLog(room, {
      kind: 'system',
      text: `${target.char.name || target.name} ${delta < 0 ? 'เสีย' : 'ฟื้น'} HP ${Math.abs(delta)} (เหลือ ${target.char.hp}/${target.char.maxHp})`,
    });
  }));

  socket.on('kick', guard(true, (p) => {
    const target = room.players[p.playerId];
    if (!target || target.id === room.dmId) return;
    if (target.socketId) io.to(target.socketId).emit('kicked');
    delete room.players[target.id];
    addLog(room, { kind: 'system', text: `${target.name} ถูกเชิญออกจากห้อง` });
  }));

  // ----- Characters -----
  socket.on('update_char', guard(false, (p) => {
    const target = isDM() && p.playerId ? room.players[p.playerId] : me;
    if (!target) return;
    if (!target.char) target.char = newCharacter(room, target.name);
    const c = target.char;
    if (p.name !== undefined) c.name = clip(p.name, LIMITS.name);
    if (p.cls !== undefined) c.cls = clip(p.cls, LIMITS.name);
    if (p.notes !== undefined) c.notes = clip(p.notes, LIMITS.scene);
    if (p.inventory !== undefined) c.inventory = clip(p.inventory, LIMITS.scene);
    if (p.maxHp !== undefined) c.maxHp = int(p.maxHp, 1, 999, c.maxHp);
    if (p.hp !== undefined) c.hp = int(p.hp, 0, c.maxHp, c.hp);
    c.hp = Math.min(c.hp, c.maxHp);
    if (p.stats && typeof p.stats === 'object') {
      const [lo, hi] = room.settings.statMode === 'score' ? [1, 30] : [-5, 10];
      for (const k of room.settings.stats) {
        if (p.stats[k] !== undefined) c.stats[k] = int(p.stats[k], lo, hi, c.stats[k]);
      }
    }
  }));

  // ----- Action flow: declare -> DM review -> roll -> DM narrates -----
  socket.on('submit_action', guard(false, (p) => {
    const text = clip(p.text, LIMITS.text);
    if (!text) return fail('พิมพ์สิ่งที่อยากทำก่อน');
    if (isDM()) return fail('DM ใช้ "บรรยาย" แทนนะ');
    const pendingMine = room.actions.filter((a) => a.playerId === me.id && ['pending', 'approved'].includes(a.status));
    if (pendingMine.length >= 3) return fail('มีการกระทำค้างอยู่ 3 อย่างแล้ว รอ DM ก่อน');
    const stat = room.settings.stats.includes(p.stat) ? p.stat : '';
    const action = {
      id: uid(),
      playerId: me.id,
      playerName: me.char?.name || me.name,
      text,
      stat,
      status: 'pending',
      createdAt: Date.now(),
    };
    if (!room.settings.requireApproval) {
      Object.assign(action, { status: 'approved', dc: room.settings.defaultDC, mode: 'normal', bonus: 0 });
    }
    room.actions.push(action);
    if (room.actions.length > 100) room.actions.splice(0, room.actions.length - 100);
    addLog(room, { kind: 'declare', playerId: me.id, name: action.playerName, text });
  }));

  socket.on('review_action', guard(true, (p) => {
    const a = room.actions.find((x) => x.id === p.actionId);
    if (!a || a.status !== 'pending') return;
    const note = clip(p.note, LIMITS.text);
    if (p.decision === 'deny') {
      a.status = 'denied';
      a.note = note || 'ทำแบบนั้นไม่ได้ในสถานการณ์นี้';
      addLog(room, { kind: 'deny', name: a.playerName, text: a.text, note: a.note });
    } else if (p.decision === 'auto') {
      a.status = 'resolved';
      a.outcome = 'auto';
      a.note = note;
      addLog(room, { kind: 'auto', name: a.playerName, text: a.text, note });
    } else {
      a.status = 'approved';
      a.dc = int(p.dc, 1, 40, room.settings.defaultDC);
      a.stat = room.settings.stats.includes(p.stat) ? p.stat : a.stat;
      a.mode = room.settings.allowAdvantage && ['adv', 'dis'].includes(p.mode) ? p.mode : 'normal';
      a.bonus = int(p.bonus, -20, 20, 0);
      a.hiddenDC = !!p.hiddenDC;
      a.note = note;
      addLog(room, {
        kind: 'approve',
        name: a.playerName,
        text: a.text,
        note,
        stat: a.stat,
        mode: a.mode,
        dc: a.hiddenDC ? null : a.dc,
      });
    }
  }));

  socket.on('roll_action', guard(false, (p) => {
    const a = room.actions.find((x) => x.id === p.actionId);
    if (!a || a.status !== 'approved') return;
    if (a.playerId !== me.id && !isDM()) return fail('นี่ไม่ใช่การกระทำของคุณ');
    const owner = room.players[a.playerId];
    const mod = statMod(room, owner, a.stat) + (a.bonus || 0);
    const roll = rollDice({ sides: 20, count: 1, mod, mode: a.mode });
    a.roll = roll;
    a.outcome = judge(room, roll, a.dc);
    a.status = 'rolled';
    addLog(room, {
      kind: 'check',
      playerId: a.playerId,
      name: a.playerName,
      text: a.text,
      stat: a.stat,
      roll,
      dc: a.dc,
      outcome: a.outcome,
    });
    io.to(room.code).emit('dice', { by: a.playerName, roll, outcome: a.outcome });
  }));

  socket.on('resolve_action', guard(true, (p) => {
    const a = room.actions.find((x) => x.id === p.actionId);
    if (!a || !['rolled', 'approved'].includes(a.status)) return;
    a.status = 'resolved';
    const text = clip(p.narration, LIMITS.text);
    if (text) addLog(room, { kind: 'narrate', text, ref: a.playerName });
  }));

  socket.on('cancel_action', guard(false, (p) => {
    const a = room.actions.find((x) => x.id === p.actionId);
    if (!a || !['pending', 'approved'].includes(a.status)) return;
    if (a.playerId !== me.id && !isDM()) return;
    a.status = 'cancelled';
  }));

  // ----- Free dice roller -----
  socket.on('free_roll', guard(false, (p) => {
    if (!isDM() && !room.settings.playersCanFreeRoll) return fail('DM ปิดการทอยอิสระไว้');
    const roll = rollDice({ sides: p.sides, count: p.count, mod: p.mod, mode: p.mode });
    const hidden = isDM() && !!p.hidden;
    const label = clip(p.label, 60);
    addLog(room, {
      kind: 'roll',
      playerId: me.id,
      name: isDM() ? 'DM' : me.char?.name || me.name,
      roll,
      label,
      visibility: hidden ? 'dm' : 'all',
    });
    if (hidden) socket.emit('dice', { by: 'DM (ลับ)', roll });
    else io.to(room.code).emit('dice', { by: isDM() ? 'DM' : me.char?.name || me.name, roll });
  }));

  // ----- Ask the DM -----
  socket.on('ask', guard(false, (p) => {
    const text = clip(p.text, LIMITS.text);
    if (!text) return;
    room.questions.push({
      id: uid(),
      playerId: me.id,
      name: me.char?.name || me.name,
      text,
      answer: '',
      public: !p.private,
      ts: Date.now(),
    });
    if (room.questions.length > 100) room.questions.shift();
  }));

  socket.on('answer', guard(true, (p) => {
    const q = room.questions.find((x) => x.id === p.questionId);
    if (!q) return;
    q.answer = clip(p.text, LIMITS.text);
    if (typeof p.public === 'boolean') q.public = p.public;
  }));

  socket.on('chat', guard(false, (p) => {
    const text = clip(p.text, LIMITS.text);
    if (text) addLog(room, { kind: 'chat', playerId: me.id, name: isDM() ? 'DM' : me.char?.name || me.name, text });
  }));

  socket.on('disconnect', leave);
});

// Clean up rooms nobody has touched for 12 hours.
setInterval(() => {
  const cutoff = Date.now() - 12 * 3600 * 1000;
  for (const [code, r] of rooms) {
    const anyone = Object.values(r.players).some((p) => p.connected);
    const last = r.log.at(-1)?.ts ?? r.createdAt;
    if (!anyone && last < cutoff) rooms.delete(code);
  }
}, 30 * 60 * 1000).unref();

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  server.listen(PORT, () => console.log(`D20 Tavern running on http://localhost:${PORT}`));
}

module.exports = { server, rooms, rollDice };
