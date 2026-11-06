// Battle board: tokens, movement rules, turns, enemy HP, AI encounter and AI enemy turns.
const assert = require('assert');
const { io: connect } = require('socket.io-client');
const ai = require('../ai');
const { server } = require('../server');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (s, ev, data) => new Promise((r) => s.emit(ev, data, r));
const prompts = [];
ai.setProvider(async (system, prompt, kind) => {
  prompts.push({ kind, prompt });
  if (kind === 'encounter') return { terrain: 'reef', enemies: [{ type: 'shark', name: 'ฉลามฟันเลื่อย' }, { type: 'nope' }, { type: 'crab' }], objects: ['coral', 'lava'], intro: 'น้ำแตกกระจาย!' };
  if (kind === 'review') return { decision: 'roll', dc: 2 };
  if (/ถึงตาของศัตรู/.test(prompt)) return { narration: 'It bites!', hp_changes: [{ name: 'Ann', delta: -3 }] };
  return { narration: 'Slash!', enemy_hp_changes: [{ name: 'ฉลามฟันเลื่อย', delta: -99 }] };
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const mk = () => { const s = connect(url, { transports: ['websocket'] }); s.toasts = []; s.on('state', (st) => (s.state = st)); s.on('toast', (t) => s.toasts.push(t.msg)); return s; };
  const dm = mk(), ann = mk(), bo = mk();
  const c = await call(dm, 'create_room', { name: 'DM', playerId: 'dm', themeId: 'pirate' });
  await call(ann, 'join_room', { code: c.code, name: 'Ann', playerId: 'ann' });
  await call(bo, 'join_room', { code: c.code, name: 'Bo', playerId: 'bo' });
  await wait(60);

  ann.emit('board_start', {}); // not GM
  await wait(40);
  assert.equal(ann.state.board, null);
  dm.emit('board_start', {});
  await wait(60);
  const b = () => ann.state.board;
  assert.equal(b().terrain, 'deck', 'terrain from island (gull)');
  assert.equal(b().tokens.filter((t) => t.kind === 'player').length, 2, 'one token per player, none for DM');
  assert(b().tokens.every((t) => t.y >= 8), 'players start at the bottom');

  // late joiner gets a token too, everyone sees the same board
  const cy = mk();
  await call(cy, 'join_room', { code: c.code, name: 'Cy', playerId: 'cy' });
  await wait(60);
  assert.equal(bo.state.board.tokens.filter((t) => t.kind === 'player').length, 3);

  // DM places things
  dm.emit('board_add', { kind: 'enemy', type: 'skeleton', x: 3, y: 2 });
  dm.emit('board_add', { kind: 'enemy', type: 'skeleton', x: 4, y: 2 });
  dm.emit('board_add', { kind: 'object', type: 'rock', x: 0, y: 5 });
  dm.emit('board_add', { kind: 'enemy', type: 'dragonz' });
  ann.emit('board_add', { kind: 'enemy', type: 'boss' });
  await wait(60);
  const skel = b().tokens.filter((t) => t.sprite === 'skeleton');
  assert.deepEqual(skel.map((t) => t.name), ['โครงกระดูก', 'โครงกระดูก 2'], 'unique names');
  assert(!b().tokens.some((t) => t.sprite === 'boss'));

  // movement rules
  const mine = () => b().tokens.find((t) => t.ref === 'ann');
  const start = { ...mine() };
  ann.emit('board_move', { tokenId: mine().id, x: 0, y: 5 }); // rock
  ann.emit('board_move', { tokenId: b().tokens.find((t) => t.ref === 'bo').id, x: 1, y: 1 }); // not mine
  ann.emit('board_move', { tokenId: mine().id, x: start.x, y: 0 }); // too far
  await wait(60);
  assert.deepEqual([mine().x, mine().y], [start.x, start.y]);
  ann.emit('board_move', { tokenId: mine().id, x: 2, y: 4 });
  await wait(60);
  if (Math.max(Math.abs(start.x - 2), Math.abs(start.y - 4)) <= 6) assert.deepEqual([mine().x, mine().y], [2, 4]);

  // turns: only the current token's owner may move / end turn
  dm.emit('board_initiative');
  await wait(60);
  assert.equal(b().order.length, 5);
  assert.equal(b().round, 1);
  const cur = () => b().tokens.find((t) => t.id === b().order[b().turn]);
  const owner = { ann, bo, cy };
  for (let i = 0; i < 6; i++) {
    const t = cur();
    if (t.kind === 'player') {
      const others = Object.entries(owner).filter(([k]) => k !== t.ref).map(([, s]) => s);
      others[0].emit('board_next');
      await wait(40);
      assert.equal(cur().id, t.id, 'others cannot end your turn');
      owner[t.ref].emit('board_next');
    } else dm.emit('board_next');
    await wait(50);
  }
  assert(b().round >= 2, 'rounds advance');

  // enemy HP + defeat
  const s2 = b().tokens.find((t) => t.name === 'โครงกระดูก 2');
  dm.emit('board_hp', { tokenId: s2.id, delta: -3 });
  await wait(40);
  assert.equal(b().tokens.find((t) => t.id === s2.id).hp, 5);
  dm.emit('board_hp', { tokenId: s2.id, delta: -99 });
  await wait(40);
  assert(!b().tokens.some((t) => t.id === s2.id));
  assert(!b().order.includes(s2.id));

  // ---- AI mode: encounter + attack + enemy turn ----
  dm.emit('board_end');
  await wait(40);
  assert.equal(b(), null);
  dm.emit('set_dm_mode', { mode: 'ai' });
  await wait(40);
  ann.emit('update_char', { name: 'Ann', maxHp: 20, hp: 20 });
  dm.emit('ai_encounter', { idea: 'sea' });
  await wait(150);
  assert.equal(b().terrain, 'reef');
  assert.deepEqual(b().tokens.filter((t) => t.kind === 'enemy').map((t) => t.sprite).sort(), ['crab', 'shark'], 'invalid AI picks dropped');
  assert(b().tokens.some((t) => t.sprite === 'coral') && !b().tokens.some((t) => t.sprite === 'lava'));
  assert(ann.state.log.some((e) => e.text === 'น้ำแตกกระจาย!'));
  assert(prompts.at(-1).prompt.includes('shark=ฉลามยักษ์'), 'AI sees the catalog');

  // attack with a target -> AI narration kills the shark
  const shark = b().tokens.find((t) => t.sprite === 'shark');
  ann.emit('submit_action', { text: 'ฟันฉลาม', targetId: shark.id });
  await wait(120);
  const act = ann.state.actions.find((a) => a.text === 'ฟันฉลาม');
  assert.equal(act.targetName, 'ฉลามฟันเลื่อย');
  ann.emit('roll_action', { actionId: act.id });
  await wait(150);
  assert(!b().tokens.some((t) => t.sprite === 'shark'), 'AI enemy_hp_changes applied');

  // enemy turn: crab walks to the nearest player and the AI narrates the attack
  owner.dm = dm; // in AI mode the former DM is a crew member with a token
  dm.emit('board_initiative');
  await wait(60);
  for (let i = 0; i < 8 && cur()?.kind !== 'enemy'; i++) {
    const t = cur();
    owner[t.ref].emit('board_next');
    await wait(200);
  }
  await wait(300);
  assert(ann.state.log.some((e) => e.text === 'It bites!'), 'AI enemy turn narrated');
  assert.notEqual(cur()?.kind, 'enemy', 'turn passes back to the crew');

  console.log('✓ board tests passed');
  [dm, ann, bo, cy].forEach((s) => s.disconnect()); server.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
