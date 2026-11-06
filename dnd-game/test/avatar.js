// Avatars (pixel/photo), avatar sync, DM profile, AI DM profile + persona in prompt.
const assert = require('assert');
const { io: connect } = require('socket.io-client');
const ai = require('../ai');
const { server } = require('../server');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (s, ev, data) => new Promise((r) => s.emit(ev, data, r));
let lastSystem = '';
ai.setProvider(async (system) => { lastSystem = system; return { title: 't', text: 'x' }; });

(async () => {
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const mk = () => {
    const s = connect(url, { transports: ['websocket'] });
    s.av = {}; s.toasts = [];
    s.on('state', (st) => (s.state = st));
    s.on('avatars', (m) => Object.assign(s.av, m));
    s.on('avatar', ({ id, avatar }) => (s.av[id] = avatar));
    s.on('toast', (t) => s.toasts.push(t.msg));
    return s;
  };
  const dm = mk(), pl = mk();
  const c = await call(dm, 'create_room', { name: 'DM', playerId: 'dm', themeId: 'pirate' });
  await call(pl, 'join_room', { code: c.code, name: 'Ann', playerId: 'ann' });
  await wait(60);

  // pixel avatar: valid parts kept, junk dropped
  pl.emit('set_avatar', { avatar: { type: 'pixel', hair: 'หัวโล้น', hat: 'โจรสลัด', skin: '#ffe0c2', bg: 'url(evil)', extra: 'x' } });
  await wait(60);
  assert.deepEqual(dm.av.ann, { type: 'pixel', hair: 'หัวโล้น', hat: 'โจรสลัด', skin: '#ffe0c2' });
  assert.equal(dm.state.players.find((p) => p.id === 'ann').avatarRev, 1);
  assert(!JSON.stringify(dm.state).includes('"type":"pixel"') && !('avatars' in dm.state), 'avatars are not inside the state payload');

  // photo avatar: valid data URL ok, script / huge rejected
  const tiny = 'data:image/jpeg;base64,' + Buffer.from('fakejpeg').toString('base64');
  dm.emit('set_avatar', { avatar: { type: 'photo', data: tiny } });
  pl.emit('set_avatar', { avatar: { type: 'photo', data: 'javascript:alert(1)' } });
  pl.emit('set_avatar', { avatar: { type: 'photo', data: 'data:image/png;base64,' + 'A'.repeat(90000) } });
  await wait(60);
  assert.equal(pl.av.dm.data, tiny);
  assert.equal(dm.av.ann.type, 'pixel', 'bad photos rejected');
  assert.equal(pl.toasts.filter((t) => t.includes('รูปนี้ใช้ไม่ได้')).length, 2);

  // only host can style the AI DM
  pl.emit('set_avatar', { target: 'ai', avatar: { type: 'pixel', hat: 'มงกุฎ' } });
  await wait(40);
  assert(!dm.av.ai);
  dm.emit('set_avatar', { target: 'ai', avatar: { type: 'pixel', hat: 'พ่อมด' } });
  await wait(40);
  assert.equal(pl.av.ai.hat, 'พ่อมด');

  // late joiner receives all avatars
  const late = mk();
  await call(late, 'join_room', { code: c.code, name: 'Bo', playerId: 'bo' });
  await wait(60);
  assert(late.av.ann && late.av.dm && late.av.ai);

  // human DM profile title
  pl.emit('dm_profile', { title: 'hacker' });
  dm.emit('dm_profile', { title: 'ผู้คุมทะเลพันเกาะ' });
  await wait(40);
  assert.equal(pl.state.players.find((p) => p.id === 'dm').dmTitle, 'ผู้คุมทะเลพันเกาะ');

  // AI DM profile -> persona reaches the AI system prompt
  pl.emit('ai_profile', { name: 'Hacked' });
  dm.emit('ai_profile', { name: 'ปู่หมึก', style: 'ตลก กวนๆ', persona: 'ลงท้ายด้วย ฮึ่ม' });
  dm.emit('ai_profile', { style: 'not-a-style' });
  await wait(40);
  assert.deepEqual(pl.state.aiDM, { name: 'ปู่หมึก', style: 'ตลก กวนๆ', persona: 'ลงท้ายด้วย ฮึ่ม' });
  dm.emit('set_dm_mode', { mode: 'ai' });
  await wait(40);
  dm.emit('ai_scene', {});
  await wait(100);
  assert(lastSystem.includes('ปู่หมึก') && lastSystem.includes('ตลก กวนๆ') && lastSystem.includes('ฮึ่ม'), 'persona in prompt');

  console.log('✓ avatar/profile tests passed');
  [dm, pl, late].forEach((s) => s.disconnect()); server.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
