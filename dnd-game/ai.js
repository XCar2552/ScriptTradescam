// AI Dungeon Master powered by Google Gemini (free tier works).
// Set GEMINI_API_KEY in the server environment. Optional: GEMINI_MODEL.
// AI_MOCK=1 uses canned answers (for local testing without a key).

// Models are tried in order. If one is overloaded (503), over quota (429) or missing (404),
// the next is used. GEMINI_MODEL can be a comma-separated list to override.
const MODELS = (process.env.GEMINI_MODEL || 'gemini-flash-latest,gemini-flash-lite-latest,gemini-2.5-flash,gemini-2.5-flash-lite')
  .split(',').map((m) => m.trim()).filter(Boolean);
let MODEL = MODELS[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TIMEOUT_MS = 45000;

class AIError extends Error {
  constructor(code, msg) {
    super(msg);
    this.code = code; // 'nokey' | 'quota' | 'model' | 'network' | 'bad_output'
  }
}

function available() {
  return Boolean(process.env.GEMINI_API_KEY) || process.env.AI_MOCK === '1' || Boolean(customProvider);
}

let customProvider = null; // tests can inject (system, prompt, kind) => object
function setProvider(fn) {
  customProvider = fn;
}

async function geminiOnce(model, system, prompt) {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) throw new AIError('nokey', 'ยังไม่ได้ใส่ GEMINI_API_KEY ในเซิร์ฟเวอร์');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.9, maxOutputTokens: 1024 },
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    console.error('Gemini fetch failed:', e.name, e.message, e.cause?.code || e.cause?.message || '');
    if (e.name === 'AbortError') throw new AIError('network', 'Gemini ตอบช้าเกินไป (เกิน 45 วินาที) ลองใหม่อีกครั้ง');
    if (/ByteString|header/i.test(e.message)) throw new AIError('nokey', 'API key มีตัวอักษรแปลกปน — ก๊อป key ใหม่แล้ววางอีกครั้ง');
    throw new AIError('network', `ติดต่อ Gemini ไม่ได้ (${e.cause?.code || e.message})`);
  } finally {
    clearTimeout(t);
  }
  if (res.status === 429) throw new AIError('quota', 'โควตา AI ฟรีเต็มชั่วคราว');
  if (res.status === 404) throw new AIError('model', `ไม่พบโมเดล ${model}`);
  if (res.status >= 500) throw new AIError('busy', `Gemini คนใช้เยอะ ระบบเต็มชั่วคราว (${res.status})`);
  if (res.status === 400 || res.status === 403) {
    const body = await res.text().catch(() => '');
    console.error('Gemini error', res.status, body.slice(0, 300));
    if (/API_KEY|PERMISSION_DENIED|API key/i.test(body)) throw new AIError('nokey', 'API key ไม่ถูกต้องหรือไม่มีสิทธิ์');
    if (/location is not supported|FAILED_PRECONDITION/i.test(body)) throw new AIError('model', 'Gemini ฟรีใช้จากเซิร์ฟเวอร์ภูมิภาคนี้ไม่ได้');
    throw new AIError('bad_output', `Gemini ไม่รับคำขอ (${res.status}) ดู log เซิร์ฟเวอร์`);
  }
  if (!res.ok) throw new AIError('network', `Gemini ตอบกลับผิดพลาด (${res.status})`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  return parseJSON(text);
}

// Try the last model that worked first, retry overloaded models, then fall back.
async function gemini(system, prompt) {
  const order = [MODEL, ...MODELS.filter((m) => m !== MODEL)];
  let lastErr;
  for (const model of order) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const out = await geminiOnce(model, system, prompt);
        if (MODEL !== model) console.log('AI now using model', model);
        MODEL = model;
        return out;
      } catch (e) {
        lastErr = e;
        if (e.code === 'busy' || (e.code === 'network' && /ช้าเกินไป/.test(e.message) === false)) {
          if (attempt === 0) { await sleep(1500); continue; }
        }
        break; // quota / model missing / bad output -> next model; key problems stop below
      }
    }
    if (lastErr?.code === 'nokey') throw lastErr;
  }
  throw lastErr;
}

