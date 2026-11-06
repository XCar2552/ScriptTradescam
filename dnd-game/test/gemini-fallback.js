// Gemini retry/fallback logic with a fake fetch.
process.env.GEMINI_API_KEY = 'AIzaTEST';
process.env.GEMINI_MODEL = 'm1,m2,m3';
const assert = require('assert');
const ai = require('../ai');
const ok = (obj) => ({ status: 200, ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }), text: async () => '' });
const err = (status) => ({ status, ok: false, json: async () => ({}), text: async () => '' });
(async () => {
  let calls = [];
  ai._setFetch(async (url) => { const m = url.match(/models\/(.*?):/)[1]; calls.push(m);
    if (m === 'm1') return err(503); if (m === 'm2') return err(429); return ok({ a: 1 }); });
  assert.deepEqual(await ai.gemini('s', 'p'), { a: 1 });
  assert.deepEqual(calls, ['m1', 'm1', 'm2', 'm3'], calls.join());
  calls = [];
  await ai.gemini('s', 'p'); // remembers m3
  assert.deepEqual(calls, ['m3']);
  calls = [];
  ai._setFetch(async (url) => { calls.push(url); return err(400); });
  await assert.rejects(ai.gemini('s', 'p'));
  calls = [];
  ai._setFetch(async () => err(503));
  await assert.rejects(ai.gemini('s', 'p'), (e) => e.code === 'busy');
  console.log('✓ Gemini fallback tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
