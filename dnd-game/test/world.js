// World/theme system: pirate theme, secrets, travel, trackers, goals, endings, AI effects.
const assert = require('assert');
const { io: connect } = require('socket.io-client');
const ai = require('../ai');
const { server } = require('../server');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (s, ev, data) => new Promise((r) => s.emit(ev, data, r));
ai.setProvider(async (system, prompt, kind) => {
  if (kind === 'scene') return { title: 'Arrival', text: 'You arrive.' };
  if (kind === 'goals') return { win: ['Find the cat', 'Escape'], lose: ['Everyone sleeps'] };
  if (kind === 'review') return { decision: 'roll', dc: 5 };
  return { narration: 'A piece of the star map glows!', tracker_changes: [{ id: 'pieces', delta: 1 }, { id: 'nope', delta: 3 }], goals_completed: [] };
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const mk = () => { const s = connect(url, { transports: ['websocket'] }); s.on('state', (st) => (s.state = st)); return s; };
  const dm = mk(), pl = mk();

  // ---- pirate theme, human DM ----
  const c = await call(dm, 'create_room', { name: 'DM', playerId: 'dm', themeId: 'pirate' });
  await call(pl, 'join_room', { code: c.code, name: 'Ann', playerId: 'ann' });
  await wait(80);
  assert.equal(pl.state.world.name, 'ทะเลพันเกาะ');
  assert.deepEqual(pl.state.settings.stats, ['พลัง', 'ความไว', 'ความอึด', 'ไหวพริบ', 'เสน่ห์']);
  assert(pl.state.players.find((p) => p.id === 'ann').char.stats['ไหวพริบ'] === 0);
  assert.equal(pl.state.scene.title.includes('ท่าเรือนกนางนวล'), true, 'opening scene');
  assert.equal(pl.state.location, 'gull');
  assert.equal(pl.state.goals.win.length, 3);

  // secrets must never reach players
  const json = JSON.stringify(pl.state);
  assert(!json.includes('"secret"'), 'secret key leaked');
  assert(!json.includes('โคมไฟบนยอดประภาคาร'), 'island secret text leaked');
  assert(!json.includes('"events"'), 'event table leaked');
  assert(dm.state.world.islands[0].secret, 'DM sees secrets');
  const unknown = pl.state.world.islands.find((i) => i.id === 'skyend');
  assert(unknown.unknown && !unknown.desc && !unknown.landmarks);
  assert(pl.state.world.npcs.every((n) => n.island === 'gull'), 'only met NPCs');

  // travel: player can't move ship with human DM; DM can
  pl.emit('travel', { islandId: 'dino' });
  await wait(60);
  assert.equal(pl.state.location, 'gull');
  dm.emit('travel', { islandId: 'dino' });
  await wait(60);
  assert.equal(pl.state.location, 'dino');
  assert(pl.state.world.islands.find((i) => i.id === 'dino').landmarks.length > 0, 'visited island revealed');
  assert(pl.state.world.npcs.some((n) => n.id === 'rani'));

  // players can't touch trackers/goals
  pl.emit('tracker', { id: 'heat', delta: 5 });
  pl.emit('goal_toggle', { id: pl.state.goals.win[0].id });
  await wait(60);
  assert.equal(pl.state.trackers.find((t) => t.id === 'heat').value, 0);
  assert(!pl.state.goals.win[0].done);

  // tracker reaching loseAt -> defeat; clear -> continue
  dm.emit('tracker', { id: 'heat', delta: 10 });
  await wait(60);
  assert.equal(pl.state.ending.type, 'lose');
  dm.emit('ending', { type: 'clear' });
  dm.emit('tracker', { id: 'heat', value: 2 });
  await wait(60);
  assert.equal(pl.state.ending, null);

  // all win goals -> victory
  for (const g of dm.state.goals.win) dm.emit('goal_toggle', { id: g.id });
  await wait(80);
  assert.equal(pl.state.ending.type, 'win');
  dm.emit('ending', { type: 'clear' });

  // all crew HP 0 -> defeat
  dm.emit('dm_hp', { playerId: 'ann', delta: -999 });
  await wait(80);
  assert.equal(pl.state.ending.type, 'lose');
  dm.emit('ending', { type: 'clear' });
  dm.emit('dm_hp', { playerId: 'ann', delta: 10 });

  // random event (human DM) logs an event
  dm.emit('random_event');
  await wait(60);
  assert(pl.state.log.some((e) => e.kind === 'event'));

  // custom goals + trackers + AI-written goals while a human is DM
  dm.emit('goal_add', { list: 'lose', text: 'Ship sinks twice' });
  dm.emit('tracker_add', { name: 'Hunger', value: 3, max: 5, loseAt: 'max' });
  await wait(60);
  assert(pl.state.goals.lose.some((g) => g.text === 'Ship sinks twice'));
  assert(pl.state.trackers.some((t) => t.name === 'Hunger' && t.loseAt === 5));
  dm.emit('ai_goals', { idea: 'cats' });
  await wait(120);
  assert.deepEqual(pl.state.goals.win.map((g) => g.text), ['Find the cat', 'Escape']);

  // ---- AI DM: travel triggers arrival scene, AI effects validated ----
  dm.emit('set_dm_mode', { mode: 'ai' });
  await wait(80);
  assert.equal(dm.state.canGM, true, 'host is GM in AI mode');
  assert.equal(pl.state.canGM, false);
  pl.emit('travel', { islandId: 'sand' });
  await wait(150);
  assert.equal(pl.state.location, 'sand');
  assert.equal(pl.state.scene.title, 'Arrival');
  const before = pl.state.trackers.find((t) => t.id === 'pieces').value;
  pl.emit('ai_continue', {});
  await wait(150);
  assert.equal(pl.state.trackers.find((t) => t.id === 'pieces').value, before + 1, 'AI tracker change applied');

  // ---- theme switch to custom ----
  dm.emit('set_theme', { themeId: 'custom', worldName: 'Cat Land' });
  await wait(80);
  assert.equal(pl.state.world.name, 'Cat Land');
  assert.equal(pl.state.world.islands.length, 0);
  assert.equal(pl.state.trackers.length, 0);
  pl.emit('set_theme', { themeId: 'pirate' }); // not host
  await wait(60);
  assert.equal(pl.state.world.name, 'Cat Land');

  console.log('✓ world/theme tests passed');
  dm.disconnect(); pl.disconnect(); server.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