function parseJSON(text) {
  const s = String(text).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(s);
  } catch {
    const m = s.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { /* fall through */ }
    }
    throw new AIError('bad_output', 'AI ตอบกลับมาในรูปแบบที่อ่านไม่ได้');
  }
}

function mock(kind) {
  switch (kind) {
    case 'scene': return { title: 'ประตูหินโบราณ', text: 'พวกคุณยืนอยู่หน้าประตูหินที่สลักอักษรเรืองแสง ลมเย็นพัดออกมาจากรอยแยก มีเสียงหยดน้ำดังก้องอยู่ข้างใน' };
    case 'review': return { decision: 'roll', dc: 13, stat: '', mode: 'normal', note: 'ลองดู แต่ไม่ง่ายนะ' };
    case 'result': return { narration: 'ผลลัพธ์เป็นไปตามลูกเต๋า เรื่องราวเดินต่อไป...', hp_changes: [], tracker_changes: [{ id: 'bounty', delta: 5 }] };
    case 'answer': return { answer: 'ลองสำรวจรอบๆ ดูก่อน อาจเจอเบาะแส' };
    case 'goals': return { win: ['หาคัมภีร์ที่หายไป', 'กลับถึงบ้านอย่างปลอดภัย'], lose: ['ทุกคน HP 0'] };
    default: return { narration: 'เสียงบางอย่างดังขึ้นจากความมืด... พวกคุณจะทำอย่างไร?' };
  }
}

async function ask(kind, system, prompt) {
  if (customProvider) return customProvider(system, prompt, kind);
  if (process.env.AI_MOCK === '1') return mock(kind);
  return gemini(system, prompt);
}

// ---------- Prompt building ----------
function systemPrompt(room) {
  const s = room.settings;
  const statsLine = s.stats.length
    ? `ค่าสถานะที่ใช้: ${s.stats.join(', ')} (${s.statMode === 'score' ? 'ค่า 1-30 โบนัส=(ค่า-10)/2' : 'ตัวเลขคือโบนัสโดยตรง'})`
    : 'เกมนี้ไม่มีค่าสถานะ';
  return [
    'คุณคือ Dungeon Master (DM) ของเกมเล่นตามบทบาทแนว D&D ที่ใช้ลูกเต๋า D20',
    room.aiDM ? `ชื่อของคุณคือ "${room.aiDM.name}" สไตล์การเล่าเรื่อง: ${room.aiDM.style}${room.aiDM.persona ? `. บุคลิกเพิ่มเติม: ${room.aiDM.persona}` : ''} — เล่าเรื่องด้วยน้ำเสียงนี้เสมอ` : '',
    `ธีม/โลกของเกม: ${s.theme}. รูปแบบกติกา: ${s.preset}. ${statsLine}.`,
    `DC มาตรฐาน: ง่าย 8-10, ปกติ ${s.defaultDC}, ยาก 15-17, ยากมาก 18-20, แทบเป็นไปไม่ได้ 22+.`,
    s.houseRules ? `กติกาเพิ่มเติมของห้อง: ${s.houseRules}` : '',
    'หน้าที่: เล่าเรื่องให้สนุก มีชีวิตชีวา ให้ผู้เล่นมีอิสระ แต่ต้องยุติธรรมและสมเหตุสมผลกับสถานการณ์',
    'ห้ามตัดสินผลลูกเต๋าเอง ระบบจะทอยให้ คุณแค่กำหนด DC และเล่าผลตามผลที่ได้',
    'ตอบเป็นภาษาไทยที่เป็นกันเอง กระชับ (ไม่เกิน 4 ประโยคต่อครั้ง) ห้ามมีเนื้อหาทางเพศหรือรุนแรงเกินเหตุ',
    'ตอบกลับเป็น JSON object เท่านั้น ห้ามมีข้อความอื่นนอก JSON',
  ].filter(Boolean).join('\n');
}

