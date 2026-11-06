// Theme registry. A theme gives the room a world: lore, islands/locations,
// NPCs, goals (win/lose), trackers and event tables.
const pirate = require('./pirate');

const THEMES = { pirate };

// Cards shown on the theme picker. `soon` = not playable yet.
const CARDS = [
  { id: 'pirate', name: pirate.name, genre: pirate.genre, emoji: pirate.emoji, tagline: pirate.tagline },
  { id: 'custom', name: 'กำหนดเอง', genre: 'สร้างโลกของคุณ', emoji: '✏️', tagline: 'ตั้งชื่อโลก เขียนเป้าหมายแพ้/ชนะเอง หรือให้ AI ช่วยเขียน' },
  { id: 'dragon', name: 'อาณาจักรมังกรเพลิง', genre: 'แฟนตาซี', emoji: '🐉', tagline: 'อัศวิน เวทมนตร์ และมังกรโบราณ', soon: true },
  { id: 'neon', name: 'มหานครนีออน 2099', genre: 'ไซเบอร์พังก์', emoji: '🌃', tagline: 'แฮกเกอร์ ไซบอร์ก และบริษัทยักษ์', soon: true },
  { id: 'haunt', name: 'คฤหาสน์ไร้เงา', genre: 'สยองขวัญ', emoji: '🕯️', tagline: 'เอาชีวิตรอดจนถึงรุ่งเช้า', soon: true },
];

let gid = 0;
const goal = (text) => ({ id: `g${++gid}`, text, done: false });

function buildWorld(themeId, custom = {}) {
  const t = THEMES[themeId];
  if (!t) {
    return {
      world: {
        themeId: 'custom',
        name: String(custom.name || 'โลกของเรา').slice(0, 60),
        genre: 'กำหนดเอง',
        emoji: '✏️',
        tagline: '',
        lore: String(custom.lore || '').slice(0, 2000),
        islands: [], npcs: [], roles: [], powers: null, factions: [], seaEvents: [],
        stats: null,
        opening: null,
      },
      goals: { win: [], lose: [] },
      trackers: [],
      location: null,
    };
  }
  const copy = JSON.parse(JSON.stringify(t));
  return {
    world: {
      themeId: copy.id, name: copy.name, genre: copy.genre, emoji: copy.emoji, tagline: copy.tagline,
      lore: copy.lore, islands: copy.islands, npcs: copy.npcs, roles: copy.roles, powers: copy.powers,
      factions: copy.factions, seaEvents: copy.seaEvents, stats: copy.stats, opening: copy.opening,
    },
    goals: { win: copy.goals.win.map(goal), lose: copy.goals.lose.map(goal) },
    trackers: copy.trackers.map((x) => ({ ...x })),
    location: copy.islands[0]?.id || null,
  };
}

// What a player (not the DM) may see: no secrets, no event tables,
// and details only for places the crew has visited.
function publicWorld(world, visited) {
  const seen = new Set(visited);
  return {
    ...world,
    islands: world.islands.map((i) =>
      seen.has(i.id)
        ? { ...i, secret: undefined, events: undefined }
        : { id: i.id, name: i.name, emoji: i.emoji, kind: i.kind, x: i.x, y: i.y, danger: i.danger, summary: i.summary, unknown: true },
    ),
    npcs: world.npcs.filter((n) => seen.has(n.island) || n.met).map((n) => ({ ...n, secret: undefined })),
    seaEvents: undefined,
  };
}

module.exports = { THEMES, CARDS, buildWorld, publicWorld, newGoal: goal };
