// AI DM flow test with a fake Gemini provider (no network, no key needed).
const assert = require('assert');
const { io: connect } = require('socket.io-client');
const ai = require('../ai');
const { server } = require('../server');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (s, ev, data) => new Promise((r) => s.emit(ev, data, r));
let failNext = false;
const prompts = [];
ai.setProvider(async (system, prompt, kind) => {
  prompts.push({ kind, prompt });
  await wait(20);
  if (failNext) { failNext = false; throw new ai.AIError('quota', 'โควตา AI ฟรีเต็มชั่วคราว'); }
  if (kind === 'scene') return { title: 'Haunted Inn', text: 'Ghosts everywhere.' };
  if (kind === 'review') {
    const req = prompt.split('ต้องการ:').pop();
    if (/fly/i.test(req)) return { decision: 'deny', note: 'No wings.', narration: 'You flap uselessly.' };
    if (/open the door/i.test(req)) return { decision: 'auto', note: 'It is unlocked.', narration: 'The door creaks open.' };
    return { decision: 'roll', dc: 99, stat: 'DEX', mode: 'adv', note: 'Careful.' };
  }
  if (kind === 'result') return { narration: 'A ghost scratches you.', hp_changes: [{ name: 'Aria', delta: -4 }, { name: 'Nobody', delta: -9 }] };
  if (kind === 'answer') return { answer: 'Two exits.' };
  return { narration: 'A bell rings.', hp_changes: [] };
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const mk = () => { const s = connect(url, { transports: ['websocket'] }); s.on('state', (st) => (s.state = st)); return s; };
  const host = mk(), p1 = mk();

  const c = await call(host, 'create_room', { name: 'Host', playerId: 'h', dmMode: 'ai' });
  assert(c.ok);
  await call(p1, 'join_room', { code: c.code, name: 'Aria', playerId: 'a' });
  await wait(80);
  assert.equal(host.state.dmMode, 'ai');
  assert.equal(host.state.isDM, false);
  assert.equal(host.state.isHost, true);
  assert(host.state.players.find((p) => p.id === 'h').char, 'host should have a character in AI mode');

  p1.emit('ai_scene', { idea: 'x' }); // not host -> rejected
  host.emit('ai_scene', { idea: 'ghost story' });
  await wait(150);
  assert.equal(p1.state.scene.title, 'Haunted Inn');
  assert.equal(prompts.filter((x) => x.kind === 'scene').length, 1);

  // roll path: AI approves, DC clamped to 40, adv kept
  p1.emit('update_char', { name: 'Aria', maxHp: 20, hp: 20 });
  p1.emit('submit_action', { text: 'Sneak past the ghost' });
  await wait(150);
  let a = p1.state.actions.find((x) => x.text === 'Sneak past the ghost');
  assert.equal(a.status, 'approved');
  assert.equal(a.dc, 20); // AI asked for 99, clamped to the "normal" difficulty max
  assert.equal(a.mode, 'adv');
  p1.emit('roll_action', { actionId: a.id });
  await wait(200);
  a = p1.state.actions.find((x) => x.id === a.id);
  assert.equal(a.status, 'resolved');
  assert.equal(p1.state.players.find((p) => p.id === 'a').char.hp, 16);
  assert(p1.state.log.some((e) => e.kind === 'narrate' && e.text === 'A ghost scratches you.'));

  // deny + auto paths
  host.emit('submit_action', { text: 'Fly away' });
  p1.emit('submit_action', { text: 'Open the door' });
  await wait(200);
  assert.equal(host.state.actions.find((x) => x.text === 'Fly away').status, 'denied');
  assert.equal(p1.state.actions.find((x) => x.text === 'Open the door').outcome, 'auto');

  // question answered automatically
  p1.emit('ask', { text: 'How many exits?' });
  await wait(150);
  assert.equal(p1.state.questions[0].answer, 'Two exits.');

  // failure -> error shown, action stays pending, retry fixes it
  failNext = true;
  p1.emit('submit_action', { text: 'Pick the lock' });
  await wait(150);
  assert(p1.state.aiError.includes('โควตา'));
  assert.equal(p1.state.actions.find((x) => x.text === 'Pick the lock').status, 'pending');
  p1.emit('ai_retry');
  await wait(150);
  assert.equal(p1.state.aiError, '');
  assert.equal(p1.state.actions.find((x) => x.text === 'Pick the lock').status, 'approved');

  p1.emit('ai_continue', { text: 'something spooky' });
  await wait(150);
  assert(p1.state.log.some((e) => e.text === 'A bell rings.'));

  // switch to human DM (player Aria), then back to AI
  p1.emit('set_dm_mode', { mode: 'human', dmId: 'a' }); // not host -> rejected
  await wait(50);
  assert.equal(p1.state.dmMode, 'ai');
  host.emit('set_dm_mode', { mode: 'human', dmId: 'a' });
  await wait(80);
  assert.equal(p1.state.isDM, true);
  assert.equal(host.state.isDM, false);
  const before = prompts.length;
  host.emit('submit_action', { text: 'Climb stairs' });
  await wait(100);
  assert.equal(prompts.length, before, 'AI must not act in human mode');
  assert.equal(p1.state.actions.find((x) => x.text === 'Climb stairs').status, 'pending');
  host.emit('set_dm_mode', { mode: 'ai' });
  await wait(150);
  assert.equal(host.state.dmMode, 'ai');
  assert.equal(host.state.actions.find((x) => x.text === 'Climb stairs').status, 'approved', 'AI should pick up pending actions');

  console.log('✓ AI DM tests passed');
  host.disconnect(); p1.disconnect(); server.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