function context(room) {
  const party = Object.values(room.players)
    .filter((p) => p.char && p.id !== room.dmId)
    .map((p) => {
      const c = p.char;
      const st = Object.entries(c.stats || {}).map(([k, v]) => `${k} ${v}`).join(', ');
      return `- ${c.name || p.name}${c.cls ? ` (${c.cls})` : ''} HP ${c.hp}/${c.maxHp}${st ? ` [${st}]` : ''}${c.inventory ? ` ของ: ${c.inventory.slice(0, 120)}` : ''}`;
    })
    .join('\n');
  const recent = room.log
    .filter((e) => e.visibility === 'all')
    .slice(-30)
    .map(logLine)
    .filter(Boolean)
    .join('\n');
  return `${worldContext(room)}ฉากปัจจุบัน: ${room.scene.title}\n${room.scene.text}\n\nปาร์ตี้:\n${party || '(ยังไม่มีผู้เล่น)'}\n\nเหตุการณ์ล่าสุด:\n${recent || '(ยังไม่มี)'}`;
}

// Everything the AI DM needs to know about the world, including DM-only secrets.
function worldContext(room) {
  const w = room.world;
  if (!w) return '';
  const lines = [`=== โลก: ${w.name} (${w.genre}) ===`];
  if (w.lore) lines.push(`ตำนาน: ${w.lore}`);
  const here = w.islands.find((i) => i.id === room.location);
  if (w.islands.length) {
    lines.push(`เส้นทาง: ${w.islands.map((i) => `${i.name}${i.id === room.location ? ' [อยู่ที่นี่]' : room.visited.includes(i.id) ? ' [เคยไป]' : ''}`).join(' → ')}`);
  }
  if (here) {
    lines.push(`สถานที่ปัจจุบัน: ${here.name} (${here.kind}, อันตราย ${here.danger}/5) — ${here.desc}`);
    lines.push(`จุดสำคัญ: ${here.landmarks.map((l) => `${l.name} (${l.desc})`).join('; ')}`);
    const npcs = w.npcs.filter((n) => n.island === here.id);
    if (npcs.length) lines.push(`ตัวละครที่นี่: ${npcs.map((n) => `${n.name} [${n.role === 'villain' ? 'ตัวร้าย' : n.role === 'ally' ? 'พันธมิตร' : 'กลาง'}] ${n.title}: ${n.desc} (ลับ: ${n.secret})`).join(' | ')}`);
    lines.push(`อีเวนต์ที่อาจเกิด: ${here.events.join('; ')}`);
    lines.push(`ความลับของสถานที่ (ห้ามบอกผู้เล่นตรงๆ): ${here.secret}`);
  }
  if (w.powers) lines.push(`ระบบพลัง: ${w.powers.title} — ${w.powers.rule}`);
  if (w.factions?.length) lines.push(`ฝ่ายต่างๆ: ${w.factions.map((f) => `${f.name}: ${f.desc}`).join('; ')}`);
  if (room.trackers.length) lines.push(`มาตรวัด (id: ค่า/สูงสุด): ${room.trackers.map((t) => `${t.id} "${t.name}": ${t.value}/${t.max}${t.loseAt !== undefined ? ` (แพ้เมื่อ=${t.loseAt})` : ''}`).join(', ')}`);
  if (room.goals.win.length) lines.push(`เป้าหมายชนะ (id): ${room.goals.win.map((g) => `${g.id} "${g.text}"${g.done ? ' [สำเร็จแล้ว]' : ''}`).join(', ')}`);
  if (room.goals.lose.length) lines.push(`เงื่อนไขแพ้: ${room.goals.lose.map((g) => g.text).join(', ')}`);
  return `${lines.join('\n')}\n\n`;
}

const EFFECTS_SCHEMA =
  '"tracker_changes": [{"id": "id ของมาตรวัด", "delta": ตัวเลข}], "goals_completed": ["id ของเป้าหมายชนะที่เพิ่งสำเร็จ"]';
const EFFECTS_RULE =
  ' ถ้าเรื่องที่เล่าทำให้มาตรวัดเปลี่ยน (เช่น ได้เศษแผนที่, ทหารเรือตามล่ามากขึ้น, เรือเสียหาย, ค่าหัวขึ้น) ให้ใส่ใน tracker_changes ' +
  'และถ้าเป้าหมายชนะข้อไหนสำเร็จจริงให้ใส่ใน goals_completed (อย่าใส่ถ้ายังไม่สำเร็จจริง) ';

