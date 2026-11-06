// D20 Tavern — multiplayer D20 tabletop RPG server.
// All dice are rolled on the server so nobody can fake a roll.
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const ai = require('./ai');
const themes = require('./themes');
const { DIFFICULTY, level } = require('./difficulty');
const CATALOG = require('./boardCatalog');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
// Three.js for the 3D map (served from node_modules, no CDN needed).
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three')));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
app.get('/config', (_req, res) => res.json({ aiAvailable: ai.available(), themeCards: require('./themes').CARDS }));
app.get('/ai-check', async (_req, res) => res.json(await ai.check()));

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
const ENDING_TEXT = { win: '🏆 ชนะ!', lose: '💀 พ่ายแพ้...' };
const AI_STYLES = ['ใจดี สนุกสนาน', 'ตลก กวนๆ', 'ดุดัน จริงจัง', 'ลึกลับ น่ากลัว', 'ดราม่า อลังการ'];

// Avatar = pixel parts (short strings) or a small uploaded JPEG/PNG/WebP.
function cleanAvatar(a) {
  if (!a || typeof a !== 'object') return null;
  if (a.type === 'photo') {
    const data = String(a.data || '');
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(data) || data.length > 80000) return null;
    return { type: 'photo', data };
  }
  if (a.type === 'pixel') {
    const out = { type: 'pixel' };
    for (const k of ['skin', 'hair', 'hairColor', 'eyes', 'mouth', 'outfit', 'outfitColor', 'hat', 'acc', 'bg']) {
      const v = String(a[k] ?? '').slice(0, 20);
      if (/^#[0-9a-fA-F]{6}$/.test(v) || /^[\p{L}\p{M}\s]{1,20}$/u.test(v)) out[k] = v;
    }
    return out;
  }
  return null;
}

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
    difficulty: 'normal',
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

// ---------- Themes / world ----------
function applyTheme(room, themeId, custom) {
  const b = themes.buildWorld(themeId, custom);
  room.world = b.world;
  room.goals = b.goals;
  room.trackers = b.trackers;
  room.location = b.location;
  room.visited = b.location ? [b.location] : [];
  room.ending = null;
  const s = room.settings;
  if (b.world.stats) {
    Object.assign(s, { preset: 'custom', statMode: 'direct', stats: [...b.world.stats] });
    for (const pl of Object.values(room.players)) {
      if (pl.char) pl.char.stats = Object.fromEntries(s.stats.map((k) => [k, 0]));
    }
  }
  s.theme = b.world.name;
  if (b.world.opening) room.scene = { ...b.world.opening };
}

const island = (room, id) => room.world?.islands.find((i) => i.id === id);

function moveTo(room, id) {
  const isl = island(room, id);
  if (!isl) return null;
  room.location = id;
  if (!room.visited.includes(id)) room.visited.push(id);
  addLog(room, { kind: 'travel', text: `⛵ ลูกเรือเดินทางถึง ${isl.emoji} ${isl.name}` });
  return isl;
}

function setTracker(room, id, value) {
  const t = room.trackers.find((x) => x.id === id);
  if (!t) return;
  const before = t.value;
  t.value = Math.max(0, Math.min(t.max, value));
  if (t.value !== before) {
    addLog(room, { kind: 'system', text: `${t.icon || '📊'} ${t.name}: ${before} → ${t.value}${t.max < 9999 ? `/${t.max}` : ''}` });
  }
}

function setEnding(room, type, text) {
  room.ending = { type, text: text || ENDING_TEXT[type], ts: Date.now() };
  addLog(room, { kind: 'ending', type, text: room.ending.text });
}

// Automatic win/lose checks after anything that changes the game state.
function checkEnding(room) {
  if (room.ending) return;
  for (const t of room.trackers) {
    if (t.loseAt !== undefined && t.value === t.loseAt) {
      return setEnding(room, 'lose', `${t.icon || ''} ${t.name} ถึง ${t.value} — การผจญภัยจบลงแล้ว`);
    }
  }
  const crew = Object.values(room.players).filter((p) => p.char && p.id !== room.dmId);
  if (crew.length && crew.every((p) => p.char.hp <= 0)) {
    return setEnding(room, 'lose', 'ลูกเรือทุกคนหมดแรง... การผจญภัยจบลงแล้ว');
  }
  if (room.goals.win.length && room.goals.win.every((g) => g.done)) {
    return setEnding(room, 'win', `ทำเป้าหมายสำเร็จทั้งหมด! ${room.world.emoji} ${room.world.name} จะจดจำชื่อของพวกคุณ`);
  }
}

