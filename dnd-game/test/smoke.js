// End-to-end smoke test: DM + 2 players run through the full action flow.
const assert = require('assert');
const { io: connect } = require('socket.io-client');
const { server, rollDice } = require('../server');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (s, ev, data) => new Promise((r) => s.emit(ev, data, r));

(async () => {
  // dice sanity
  for (let i = 0; i < 2000; i++) {
    const r = rollDice({ sides: 20, mode: 'adv' });
    assert(r.kept === Math.max(...r.dice) && r.kept >= 1 && r.kept <= 20);
  }

  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const mk = () => {
    const s = connect(url, { transports: ['websocket'] });
    s.state = null;
    s.on('state', (st) => (s.state = st));
    return s;
  };
  const dm = mk(), p1 = mk(), p2 = mk();

  const c = await call(dm, 'create_room', { name: 'DM Beyond', playerId: 'dm1', preset: 'classic' });
  assert(c.ok && c.code.length === 5);
  assert((await call(p1, 'join_room', { code: c.code, name: 'Aria', playerId: 'p1' })).ok);
  assert((await call(p2, 'join_room', { code: c.code.toLowerCase(), name: 'Bo', playerId: 'p2' })).ok);
  assert(!(await call(p2, 'join_room', { code: 'ZZZZZ', name: 'x', playerId: 'p3' })).ok);
  await wait(100);
  assert.equal(dm.state.players.length, 3);
  assert(dm.state.isDM && !p1.state.isDM);

  // player sets stats; non-DM cannot change settings
  p1.emit('update_char', { name: 'Aria the Bold', stats: { DEX: 16 }, maxHp: 20, hp: 20 });
  p1.emit('update_settings', { defaultDC: 5 });
  dm.emit('set_scene', { title: 'Dragon Cave', text: 'A sleeping dragon.' });
  await wait(100);
  assert.equal(p1.state.settings.defaultDC, 12);
  assert.equal(p2.state.scene.title, 'Dragon Cave');

  // declare -> other player can't see pending
  p1.emit('submit_action', { text: 'Sneak past the dragon', stat: 'DEX' });
  p2.emit('submit_action', { text: 'Fly to the moon' });
  await wait(100);
  assert.equal(dm.state.actions.filter((a) => a.status === 'pending').length, 2);
  assert.equal(p2.state.actions.filter((a) => a.playerId === 'p1').length, 0);

  // DM approves one with hidden DC, denies the other
  const a1 = dm.state.actions.find((a) => a.playerId === 'p1');
  const a2 = dm.state.actions.find((a) => a.playerId === 'p2');
  dm.emit('review_action', { actionId: a1.id, decision: 'approve', dc: 15, stat: 'DEX', mode: 'adv', hiddenDC: true });
  dm.emit('review_action', { actionId: a2.id, decision: 'deny', note: 'You cannot fly.' });
  await wait(100);
  assert.equal(p1.state.actions.find((a) => a.id === a1.id).dc, null, 'hidden DC leaked');
  assert.equal(p2.state.actions.find((a) => a.id === a2.id).status, 'denied');

  // p2 cannot roll p1's action; p1 can
  p2.emit('roll_action', { actionId: a1.id });
  await wait(80);
  assert.equal(dm.state.actions.find((a) => a.id === a1.id).status, 'approved');
  let diceEvt = null;
  p2.once('dice', (d) => (diceEvt = d));
  p1.emit('roll_action', { actionId: a1.id });
  await wait(100);
  const rolled = dm.state.actions.find((a) => a.id === a1.id);
  assert.equal(rolled.status, 'rolled');
  assert.equal(rolled.roll.mod, 3); // DEX 16 -> +3
  assert.equal(rolled.roll.dice.length, 2);
  assert(diceEvt && diceEvt.outcome === rolled.outcome);
  dm.emit('resolve_action', { actionId: a1.id, narration: 'The dragon snores on.' });

  // hidden DM roll invisible to players
  dm.emit('free_roll', { sides: 6, count: 3, hidden: true, label: 'ambush' });
  p1.emit('free_roll', { sides: 8, count: 2, mod: 1 });
  // Q&A
  p1.emit('ask', { text: 'How many exits?', private: true });
  await wait(100);
  assert(dm.state.log.some((e) => e.kind === 'roll' && e.visibility === 'dm'));
  assert(!p1.state.log.some((e) => e.visibility === 'dm'));
  assert(!p2.state.questions.length, 'private question leaked');
  dm.emit('answer', { questionId: dm.state.questions[0].id, text: 'Two.' });
  dm.emit('dm_hp', { playerId: 'p1', delta: -7 });
  await wait(100);
  assert.equal(p1.state.questions[0].answer, 'Two.');
  assert.equal(p1.state.players.find((p) => p.id === 'p1').char.hp, 13);

  // switch to custom preset with own stats; reconnect keeps identity
  dm.emit('update_settings', { preset: 'custom' });
  await wait(50);
  dm.emit('update_settings', { stats: ['Hack', 'Charm'], requireApproval: false });
  await wait(100);
  assert.deepEqual(p1.state.settings.stats, ['Hack', 'Charm']);
  p2.emit('submit_action', { text: 'Hack the door', stat: 'Hack' });
  await wait(80);
  assert.equal(p2.state.actions.find((a) => a.text === 'Hack the door').status, 'approved');

  p1.disconnect();
  await wait(80);
  assert.equal(dm.state.players.find((p) => p.id === 'p1').connected, false);
  const p1b = mk();
  assert((await call(p1b, 'join_room', { code: c.code, name: 'Aria', playerId: 'p1' })).ok);
  await wait(80);
  assert.equal(dm.state.players.length, 3);
  assert.equal(p1b.state.players.find((p) => p.id === 'p1').char.name, 'Aria the Bold');

  console.log('✓ all smoke tests passed');
  [dm, p2, p1b].forEach((s) => s.disconnect());
  server.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