function effects(out) {
  const trackerChanges = Array.isArray(out.tracker_changes)
    ? out.tracker_changes.slice(0, 6).map((t) => ({ id: str(t?.id, 40), delta: clampInt(t?.delta, -10, 10, 0) })).filter((t) => t.id && t.delta)
    : [];
  const goalsCompleted = Array.isArray(out.goals_completed) ? out.goals_completed.slice(0, 5).map((g) => str(g, 20)).filter(Boolean) : [];
  return { hpChanges: hpList(out.hp_changes), trackerChanges, goalsCompleted };
}

function logLine(e) {
  switch (e.kind) {
    case 'scene': return `[ฉาก] ${e.title}: ${e.text}`;
    case 'narrate': return `[DM] ${e.text}`;
    case 'chat': return `[แชท] ${e.name}: ${e.text}`;
    case 'declare': return `[${e.name} ต้องการ] ${e.text}`;
    case 'deny': return `[DM ไม่อนุญาต] ${e.name}: ${e.note}`;
    case 'auto': return `[สำเร็จโดยไม่ทอย] ${e.name}: ${e.text}`;
    case 'check': return `[ทอย] ${e.name} "${e.text}" ได้ ${e.roll.total} vs DC ${e.dc} → ${e.outcome}`;
    default: return '';
  }
}

const OUT = { success: 'สำเร็จ', fail: 'ล้มเหลว', crit_success: 'สำเร็จขั้นสุด (ทอยได้ 20)', crit_fail: 'พลาดขั้นสุด (ทอยได้ 1)' };

// ---------- Public API ----------
async function newScene(room, idea) {
  const out = await ask('scene', systemPrompt(room),
    `${context(room)}\n\n${idea ? `ไอเดียจากผู้เล่น: ${idea}\n` : ''}สร้างฉาก/สถานการณ์${room.log.some((e) => e.kind === 'scene') ? 'ถัดไปที่ต่อเนื่องจากเรื่องเดิม' : 'เปิดเรื่องที่น่าตื่นเต้น'} ` +
    'จบด้วยการชวนให้ผู้เล่นตัดสินใจ ตอบ JSON: {"title": "ชื่อฉากสั้นๆ", "text": "คำบรรยายฉาก"}');
  return { title: str(out.title, 80) || 'ฉากใหม่', text: str(out.text, 2000) };
}

async function reviewAction(room, action) {
  const stats = room.settings.stats;
  const out = await ask('review', systemPrompt(room),
    `${context(room)}\n\nผู้เล่น "${action.playerName}" ต้องการ: "${action.text}"${action.stat ? ` (เสนอใช้ ${action.stat})` : ''}\n` +
    'ตัดสินว่า: "deny" = เป็นไปไม่ได้ในสถานการณ์นี้, "auto" = ทำได้แน่นอนไม่ต้องทอย (เรื่องง่ายหรือไม่มีความเสี่ยง), "roll" = มีโอกาสพลาด ต้องทอย D20\n' +
    `ตอบ JSON: {"decision": "roll|auto|deny", "dc": ตัวเลข 5-25, "stat": ${stats.length ? `หนึ่งใน ${JSON.stringify(stats)} หรือ ""` : '""'}, ` +
    `"mode": "normal|adv|dis", "note": "เหตุผลหรือคำใบ้สั้นๆ ถึงผู้เล่น", "narration": "ถ้า auto หรือ deny ให้เล่าว่าเกิดอะไรขึ้น ไม่งั้นเว้นว่าง"}`);
  const decision = ['roll', 'auto', 'deny'].includes(out.decision) ? out.decision : 'roll';
  return {
    decision,
    dc: clampInt(out.dc, 1, 40, room.settings.defaultDC),
    stat: stats.includes(out.stat) ? out.stat : action.stat || '',
    mode: room.settings.allowAdvantage && ['adv', 'dis'].includes(out.mode) ? out.mode : 'normal',
    note: str(out.note, 600),
    narration: str(out.narration, 600),
  };
}

async function narrateResult(room, action) {
  const out = await ask('result', systemPrompt(room),
    `${context(room)}\n\n"${action.playerName}" พยายาม: "${action.text}" ทอยได้ ${action.roll.total} (ลูกเต๋า ${action.roll.natural ?? action.roll.kept}) vs DC ${action.dc} ผลคือ: ${OUT[action.outcome]}\n` +
    'เล่าผลที่เกิดขึ้นให้ตรงกับผลลูกเต๋า (สำเร็จขั้นสุดให้ผลดีเกินคาด, พลาดขั้นสุดให้เกิดเรื่องวุ่น) ถ้ามีคนบาดเจ็บหรือฟื้นพลังให้ใส่ใน hp_changes' +
    EFFECTS_RULE +
    `ตอบ JSON: {"narration": "คำบรรยาย", "hp_changes": [{"name": "ชื่อตัวละคร", "delta": ตัวเลข -20 ถึง 20}], ${EFFECTS_SCHEMA}}`);
  return { narration: str(out.narration, 800) || '...', ...effects(out) };
}