// Effects the AI may request in its JSON (all validated here).
function applyAIEffects(room, out) {
  const mul = level(room.settings.difficulty).dmg;
  for (const h of out.hpChanges || []) {
    const delta = h.delta < 0 ? Math.min(-1, Math.round(h.delta * mul)) : h.delta;
    applyHp(room, [{ ...h, delta }]);
  }
  for (const e of out.enemyChanges || []) enemyDamage(room, e.name, e.delta);
  for (const t of out.trackerChanges || []) {
    const tr = room.trackers.find((x) => x.id === t.id);
    if (tr) setTracker(room, tr.id, tr.value + t.delta);
  }
  for (const id of out.goalsCompleted || []) {
    const g = room.goals.win.find((x) => x.id === id);
    if (g && !g.done) {
      g.done = true;
      addLog(room, { kind: 'system', text: `✅ เป้าหมายสำเร็จ: ${g.text}` });
    }
  }
  checkEnding(room);
}

// ---------- Battle board ----------
const MOVE_RANGE = 6;
const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const tokenAt = (b, x, y) => b.tokens.find((t) => t.x === x && t.y === y);
const inBounds = (b, x, y) => x >= 0 && y >= 0 && x < b.cols && y < b.rows;
const crew = (room) => Object.values(room.players).filter((p) => p.char && p.id !== room.dmId);

function freeCell(b, yFrom, yTo) {
  const cells = [];
  for (let y = yFrom; y <= yTo; y++) for (let x = 0; x < b.cols; x++) if (!tokenAt(b, x, y)) cells.push({ x, y });
  return cells.length ? cells[crypto.randomInt(cells.length)] : null;
}

function uniqueName(b, name) {
  if (!b.tokens.some((t) => t.name === name)) return name;
  let n = 2;
  while (b.tokens.some((t) => t.name === `${name} ${n}`)) n++;
  return `${name} ${n}`;
}

// Keep one token per crew member; drop tokens of people who left or became DM.
function syncPlayerTokens(room) {
  const b = room.board;
  if (!b) return;
  const ids = new Set(crew(room).map((p) => p.id));
  b.tokens = b.tokens.filter((t) => t.kind !== 'player' || ids.has(t.ref));
  for (const p of crew(room)) {
    if (b.tokens.some((t) => t.kind === 'player' && t.ref === p.id)) continue;
    const c = freeCell(b, b.rows - 2, b.rows - 1) || freeCell(b, 0, b.rows - 1);
    if (c) b.tokens.push({ id: uid(), kind: 'player', ref: p.id, name: p.char.name || p.name, ...c });
  }
  for (const t of b.tokens) if (t.kind === 'player') { const p = room.players[t.ref]; if (p) t.name = p.char.name || p.name; }
}

function addEnemy(room, type, x, y, name) {
  const b = room.board;
  const e = CATALOG.ENEMIES[type];
  if (!b || !e) return null;
  const c = x !== undefined && inBounds(b, x, y) && !tokenAt(b, x, y) ? { x, y } : freeCell(b, 0, Math.floor(b.rows / 2) - 1);
  if (!c) return null;
  const t = { id: uid(), kind: 'enemy', sprite: type, name: uniqueName(b, clip(name, 30) || e.name), hp: e.hp, maxHp: e.hp, ...c };
  b.tokens.push(t);
  return t;
}

function addObject(room, type, x, y) {
  const b = room.board;
  if (!b || !CATALOG.OBJECTS[type]) return null;
  const c = x !== undefined && inBounds(b, x, y) && !tokenAt(b, x, y) ? { x, y } : freeCell(b, 2, b.rows - 3);
  if (!c) return null;
  const t = { id: uid(), kind: 'object', sprite: type, name: CATALOG.OBJECTS[type], ...c };
  b.tokens.push(t);
  return t;
}

function startBoard(room, terrain) {
  const plan = CATALOG.ISLAND_BOARD[room.location];
  room.board = {
    terrain: CATALOG.TERRAINS[terrain] ? terrain : plan?.terrain || 'grass',
    cols: 8, rows: 10, tokens: [], order: [], turn: 0, round: 0,
  };
  syncPlayerTokens(room);
  addLog(room, { kind: 'system', text: `♟️ เริ่มฉากต่อสู้! (${CATALOG.TERRAINS[room.board.terrain]})` });
}

function autoEncounter(room, foes, props) {
  for (const o of props) addObject(room, o);
  for (const f of foes) addEnemy(room, f);
}

function enemyDamage(room, name, delta) {
  const b = room.board;
  if (!b) return;
  const n = String(name).trim().toLowerCase();
  const t = b.tokens.find((x) => x.kind === 'enemy' && x.name.toLowerCase() === n)
    || b.tokens.find((x) => x.kind === 'enemy' && (x.name.toLowerCase().startsWith(n) || n.startsWith(x.name.toLowerCase())));
  if (t) setEnemyHp(room, t, t.hp + delta);
}

