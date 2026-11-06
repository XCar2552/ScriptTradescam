// Difficulty: DC clamped per level, AI damage scaled, prompt carries the level.
const assert = require('assert');
const { io: connect } = require('socket.io-client');
const ai = require('../ai');
const { server } = require('../server');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (s, ev, data) => new Promise((r) => s.emit(ev, data, r));
let lastSystem = '';
ai.setProvider(async (system, prompt, kind) => {
  lastSystem = system;
  if (kind === 'review') return { decision: 'roll', dc: 99 };
  return { narration: 'ouch', hp_changes: [{ name: 'Ann', delta: -4 }] };
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const mk = () => { const s = connect(url, { transports: ['websocket'] }); s.on('state', (st) => (s.state = st)); return s; };
  const host = mk(), pl = mk();
  const c = await call(host, 'create_room', { name: 'H', playerId: 'h', dmMode: 'ai', difficulty: 'easy', themeId: 'pirate' });
  await call(pl, 'join_room', { code: c.code, name: 'Ann', playerId: 'ann' });
  await wait(60);
  assert.equal(pl.state.settings.difficulty, 'easy');
  assert.equal(pl.state.settings.defaultDC, 10);

  pl.emit('update_char', { name: 'Ann', maxHp: 30, hp: 30 });
  pl.emit('submit_action', { text: 'jump' });
  await wait(120);
  let a = pl.state.actions.find((x) => x.text === 'jump');
  assert.equal(a.dc, 14, 'easy max DC');
  assert(lastSystem.includes('ง่าย'), 'difficulty in prompt');
  pl.emit('roll_action', { actionId: a.id });
  await wait(150);
  assert.equal(pl.state.players.find((p) => p.id === 'ann').char.hp, 28, 'easy halves damage (-4 -> -2)');

  pl.emit('update_settings', { difficulty: 'nightmare' }); // not host
  await wait(40);
  assert.equal(pl.state.settings.difficulty, 'easy');
  host.emit('update_settings', { difficulty: 'nightmare' });
  await wait(40);
  assert.equal(pl.state.settings.difficulty, 'nightmare');
  assert.equal(pl.state.settings.defaultDC, 16);

  pl.emit('submit_action', { text: 'jump again' });
  await wait(120);
  a = pl.state.actions.find((x) => x.text === 'jump again');
  assert.equal(a.dc, 28, 'nightmare max DC');
  assert(lastSystem.includes('นรก'));
  pl.emit('roll_action', { actionId: a.id });
  await wait(150);
  assert.equal(pl.state.players.find((p) => p.id === 'ann').char.hp, 20, 'nightmare doubles damage (-4 -> -8)');

  console.log('✓ difficulty tests passed');
  host.disconnect(); pl.disconnect(); server.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