async function answerQuestion(room, q) {
  const out = await ask('answer', systemPrompt(room),
    `${context(room)}\n\nผู้เล่น "${q.name}" ถาม DM ว่า: "${q.text}"\nตอบตามสถานการณ์และกติกา ห้ามเฉลยความลับสำคัญเกินไป ตอบ JSON: {"answer": "คำตอบ"}`);
  return str(out.answer, 800) || 'DM ขอคิดก่อนนะ...';
}

async function continueStory(room, request) {
  const out = await ask('continue', systemPrompt(room),
    `${context(room)}\n\n${request ? `ผู้เล่นขอว่า: ${request}\n` : ''}เล่าเหตุการณ์ต่อไปสั้นๆ ให้เรื่องเดินหน้า (เช่น มีคนโผล่มา เกิดเสียง เจอเบาะแส) แล้วถามว่าผู้เล่นจะทำอะไร ` +
    EFFECTS_RULE +
    `ตอบ JSON: {"narration": "คำบรรยาย", "hp_changes": [], ${EFFECTS_SCHEMA}}`);
  return { narration: str(out.narration, 800) || '...', ...effects(out) };
}

async function writeGoals(room, idea) {
  const out = await ask('goals', systemPrompt(room),
    `${context(room)}\n\n${idea ? `ไอเดียจากผู้เล่น: ${idea}\n` : ''}เขียนเป้าหมายของเกมนี้ให้ชัดเจนและวัดผลได้: เป้าหมายชนะ 2-4 ข้อ (ต้องทำครบทุกข้อถึงชนะ) และเงื่อนไขแพ้ 2-3 ข้อ ` +
    'ตอบ JSON: {"win": ["เป้าหมาย 1", "..."], "lose": ["เงื่อนไขแพ้ 1", "..."]}');
  const list = (v, n) => (Array.isArray(v) ? v.map((x) => str(x, 200)).filter(Boolean).slice(0, n) : []);
  const g = { win: list(out.win, 5), lose: list(out.lose, 4) };
  if (!g.win.length) throw new AIError('bad_output', 'AI เขียนเป้าหมายไม่สำเร็จ ลองใหม่อีกครั้ง');
  return g;
}

function hpList(v) {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 8).map((h) => ({ name: str(h?.name, 40), delta: clampInt(h?.delta, -20, 20, 0) })).filter((h) => h.name && h.delta);
}
const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
function clampInt(v, min, max, def) {
  const x = Math.round(Number(v));
  return Number.isFinite(x) ? Math.max(min, Math.min(max, x)) : def;
}

// Quick self-test for the /ai-check page. Never returns the key itself.
let lastCheck = 0;
async function check() {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  const info = {
    keySet: Boolean(key),
    keyStartsWithAIza: key.startsWith('AIza'),
    keyLength: key.length,
    model: MODEL,
    fallbackModels: MODELS,
    nodeVersion: process.version,
  };
  if (!key) return { ...info, ok: false, error: 'ยังไม่ได้ใส่ GEMINI_API_KEY ใน Render → Environment' };
  if (Date.now() - lastCheck < 10000) return { ...info, ok: false, error: 'รอ 10 วินาทีแล้วรีเฟรชใหม่' };
  lastCheck = Date.now();
  try {
    const out = await gemini('ตอบเป็น JSON เท่านั้น', 'ตอบ {"reply": "สวัสดี"}');
    return { ...info, ok: true, usedModel: MODEL, reply: out };
  } catch (e) {
    return { ...info, ok: false, error: e.message };
  }
}

module.exports = {
  check, available, setProvider, writeGoals, newScene, reviewAction, narrateResult, answerQuestion, continueStory, AIError, gemini, _setFetch: (f) => (global.fetch = f) };