function setEnemyHp(room, t, hp) {
  const b = room.board;
  t.hp = Math.max(0, Math.min(t.maxHp, hp));
  if (t.hp > 0) return;
  b.tokens = b.tokens.filter((x) => x !== t);
  b.order = b.order.filter((id) => id !== t.id);
  if (b.turn >= b.order.length) b.turn = 0;
  addLog(room, { kind: 'system', text: `💀 ${t.name} ถูกกำจัดแล้ว!` });
  if (!b.tokens.some((x) => x.kind === 'enemy')) addLog(room, { kind: 'system', text: '🎉 ศัตรูถูกกำจัดหมดแล้ว — ชนะการต่อสู้!' });
}

function initMod(room, p) {
  const stat = room.settings.stats.find((k) => ['ความไว', 'DEX'].includes(k));
  return stat ? statMod(room, p, stat) : 0;
}

function rollInitiative(room) {
  const b = room.board;
  const rolls = b.tokens
    .filter((t) => t.kind === 'player' || t.kind === 'enemy')
    .map((t) => {
      const mod = t.kind === 'player' ? initMod(room, room.players[t.ref]) : 0;
      const r = d(20);
      return { t, total: r + mod, r };
    })
    .sort((a, c) => c.total - a.total || crypto.randomInt(3) - 1);
  b.order = rolls.map((x) => x.t.id);
  b.turn = 0;
  b.round = 1;
  addLog(room, { kind: 'system', text: `🎲 ลำดับการเล่น: ${rolls.map((x) => `${x.t.name} (${x.total})`).join(' → ')}` });
}

const currentToken = (b) => (b && b.order.length ? b.tokens.find((t) => t.id === b.order[b.turn]) : null);

function nextTurn(room) {
  const b = room.board;
  if (!b?.order.length) return;
  for (let i = 0; i < b.order.length; i++) {
    b.turn++;
    if (b.turn >= b.order.length) { b.turn = 0; b.round++; }
    const t = currentToken(b);
    const alive = t && (t.kind === 'enemy' ? t.hp > 0 : (room.players[t.ref]?.char?.hp ?? 0) > 0);
    if (alive) break;
  }
  const t = currentToken(b);
  if (!t) return;
  addLog(room, { kind: 'system', text: `▶️ รอบ ${b.round}: ตาของ ${t.name}` });
  if (t.kind === 'enemy' && room.dmMode === 'ai') aiEnemyTurn(room, t);
}

// AI mode: the enemy walks toward the nearest conscious crew member, then the AI narrates its move.
function aiEnemyTurn(room, t) {
  const b = room.board;
  const targets = b.tokens.filter((x) => x.kind === 'player' && (room.players[x.ref]?.char?.hp ?? 0) > 0);
  if (!targets.length) return;
  const target = targets.sort((a, c) => dist(a, t) - dist(c, t))[0];
  for (let step = 0; step < 4 && dist(t, target) > 1; step++) {
    const nx = t.x + Math.sign(target.x - t.x);
    const ny = t.y + Math.sign(target.y - t.y);
    const options = [{ x: nx, y: ny }, { x: nx, y: t.y }, { x: t.x, y: ny }].filter((c) => inBounds(b, c.x, c.y) && !tokenAt(b, c.x, c.y));
    if (!options.length) break;
    Object.assign(t, options[0]);
  }
  const near = dist(t, target) <= 1;
  runAI(room, async () => {
    if (!b.tokens.includes(t)) return;
    const r = await ai.continueStory(room,
      `ถึงตาของศัตรู "${t.name}" (HP ${t.hp}/${t.maxHp}) ${near ? `ซึ่งอยู่ติดกับ ${target.name} แล้ว` : `ซึ่งกำลังเดินเข้าหา ${target.name}`} ` +
      'เล่าสิ่งที่มันทำสั้นๆ ถ้ามันโจมตีโดนให้ใส่ดาเมจใน hp_changes (โจมตีอาจพลาดได้)');
    addLog(room, { kind: 'narrate', text: r.narration });
    applyAIEffects(room, r);
    if (room.board === b && currentToken(b) === t) nextTurn(room);
  });
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
    isHost: viewerId === room.hostId,
    hostId: room.hostId,
    dmId: room.dmId,
    dmMode: room.dmMode,
    aiAvailable: ai.available(),
    aiBusy: room.aiBusy > 0,
    aiError: room.aiError,
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
      dmTitle: p.dmTitle || '',
      avatarRev: room.avatarRev[p.id] || 0,
    })),
    actions: room.actions
      .filter((a) => isDM || a.playerId === viewerId || a.status !== 'pending')
      .map((a) => (!isDM && a.hiddenDC && a.status === 'approved' ? { ...a, dc: null } : a)),
    questions: room.questions.filter((q) => isDM || q.public || q.playerId === viewerId),
    log: room.log.filter(visible),
    world: isDM ? room.world : themes.publicWorld(room.world, room.visited),
    goals: room.goals,
    trackers: room.trackers,
    location: room.location,
    visited: room.visited,
    ending: room.ending,
    canGM: isDM || (room.dmMode === 'ai' && viewerId === room.hostId),
    aiDM: room.aiDM,
    aiStyles: AI_STYLES,
    difficulties: Object.fromEntries(Object.entries(DIFFICULTY).map(([k, v]) => [k, { label: v.label, dc: v.dc, defaultDC: v.defaultDC }])),
    themeCards: themes.CARDS,
    board: room.board,
    catalog: { enemies: Object.fromEntries(Object.entries(CATALOG.ENEMIES).map(([k, v]) => [k, v.name])), objects: CATALOG.OBJECTS, terrains: CATALOG.TERRAINS },
    moveRange: MOVE_RANGE,
  };
}

function broadcast(room) {
  syncPlayerTokens(room);
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

// ---------- AI Dungeon Master ----------
// Calls are queued per room so the story stays in order.
function runAI(room, job, { anyMode = false } = {}) {
  room.aiBusy++;
  broadcast(room);
  room.aiQueue = room.aiQueue
    .then(async () => {
      if ((!anyMode && room.dmMode !== 'ai') || !rooms.has(room.code)) return;
      await job();
      room.aiError = '';
    })
    .catch((err) => {
      console.error('AI error:', err.code || '', err.message);
      room.aiError = err instanceof ai.AIError ? err.message : 'AI มีปัญหา';
      addLog(room, { kind: 'system', text: `🤖 AI DM ตอบไม่ได้: ${room.aiError} — กด "ลองใหม่" หรือให้เจ้าของห้องสลับเป็นคนจริงเป็น DM` });
    })
    .finally(() => {
      room.aiBusy--;
      broadcast(room);
    });
  return room.aiQueue;
}

function findByCharName(room, name) {
  const n = String(name).trim().toLowerCase();
  return Object.values(room.players).find(
    (p) => p.char && ((p.char.name || '').toLowerCase() === n || p.name.toLowerCase() === n),
  );
}

function applyHp(room, changes) {
  for (const h of changes) {
    const t = findByCharName(room, h.name);
    if (!t) continue;
    t.char.hp = Math.max(0, Math.min(t.char.maxHp, t.char.hp + h.delta));
    addLog(room, {
      kind: 'system',
      text: `${t.char.name || t.name} ${h.delta < 0 ? 'เสีย' : 'ฟื้น'} HP ${Math.abs(h.delta)} (เหลือ ${t.char.hp}/${t.char.maxHp})`,
    });
  }
}

function aiScene(room, idea) {
  return runAI(room, async () => {
    const sc = await ai.newScene(room, idea);
    room.scene = sc;
    addLog(room, { kind: 'scene', title: sc.title, text: sc.text });
  });
}

function aiReview(room, action) {
  return runAI(room, async () => {
    if (action.status !== 'pending') return;
    const r = await ai.reviewAction(room, action);
    if (action.status !== 'pending') return;
    const [lo, hi] = level(room.settings.difficulty).dc;
    applyReview(room, action, { ...r, dc: Math.max(lo, Math.min(hi, r.dc)), decision: r.decision === 'roll' ? 'approve' : r.decision });
    if (r.decision !== 'roll' && r.narration) addLog(room, { kind: 'narrate', text: r.narration });
  });
}

function aiNarrate(room, action) {
  return runAI(room, async () => {
    if (action.status !== 'rolled') return;
    const r = await ai.narrateResult(room, action);
    if (action.status !== 'rolled') return;
    action.status = 'resolved';
    addLog(room, { kind: 'narrate', text: r.narration, ref: action.playerName });
    applyAIEffects(room, r);
  });
}

function aiArrive(room, isl) {
  const ev = room.world.seaEvents?.length && Math.random() < 0.5
    ? room.world.seaEvents[crypto.randomInt(room.world.seaEvents.length)] : '';
  return runAI(room, async () => {
    const sc = await ai.newScene(room, `ลูกเรือเพิ่งเดินทางมาถึง ${isl.name}${ev ? ` (ระหว่างทางในทะเลเกิดเหตุการณ์: ${ev})` : ''} บรรยายการมาถึงและสิ่งแรกที่เห็น`);
    room.scene = sc;
    addLog(room, { kind: 'scene', title: sc.title, text: sc.text });
  });
}

function aiAnswer(room, q) {
  return runAI(room, async () => {
    if (q.answer) return;
    q.answer = await ai.answerQuestion(room, q);
  });
}

function aiCatchUp(room) {
  for (const a of room.actions) {
    if (a.status === 'pending') aiReview(room, a);
    if (a.status === 'rolled') aiNarrate(room, a);
  }
  for (const q of room.questions) if (!q.answer) aiAnswer(room, q);
}

function applyReview(room, a, p) {
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
}

// ---------- Socket handlers ----------
io.on('connection', (socket) => {
  let room = null;
  let me = null;

  const fail = (msg) => socket.emit('toast', { type: 'error', msg });
  const isDM = () => room && me && room.dmId === me.id;
  const isHost = () => room && me && (room.hostId === me.id || isDM());
  // Game master powers: the human DM, or the room owner while the AI runs the game.
  const isGM = () => isDM() || (room && me && room.dmMode === 'ai' && room.hostId === me.id);
  // level: false = anyone in the room, 'dm' = human DM, 'host' = room owner or DM
  const guard = (level, fn) => (payload = {}, ack) => {
    try {
      if (!room || !me) return fail('ยังไม่ได้เข้าห้อง');
      if (level === 'dm' && !isDM()) return fail('คำสั่งนี้สำหรับ DM เท่านั้น');
      if (level === 'host' && !isHost()) return fail('คำสั่งนี้สำหรับเจ้าของห้องหรือ DM');
      if (level === 'gm' && !isGM()) return fail('คำสั่งนี้สำหรับ DM (หรือเจ้าของห้องเมื่อ AI เป็น DM)');
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
    socket.emit('avatars', r.avatars);
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
    const wantAI = payload.dmMode === 'ai';
    if (wantAI && !ai.available()) {
      return typeof ack === 'function' && ack({ ok: false, msg: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า AI (GEMINI_API_KEY)' });
    }
    const code = newCode();
    const r = {
      code,
      hostId: playerId,
      dmId: wantAI ? null : playerId,
      dmMode: wantAI ? 'ai' : 'human',
      aiBusy: 0,
      aiError: '',
      aiQueue: Promise.resolve(),
      aiDM: { name: 'AI DM', style: AI_STYLES[0], persona: '' },
      avatars: {},
      avatarRev: {},
      board: null,
      createdAt: Date.now(),
      settings: defaultSettings(payload.preset),
      scene: { title: 'บทนำ', text: wantAI ? 'AI DM จะเริ่มเรื่องเมื่อเจ้าของห้องกด "เริ่มเรื่อง"' : 'DM กำลังเตรียมฉากแรก...' },
      players: {},
      actions: [],
      questions: [],
      log: [],
    };
    if (DIFFICULTY[payload.difficulty]) {
      r.settings.difficulty = payload.difficulty;
      r.settings.defaultDC = level(payload.difficulty).defaultDC;
    }
    applyTheme(r, clip(payload.themeId, 20) || 'custom', { name: clip(payload.worldName, 60), lore: clip(payload.worldLore, LIMITS.scene) });
    if (r.dmMode === 'ai' && !r.world.opening) r.scene = { title: 'บทนำ', text: 'AI DM จะเริ่มเรื่องเมื่อเจ้าของห้องกด "ให้ AI สร้างฉากใหม่"' };
    rooms.set(code, r);
    const p = { id: playerId, name, connected: true, socketId: null, char: null };
    if (wantAI) p.char = newCharacter(r, name);
    r.players[playerId] = p;
    attach(r, p);
    addLog(r, { kind: 'system', text: wantAI ? `${name} สร้างห้อง — 🤖 AI เป็น DM` : `${name} สร้างห้องและเป็น DM` });
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
  socket.on('update_settings', guard('host', (p) => {
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
    if (DIFFICULTY[p.difficulty] && p.difficulty !== s.difficulty) {
      s.difficulty = p.difficulty;
      s.defaultDC = level(p.difficulty).defaultDC;
      addLog(room, { kind: 'system', text: `🎚️ ระดับความยากเปลี่ยนเป็น ${level(p.difficulty).label}` });
    }
  }));

  socket.on('set_scene', guard('dm', (p) => {
    room.scene = { title: clip(p.title, 80) || 'ฉากใหม่', text: clip(p.text, LIMITS.scene) };
    addLog(room, { kind: 'scene', title: room.scene.title, text: room.scene.text });
  }));

  socket.on('narrate', guard('dm', (p) => {
    const text = clip(p.text, LIMITS.text);
    if (text) addLog(room, { kind: 'narrate', text });
  }));

  socket.on('dm_hp', guard('dm', (p) => {
    const target = room.players[p.playerId];
    if (!target?.char) return;
    const delta = int(p.delta, -999, 999, 0);
    target.char.hp = Math.max(0, Math.min(target.char.maxHp, target.char.hp + delta));
    setImmediate(() => { checkEnding(room); broadcast(room); });
    addLog(room, {
      kind: 'system',
      text: `${target.char.name || target.name} ${delta < 0 ? 'เสีย' : 'ฟื้น'} HP ${Math.abs(delta)} (เหลือ ${target.char.hp}/${target.char.maxHp})`,
    });
  }));

  socket.on('kick', guard('host', (p) => {
    const target = room.players[p.playerId];
    if (!target || target.id === room.dmId || target.id === room.hostId || target.id === me.id) return;
    if (target.socketId) io.to(target.socketId).emit('kicked');
    delete room.players[target.id];
    delete room.avatars[target.id];
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
    if (p.power !== undefined) c.power = clip(p.power, 40);
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
    const target = room.board?.tokens.find((t) => t.id === p.targetId && t.kind === 'enemy');
    const action = {
      targetId: target?.id,
      targetName: target?.name,
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
    if (room.dmMode === 'ai' && action.status === 'pending') aiReview(room, action);
  }));

  socket.on('review_action', guard('dm', (p) => {
    const a = room.actions.find((x) => x.id === p.actionId);
    if (!a || a.status !== 'pending') return;
    applyReview(room, a, p);
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
    io.to(room.code).emit('dice', { by: a.playerName, pid: a.playerId, roll, outcome: a.outcome });
    if (room.dmMode === 'ai') aiNarrate(room, a);
  }));

  socket.on('resolve_action', guard('dm', (p) => {
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
    if (hidden) socket.emit('dice', { by: 'DM (ลับ)', pid: me.id, roll });
    else io.to(room.code).emit('dice', { by: isDM() ? 'DM' : me.char?.name || me.name, pid: me.id, roll });
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
    if (room.dmMode === 'ai') aiAnswer(room, room.questions.at(-1));
  }));

  // ----- DM mode: human <-> AI -----
  socket.on('set_dm_mode', guard('host', (p) => {
    if (p.mode === 'ai') {
      if (!ai.available()) return fail('เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า AI (GEMINI_API_KEY)');
      if (room.dmMode === 'ai') return;
      room.dmMode = 'ai';
      room.dmId = null;
      room.aiError = '';
      for (const pl of Object.values(room.players)) if (!pl.char) pl.char = newCharacter(room, pl.name);
      addLog(room, { kind: 'system', text: '🤖 เปลี่ยนเป็น AI เป็น DM — ทุกคนเป็นผู้เล่นแล้ว' });
      aiCatchUp(room);
    } else if (p.mode === 'human') {
      const target = room.players[p.dmId] || room.players[room.hostId] || me;
      room.dmMode = 'human';
      room.dmId = target.id;
      room.aiError = '';
      addLog(room, { kind: 'system', text: `👑 ${target.char?.name || target.name} เป็น DM แล้ว` });
    }
  }));

  socket.on('ai_scene', guard('host', (p) => {
    if (room.dmMode !== 'ai') return fail('ห้องนี้ใช้คนเป็น DM');
    aiScene(room, clip(p.idea, LIMITS.text));
  }));

  socket.on('ai_continue', guard(false, (p) => {
    if (room.dmMode !== 'ai') return fail('ห้องนี้ใช้คนเป็น DM');
    if (room.aiBusy > 0) return fail('AI กำลังคิดอยู่ รอแป๊บนะ');
    const request = clip(p.text, LIMITS.text);
    if (request) addLog(room, { kind: 'chat', playerId: me.id, name: me.char?.name || me.name, text: `(ขอ DM) ${request}` });
    runAI(room, async () => {
      const r = await ai.continueStory(room, request);
      addLog(room, { kind: 'narrate', text: r.narration });
      applyAIEffects(room, r);
    });
  }));

  // ----- Avatars & DM profiles -----
  // target 'ai' = the AI DM's look (room owner / GM only); otherwise your own.
  socket.on('set_avatar', guard(false, (p) => {
    const av = cleanAvatar(p.avatar);
    if (!av) return fail('รูปนี้ใช้ไม่ได้ (ไฟล์ใหญ่ไปหรือรูปแบบไม่รองรับ)');
    let id = me.id;
    if (p.target === 'ai') {
      if (!isHost() && !isGM()) return fail('เฉพาะเจ้าของห้องแต่ง AI DM ได้');
      id = 'ai';
    }
    room.avatars[id] = av;
    room.avatarRev[id] = (room.avatarRev[id] || 0) + 1;
    io.to(room.code).emit('avatar', { id, avatar: av });
  }));

  socket.on('dm_profile', guard('dm', (p) => {
    me.dmTitle = clip(p.title, 40);
  }));

  socket.on('ai_profile', guard('host', (p) => {
    const a = room.aiDM;
    if (p.name !== undefined) a.name = clip(p.name, 30) || 'AI DM';
    if (p.style !== undefined) a.style = AI_STYLES.includes(p.style) ? p.style : a.style;
    if (p.persona !== undefined) a.persona = clip(p.persona, 300);
  }));

  // ----- Battle board -----
  const boardOr = () => { if (!room.board) { fail('ยังไม่ได้เริ่มฉากต่อสู้'); return null; } return room.board; };

  socket.on('board_start', guard('gm', (p) => startBoard(room, p.terrain)));

  socket.on('board_end', guard('gm', () => {
    room.board = null;
    addLog(room, { kind: 'system', text: '🏁 จบฉากต่อสู้' });
  }));

  socket.on('board_terrain', guard('gm', (p) => {
    const b = boardOr();
    if (b && CATALOG.TERRAINS[p.terrain]) b.terrain = p.terrain;
  }));

  socket.on('board_add', guard('gm', (p) => {
    if (!boardOr()) return;
    const x = int(p.x, 0, 99, undefined);
    const y = int(p.y, 0, 99, undefined);
    const t = p.kind === 'object' ? addObject(room, p.type, x, y) : addEnemy(room, p.type, x, y, p.name);
    if (!t) fail('วางตรงนี้ไม่ได้');
  }));

  socket.on('board_auto', guard('gm', () => {
    if (!boardOr()) return;
    const plan = CATALOG.ISLAND_BOARD[room.location];
    const keys = Object.keys(CATALOG.ENEMIES);
    autoEncounter(room, plan?.foes || [keys[crypto.randomInt(keys.length)], keys[crypto.randomInt(keys.length)]], plan?.props || ['rock', 'tree']);
    addLog(room, { kind: 'system', text: '⚔️ ศัตรูปรากฏตัว!' });
  }));

  socket.on('board_remove', guard('gm', (p) => {
    const b = boardOr();
    if (!b) return;
    const t = b.tokens.find((x) => x.id === p.tokenId);
    if (!t || t.kind === 'player') return;
    b.tokens = b.tokens.filter((x) => x !== t);
    b.order = b.order.filter((id) => id !== t.id);
    if (b.turn >= b.order.length) b.turn = 0;
  }));

  socket.on('board_hp', guard('gm', (p) => {
    const b = boardOr();
    const t = b?.tokens.find((x) => x.id === p.tokenId && x.kind === 'enemy');
    if (t) setEnemyHp(room, t, t.hp + int(p.delta, -999, 999, 0));
  }));

  socket.on('board_move', guard(false, (p) => {
    const b = boardOr();
    if (!b) return;
    const t = b.tokens.find((x) => x.id === p.tokenId);
    const x = int(p.x, -1, 99, -1);
    const y = int(p.y, -1, 99, -1);
    if (!t || !inBounds(b, x, y) || tokenAt(b, x, y)) return fail('ไปช่องนั้นไม่ได้');
    if (!isGM()) {
      if (t.kind !== 'player' || t.ref !== me.id) return fail('เดินได้แค่หมากของตัวเอง');
      const cur = currentToken(b);
      if (cur && cur.id !== t.id) return fail(`ยังไม่ถึงตาคุณ (ตอนนี้ตาของ ${cur.name})`);
      if (dist(t, { x, y }) > MOVE_RANGE) return fail(`เดินได้ไกลสุด ${MOVE_RANGE} ช่อง`);
      if ((me.char?.hp ?? 0) <= 0) return fail('ตัวละครหมดสติอยู่');
    }
    t.x = x;
    t.y = y;
  }));

  socket.on('board_initiative', guard('gm', () => {
    if (!boardOr()) return;
    rollInitiative(room);
    const first = currentToken(room.board);
    if (first?.kind === 'enemy' && room.dmMode === 'ai') aiEnemyTurn(room, first); // enemy goes first
  }));

  socket.on('board_next', guard(false, () => {
    const b = boardOr();
    if (!b?.order.length) return;
    const cur = currentToken(b);
    if (!isGM() && !(cur?.kind === 'player' && cur.ref === me.id)) return fail('จบเทิร์นได้เฉพาะเจ้าของตาหรือ DM');
    nextTurn(room);
  }));

  socket.on('ai_encounter', guard('gm', (p) => {
    if (!ai.available()) return fail('AI ยังไม่พร้อม');
    if (!room.board) startBoard(room);
    runAI(room, async () => {
      const plan = await ai.planEncounter(room, clip(p.idea, LIMITS.text), CATALOG);
      if (plan.terrain) room.board.terrain = plan.terrain;
      for (const o of plan.objects) addObject(room, o);
      for (const e of plan.enemies) addEnemy(room, e.type, undefined, undefined, e.name);
      if (plan.intro) addLog(room, { kind: 'narrate', text: plan.intro });
    }, { anyMode: true });
  }));

  // ----- World: theme, travel, goals, trackers, endings -----
  socket.on('set_theme', guard('host', (p) => {
    applyTheme(room, clip(p.themeId, 20), { name: clip(p.worldName, 60), lore: clip(p.worldLore, LIMITS.scene) });
    addLog(room, { kind: 'system', text: `🌍 เปลี่ยนโลกเป็น ${room.world.emoji} ${room.world.name}` });
    if (room.world.opening) addLog(room, { kind: 'scene', title: room.scene.title, text: room.scene.text });
  }));

  socket.on('world_info', guard('gm', (p) => {
    if (p.name !== undefined) room.world.name = clip(p.name, 60) || room.world.name;
    if (p.lore !== undefined) room.world.lore = clip(p.lore, LIMITS.scene);
    room.settings.theme = room.world.name;
  }));

  socket.on('travel', guard(false, (p) => {
    const isl = island(room, p.islandId);
    if (!isl || isl.id === room.location) return;
    if (room.dmMode === 'ai') {
      if (room.aiBusy > 0) return fail('AI กำลังคิดอยู่ รอแป๊บนะ');
      moveTo(room, isl.id);
      aiArrive(room, isl);
    } else {
      if (!isDM()) return fail('ให้ DM เป็นคนพาเรือไปเกาะต่อไป');
      moveTo(room, isl.id);
    }
  }));

  socket.on('tracker', guard('gm', (p) => {
    const t = room.trackers.find((x) => x.id === p.id);
    if (!t) return;
    setTracker(room, t.id, p.value !== undefined ? int(p.value, 0, t.max, t.value) : t.value + int(p.delta, -999, 999, 0));
    checkEnding(room);
  }));

  socket.on('tracker_add', guard('gm', (p) => {
    const name = clip(p.name, 40);
    if (!name || room.trackers.length >= 8) return;
    const max = int(p.max, 1, 9999, 10);
    const t = { id: uid(), name, icon: clip(p.icon, 4) || '📊', value: int(p.value, 0, max, 0), max };
    if (p.loseAt === 'zero') t.loseAt = 0;
    if (p.loseAt === 'max') t.loseAt = max;
    room.trackers.push(t);
  }));

  socket.on('tracker_remove', guard('gm', (p) => {
    room.trackers = room.trackers.filter((x) => x.id !== p.id);
  }));

  socket.on('goal_toggle', guard('gm', (p) => {
    const g = room.goals.win.find((x) => x.id === p.id);
    if (!g) return;
    g.done = !g.done;
    if (g.done) addLog(room, { kind: 'system', text: `✅ เป้าหมายสำเร็จ: ${g.text}` });
    checkEnding(room);
  }));

  socket.on('goal_add', guard('gm', (p) => {
    const list = p.list === 'lose' ? 'lose' : 'win';
    const text = clip(p.text, 200);
    if (text && room.goals[list].length < 10) room.goals[list].push(themes.newGoal(text));
  }));

  socket.on('goal_remove', guard('gm', (p) => {
    for (const k of ['win', 'lose']) room.goals[k] = room.goals[k].filter((g) => g.id !== p.id);
  }));

  socket.on('ai_goals', guard('gm', (p) => {
    if (!ai.available()) return fail('AI ยังไม่พร้อม');
    runAI(room, async () => {
      const g = await ai.writeGoals(room, clip(p.idea, LIMITS.text));
      room.goals = { win: g.win.map(themes.newGoal), lose: g.lose.map(themes.newGoal) };
      addLog(room, { kind: 'system', text: '🤖 AI เขียนเป้าหมายแพ้/ชนะใหม่แล้ว — ดูในแท็บโลก' });
    }, { anyMode: true });
  }));

  socket.on('random_event', guard('gm', () => {
    const isl = island(room, room.location);
    const pool = [...(isl?.events || []), ...(room.world.seaEvents || [])];
    if (!pool.length) return fail('โลกนี้ยังไม่มีตารางอีเวนต์');
    const ev = pool[crypto.randomInt(pool.length)];
    if (room.dmMode === 'ai') {
      runAI(room, async () => {
        const r = await ai.continueStory(room, `ให้เกิดเหตุการณ์นี้: ${ev}`);
        addLog(room, { kind: 'narrate', text: r.narration });
        applyAIEffects(room, r);
      });
    } else {
      addLog(room, { kind: 'event', text: ev });
    }
  }));

  socket.on('ending', guard('gm', (p) => {
    if (p.type === 'clear') {
      room.ending = null;
      addLog(room, { kind: 'system', text: '▶️ เล่นต่อ' });
    } else if (p.type === 'win' || p.type === 'lose') {
      setEnding(room, p.type, clip(p.text, LIMITS.text));
    }
  }));

  socket.on('ai_retry', guard(false, () => {
    if (room.dmMode !== 'ai') return;
    room.aiError = '';
    aiCatchUp(room);
  }));

  socket.on('answer', guard('dm', (p) => {
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
