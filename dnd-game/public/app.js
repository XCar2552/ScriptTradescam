/* D20 Tavern — client */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };

  const OUTCOME = {
    success: 'สำเร็จ',
    fail: 'ล้มเหลว',
    crit_success: 'สำเร็จขั้นสุด! ✨',
    crit_fail: 'พลาดขั้นสุด! 💀',
    auto: 'สำเร็จ (ไม่ต้องทอย)',
  };
  const STATUS = {
    pending: 'รอ DM พิจารณา',
    approved: 'อนุมัติ — รอทอย',
    rolled: 'ทอยแล้ว — รอ DM เล่าผล',
    denied: 'ทำไม่ได้',
    resolved: 'จบแล้ว',
    cancelled: 'ยกเลิก',
  };
  const MODE = { normal: '', adv: 'ได้เปรียบ', dis: 'เสียเปรียบ' };

  let playerId = store.get('d20.pid');
  if (!playerId) {
    playerId = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
    store.set('d20.pid', playerId);
  }

  const socket = io();
  let S = null; // latest state from server
  let tab = 'story';
  const drafts = {}; // DM review inputs per action, survive re-renders
  let seenQuestions = 0;

  // ---------- helpers ----------
  function toast(msg, type = '') {
    const t = $('#toast');
    t.textContent = msg;
    t.className = `toast ${type}`;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.add('hidden'), 2600);
  }
  const emit = (ev, data) => new Promise((res) => socket.emit(ev, data, (r) => res(r || {})));
  const me = () => S?.players.find((p) => p.id === S.you);
  const modOf = (char, stat) => {
    if (!stat || !char) return 0;
    const v = char.stats?.[stat] ?? 0;
    return S.settings.statMode === 'score' ? Math.floor((v - 10) / 2) : v;
  };
  const sign = (n) => (n >= 0 ? `+${n}` : `${n}`);

  // Re-render a container without losing focus/caret on the field being edited.
  function patch(el, html) {
    const a = document.activeElement;
    const key = a && el.contains(a) ? a.dataset.key : null;
    const sel = key && 'selectionStart' in a ? [a.selectionStart, a.selectionEnd] : null;
    el.innerHTML = html;
    if (key) {
      const n = el.querySelector(`[data-key="${CSS.escape(key)}"]`);
      if (n) {
        n.focus();
        if (sel) try { n.setSelectionRange(...sel); } catch { /* number inputs */ }
      }
    }
  }

  // ---------- home ----------
  $('#nameInput').value = store.get('d20.name') || '';
  const lastRoom = store.get('d20.room');
  if (lastRoom) {
    $('#resumeBox').classList.remove('hidden');
    $('#resumeCode').textContent = lastRoom;
  }
  const urlCode = new URLSearchParams(location.search).get('room');
  if (urlCode) $('#codeInput').value = urlCode.toUpperCase();

  function getName() {
    const n = $('#nameInput').value.trim();
    if (!n) { toast('ใส่ชื่อก่อนนะ', 'error'); $('#nameInput').focus(); return null; }
    store.set('d20.name', n);
    return n;
  }
  function enter(r) {
    if (!r.ok) return toast(r.msg || 'เข้าห้องไม่ได้', 'error');
    store.set('d20.room', r.code);
    history.replaceState(null, '', `?room=${r.code}`);
    $('#home').classList.remove('active');
    $('#game').classList.add('active');
  }
  fetch('/config').then((r) => r.json()).then((c) => {
    if (!c.aiAvailable) {
      $('#dmModeInput option[value="ai"]').disabled = true;
      $('#aiOffHint').classList.remove('hidden');
    }
  }).catch(() => {});
  $('#createBtn').onclick = async () => {
    const name = getName();
    if (name) enter(await emit('create_room', { name, playerId, preset: $('#presetInput').value, dmMode: $('#dmModeInput').value }));
  };
  $('#joinBtn').onclick = async () => {
    const name = getName();
    const code = $('#codeInput').value.trim().toUpperCase();
    if (!name) return;
    if (!code) return toast('ใส่รหัสห้องก่อน', 'error');
    enter(await emit('join_room', { code, name, playerId }));
  };
  $('#resumeBtn').onclick = async () => {
    const r = await emit('join_room', { code: lastRoom, name: store.get('d20.name') || '', playerId });
    if (!r.ok) { store.del('d20.room'); $('#resumeBox').classList.add('hidden'); }
    enter(r);
  };
  $('#leaveBtn').onclick = () => {
    if (!confirm('ออกจากห้อง? (กลับเข้ามาได้ด้วยรหัสเดิม)')) return;
    socket.emit('leave_room');
    store.del('d20.room');
    history.replaceState(null, '', location.pathname);
    location.reload();
  };
  $('#codeChip').onclick = async () => {
    const link = `${location.origin}${location.pathname}?room=${S.code}`;
    try {
      if (navigator.share) await navigator.share({ title: 'D20 Tavern', text: `มาผจญภัยกัน! รหัสห้อง ${S.code}`, url: link });
      else { await navigator.clipboard.writeText(link); toast('คัดลอกลิงก์ห้องแล้ว'); }
    } catch { /* user cancelled */ }
  };

  // Auto-rejoin after reconnect / refresh
  socket.on('connect', async () => {
    const code = store.get('d20.room');
    if (code && $('#game').classList.contains('active')) {
      const r = await emit('join_room', { code, name: store.get('d20.name') || '', playerId });
      if (!r.ok) { toast('ห้องนี้ไม่มีแล้ว', 'error'); store.del('d20.room'); setTimeout(() => location.reload(), 1200); }
    }
  });
  socket.on('disconnect', () => toast('หลุดการเชื่อมต่อ... กำลังต่อใหม่', 'error'));
  socket.on('toast', (t) => toast(t.msg, t.type));
  socket.on('kicked', () => { store.del('d20.room'); alert('คุณถูกเชิญออกจากห้อง'); location.href = location.pathname; });

  // ---------- tabs ----------
  $$('#tabs button').forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
  function setTab(t) {
    tab = t;
    $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    $$('.pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === t));
    if (t === 'ask') seenQuestions = S?.questions.length || 0;
    if (t === 'dm') fillSettings(true);
    if (t === 'dm' && S && !S.isHost && !S.isDM) return setTab('story');
    if (t === 'char') charFilled = false;
    render();
    if (t === 'story') scrollLog();
  }

  // ---------- state ----------
  socket.on('state', (state) => {
    const firstOrPresetChange = !S || S.settings.preset !== state.settings.preset || S.settings.stats.join() !== state.settings.stats.join();
    S = state;
    if (firstOrPresetChange) charFilled = false;
    render();
  });

  function render() {
    if (!S) return;
    const aiMode = S.dmMode === 'ai';
    document.body.classList.toggle('is-dm', S.isDM);
    document.body.classList.toggle('is-host', S.isHost);
    document.body.classList.toggle('ai-mode', aiMode);
    if (tab === 'dm' && !S.isHost && !S.isDM) setTab('story');
    $('#roomCode').textContent = S.code;
    $('#themeChip').textContent = `${aiMode ? '🤖 AI DM · ' : ''}${S.presets[S.settings.preset]} · ${S.settings.theme}`;
    $('#dmTabIcon').textContent = S.isDM ? '👑' : '⚙️';
    $('#dmTabLabel').textContent = S.isDM ? 'DM' : 'ห้อง';
    const role = $('#roleChip');
    role.textContent = S.isDM ? '👑 DM' : `🧙 ${me()?.char?.name || me()?.name || ''}`;
    role.classList.toggle('dm', S.isDM);

    renderStory();
    renderActions();
    renderChar();
    renderDice();
    renderAsk();
    renderAI();
    fillSettings(false);
  }

  // ---------- AI DM ----------
  function renderAI() {
    const st = $('#aiStatus');
    st.textContent = S.aiBusy ? 'AI DM กำลังคิด...' : S.aiError ? `⚠️ ${S.aiError}` : '🤖 AI เป็น DM';
    st.classList.toggle('busy', S.aiBusy);
    $('#aiRetry').classList.toggle('hidden', !S.aiError || S.aiBusy);
    $('#aiContinue').disabled = S.aiBusy;
    $('#aiSceneBtn').disabled = S.aiBusy;
    const dmName = S.players.find((p) => p.id === S.dmId);
    $('#modeNow').innerHTML = S.dmMode === 'ai'
      ? 'ตอนนี้: <b>🤖 AI เป็น DM</b> (ทุกคนเป็นผู้เล่น)'
      : `ตอนนี้: <b>👑 ${esc(dmName?.char?.name || dmName?.name || '-')}</b> เป็น DM`;
    $('#toAI').disabled = !S.aiAvailable;
    $('#toAIHint').textContent = S.aiAvailable ? 'DM คนปัจจุบันจะกลายเป็นผู้เล่น' : 'AI ยังไม่พร้อม: เซิร์ฟเวอร์ยังไม่มี GEMINI_API_KEY';
    const pick = $('#dmPick');
    if (document.activeElement !== pick) {
      const v = pick.value || S.hostId;
      pick.innerHTML = S.players.map((p) => `<option value="${p.id}">${esc(p.char?.name || p.name)}${p.id === S.you ? ' (ฉัน)' : ''}</option>`).join('');
      pick.value = S.players.some((p) => p.id === v) ? v : S.you;
    }
  }
  $('#aiContinue').onclick = () => socket.emit('ai_continue', { text: $('#chatInput').value.trim() }, () => ($('#chatInput').value = ''));
  $('#aiRetry').onclick = () => socket.emit('ai_retry');
  $('#aiSceneBtn').onclick = () => {
    socket.emit('ai_scene', { idea: $('#aiIdea').value.trim() });
    $('#aiIdea').value = '';
    toast('AI กำลังสร้างฉาก...');
    setTab('story');
  };
  $('#toAI').onclick = () => { if (confirm('ให้ AI เป็น DM แทน?')) socket.emit('set_dm_mode', { mode: 'ai' }); };
  $('#toHuman').onclick = () => socket.emit('set_dm_mode', { mode: 'human', dmId: $('#dmPick').value });

  // ---------- story / log ----------
  function rollLine(r) {
    if (!r) return '';
    const kept = r.dice.length === 2 && r.mode !== 'normal'
      ? `[${r.dice.map((x) => (x === r.kept ? `<b>${x}</b>` : `<s>${x}</s>`)).join(', ')}]`
      : `[${r.dice.join(', ')}]`;
    return `<span class="dice-line">${r.count}d${r.sides}${MODE[r.mode] ? ` (${MODE[r.mode]})` : ''} ${kept}${r.mod ? ` ${sign(r.mod)}` : ''} = <b>${r.total}</b></span>`;
  }
  const dmLabel = () => (S?.dmMode === 'ai' ? '🤖 AI DM' : 'DM');
  function entryHTML(e) {
    switch (e.kind) {
      case 'system': return `<div class="entry system">${esc(e.text)}</div>`;
      case 'scene': return `<div class="entry scene-log">🎬 <b>ฉากใหม่: ${esc(e.title)}</b><div>${esc(e.text)}</div></div>`;
      case 'narrate': return `<div class="entry narrate">🗣️ ${esc(e.text)}</div>`;
      case 'chat': return `<div class="entry"><span class="who">${esc(e.name)}:</span> ${esc(e.text)}</div>`;
      case 'declare': return `<div class="entry"><span class="who">${esc(e.name)}</span> ต้องการ: “${esc(e.text)}”</div>`;
      case 'deny': return `<div class="entry deny">🚫 ${dmLabel()}: <b>${esc(e.name)}</b> ทำ “${esc(e.text)}” ไม่ได้<div class="note">${esc(e.note)}</div></div>`;
      case 'auto': return `<div class="entry auto">✅ <b>${esc(e.name)}</b> ทำ “${esc(e.text)}” ได้เลย ไม่ต้องทอย${e.note ? `<div class="note">${esc(e.note)}</div>` : ''}</div>`;
      case 'approve': return `<div class="entry approve">🎯 ${dmLabel()} อนุญาตให้ <b>${esc(e.name)}</b> ลอง — ทอย D20${e.stat ? ` + ${esc(e.stat)}` : ''}${MODE[e.mode] ? ` (${MODE[e.mode]})` : ''} · DC ${e.dc ?? '???'}${e.note ? `<div class="note">${esc(e.note)}</div>` : ''}</div>`;
      case 'check': return `<div class="entry">🎲 <b>${esc(e.name)}</b> “${esc(e.text)}”${e.stat ? ` (${esc(e.stat)})` : ''}<br>${rollLine(e.roll)} vs DC ${e.dc} <span class="result ${e.outcome}">${OUTCOME[e.outcome]}</span></div>`;
      case 'roll': return `<div class="entry ${e.visibility === 'dm' ? 'hidden-roll' : ''}">🎲 <b>${esc(e.name)}</b>${e.visibility === 'dm' ? ' (ลับ)' : ''}${e.label ? ` — ${esc(e.label)}` : ''}<br>${rollLine(e.roll)}</div>`;
      default: return '';
    }
  }
  let lastLogId = null;
  function renderStory() {
    $('#sceneTitle').textContent = S.scene.title;
    $('#sceneText').textContent = S.scene.text;
    const log = $('#log');
    const newest = S.log.at(-1)?.id;
    if (newest === lastLogId) return;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    log.innerHTML = S.log.map(entryHTML).join('');
    lastLogId = newest;
    if (atBottom || !lastLogId) scrollLog();
  }
  const scrollLog = () => requestAnimationFrame(() => { const l = $('#log'); l.scrollTop = l.scrollHeight; });
  $('#chatForm').onsubmit = (e) => {
    e.preventDefault();
    const t = $('#chatInput').value.trim();
    if (!t) return;
    socket.emit('chat', { text: t });
    $('#chatInput').value = '';
    scrollLog();
  };

  // ---------- actions ----------
  function statOptions(selected, allowNone = true) {
    const opts = allowNone ? [`<option value="">— ไม่ใช้ค่าสถานะ —</option>`] : [];
    for (const s of S.settings.stats) opts.push(`<option value="${esc(s)}" ${s === selected ? 'selected' : ''}>${esc(s)}</option>`);
    return opts.join('');
  }
  function renderActions() {
    const pending = S.actions.filter((a) => a.status === 'pending').length;
    const mineReady = S.actions.filter((a) => a.playerId === S.you && a.status === 'approved').length;
    $('#actBadge').textContent = S.isDM ? pending || '' : mineReady || '';

    $('#declareBox').classList.toggle('hidden', S.isDM);
    const statSel = $('#actionStat');
    const hasStats = S.settings.stats.length > 0;
    statSel.classList.toggle('hidden', !hasStats);
    if (document.activeElement !== statSel) {
      const v = statSel.value;
      statSel.innerHTML = statOptions(v);
      statSel.value = S.settings.stats.includes(v) ? v : '';
    }
    $('#declareHint').textContent = S.settings.requireApproval
      ? S.dmMode === 'ai' ? '🤖 AI DM จะตัดสินให้ภายในไม่กี่วินาที' : 'DM จะตัดสินว่าทำได้ไหม และต้องทอยเต๋าหรือเปล่า'
      : `ห้องนี้ไม่ต้องรออนุมัติ — ทอย D20 ได้ทันที (DC ${S.settings.defaultDC})`;

    $('#actListTitle').textContent = S.isDM ? 'คิวการกระทำของผู้เล่น' : 'การกระทำของคุณ';
    const order = { pending: 0, approved: 1, rolled: 2, denied: 3, resolved: 4, cancelled: 5 };
    const list = S.actions
      .filter((a) => S.isDM || a.playerId === S.you)
      .filter((a) => a.status !== 'cancelled')
      .sort((a, b) => order[a.status] - order[b.status] || b.createdAt - a.createdAt)
      .slice(0, 30);
    patch($('#actionList'), list.length ? list.map(actionHTML).join('') : `<p class="muted">ยังไม่มีการกระทำ</p>`);
  }
  function actionHTML(a) {
    const mine = a.playerId === S.you;
    let body = '';
    if (a.status === 'pending' && S.isDM) {
      const d = (drafts[a.id] ||= { dc: S.settings.defaultDC, stat: a.stat, mode: 'normal', bonus: 0, note: '', hiddenDC: false });
      body = `
        <div class="review-grid">
          <label>ความยาก (DC)<input type="number" inputmode="numeric" min="1" max="40" data-key="${a.id}:dc" data-d="${a.id}" data-f="dc" value="${d.dc}"></label>
          <label>โบนัสพิเศษ<input type="number" inputmode="numeric" min="-20" max="20" data-key="${a.id}:bonus" data-d="${a.id}" data-f="bonus" value="${d.bonus}"></label>
          ${S.settings.stats.length ? `<label>ค่าสถานะ<select data-key="${a.id}:stat" data-d="${a.id}" data-f="stat">${statOptions(d.stat)}</select></label>` : ''}
          ${S.settings.allowAdvantage ? `<label>การทอย<select data-key="${a.id}:mode" data-d="${a.id}" data-f="mode">
            <option value="normal" ${d.mode === 'normal' ? 'selected' : ''}>ปกติ</option>
            <option value="adv" ${d.mode === 'adv' ? 'selected' : ''}>ได้เปรียบ</option>
            <option value="dis" ${d.mode === 'dis' ? 'selected' : ''}>เสียเปรียบ</option></select></label>` : ''}
        </div>
        <label class="toggle small"><input type="checkbox" data-key="${a.id}:hid" data-d="${a.id}" data-f="hiddenDC" ${d.hiddenDC ? 'checked' : ''}> ซ่อน DC ไม่ให้ผู้เล่นเห็น</label>
        <input placeholder="คำแนะนำ/เหตุผลถึงผู้เล่น (ไม่ใส่ก็ได้)" maxlength="600" data-key="${a.id}:note" data-d="${a.id}" data-f="note" value="${esc(d.note)}">
        <div class="btn-row" style="margin-top:8px">
          <button class="btn primary small" data-review="approve" data-id="${a.id}">🎲 ให้ทอย</button>
          <button class="btn good small" data-review="auto" data-id="${a.id}">✅ ทำได้เลย</button>
          <button class="btn bad small" data-review="deny" data-id="${a.id}">🚫 ทำไม่ได้</button>
        </div>`;
    } else if (a.status === 'approved') {
      const owner = S.players.find((p) => p.id === a.playerId);
      const total = modOf(owner?.char, a.stat) + (a.bonus || 0);
      body = `<div class="meta">ทอย D20 ${sign(total)}${a.stat ? ` (${esc(a.stat)})` : ''}${MODE[a.mode] ? ` · ${MODE[a.mode]}` : ''} · DC ${a.dc ?? '???'}</div>
        ${a.note ? `<div class="note muted small">DM: ${esc(a.note)}</div>` : ''}
        <div class="btn-row" style="margin-top:8px">
          ${mine || S.isDM ? `<button class="btn gold" data-roll="${a.id}">🎲 ทอย D20!</button>` : ''}
          ${mine ? `<button class="btn small" data-cancel="${a.id}">ยกเลิก</button>` : ''}
        </div>`;
    } else if (a.status === 'rolled') {
      body = `<div>${rollLine(a.roll)} vs DC ${a.dc} <span class="result ${a.outcome}">${OUTCOME[a.outcome]}</span></div>`;
      if (S.isDM) {
        body += `<input placeholder="เล่าผลลัพธ์ เช่น ‘คุณปีนขึ้นไปได้ แต่กิ่งไม้หัก…’" maxlength="600" data-key="${a.id}:nar" data-d="${a.id}" data-f="narration" value="${esc(drafts[a.id]?.narration || '')}" style="margin-top:8px">
          <button class="btn primary small block" style="margin-top:6px" data-resolve="${a.id}">📣 เล่าผล & ปิดเรื่องนี้</button>`;
      }
    } else if (a.status === 'denied') {
      body = `<div class="note muted small">DM: ${esc(a.note)}</div>`;
    } else if (a.status === 'pending') {
      body = `<div class="btn-row"><button class="btn small" data-cancel="${a.id}">ยกเลิก</button></div>`;
    } else if (a.status === 'resolved' && a.outcome) {
      body = a.roll ? `<div>${rollLine(a.roll)} <span class="result ${a.outcome}">${OUTCOME[a.outcome]}</span></div>` : `<span class="result success">${OUTCOME.auto}</span>`;
    }
    return `<div class="card action ${a.status}">
      <div class="meta">${S.isDM ? `<b>${esc(a.playerName)}</b> · ` : ''}<span class="status">${STATUS[a.status]}</span>${a.stat && a.status === 'pending' ? ` · เสนอใช้ ${esc(a.stat)}` : ''}</div>
      <div class="text">${esc(a.text)}</div>${body}</div>`;
  }
  $('#actionList').addEventListener('input', (e) => {
    const t = e.target;
    if (!t.dataset.d) return;
    const d = (drafts[t.dataset.d] ||= {});
    d[t.dataset.f] = t.type === 'checkbox' ? t.checked : t.value;
  });
  $('#actionList').addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.d) (drafts[t.dataset.d] ||= {})[t.dataset.f] = t.type === 'checkbox' ? t.checked : t.value;
  });
  $('#actionList').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.review) {
      const id = b.dataset.id;
      const d = drafts[id] || {};
      socket.emit('review_action', { actionId: id, decision: b.dataset.review, ...d });
      delete drafts[id];
    } else if (b.dataset.roll) {
      b.disabled = true;
      socket.emit('roll_action', { actionId: b.dataset.roll });
    } else if (b.dataset.resolve) {
      const id = b.dataset.resolve;
      socket.emit('resolve_action', { actionId: id, narration: drafts[id]?.narration || '' });
      delete drafts[id];
    } else if (b.dataset.cancel) {
      socket.emit('cancel_action', { actionId: b.dataset.cancel });
    }
  });
  $('#actionSend').onclick = () => {
    const text = $('#actionInput').value.trim();
    if (!text) return toast('พิมพ์สิ่งที่อยากทำก่อน', 'error');
    socket.emit('submit_action', { text, stat: $('#actionStat').value });
    $('#actionInput').value = '';
    toast('ส่งให้ DM แล้ว');
  };

  // ---------- character ----------
  let charFilled = false;
  let charDirty = false;
  $('#charSheet').addEventListener('input', () => (charDirty = true));
  function renderChar() {
    const sheet = $('#charSheet');
    const self = me();
    if (S.isDM) {
      sheet.innerHTML = `<p class="muted small">คุณเป็น DM — ปรับ HP ผู้เล่นได้จากรายชื่อปาร์ตี้ด้านล่าง</p>`;
    } else if (self?.char && (!charFilled || (!charDirty && !sheet.contains(document.activeElement)))) {
      const c = self.char;
      const score = S.settings.statMode === 'score';
      sheet.innerHTML = `<div class="card">
        <h2>🧙 ตัวละครของฉัน</h2>
        <div class="row"><input id="cName" maxlength="40" placeholder="ชื่อตัวละคร" value="${esc(c.name)}">
        <input id="cCls" maxlength="40" placeholder="อาชีพ/เผ่า เช่น นักดาบเอลฟ์" value="${esc(c.cls)}"></div>
        <div class="row"><label class="field tight">HP<input id="cHp" type="number" inputmode="numeric" min="0" value="${c.hp}"></label>
        <label class="field tight">HP สูงสุด<input id="cMax" type="number" inputmode="numeric" min="1" value="${c.maxHp}"></label></div>
        <div class="hpbar"><div style="width:${Math.round((c.hp / c.maxHp) * 100)}%"></div></div>
        ${S.settings.stats.length ? `<div class="stat-grid">${S.settings.stats.map((s) => `
          <div class="stat"><label>${esc(s)}</label>
          <input type="number" inputmode="numeric" data-stat="${esc(s)}" min="${score ? 1 : -5}" max="${score ? 30 : 10}" value="${c.stats[s] ?? 0}">
          <div class="mod">${score ? sign(Math.floor(((c.stats[s] ?? 10) - 10) / 2)) : 'โบนัส'}</div></div>`).join('')}</div>
          <p class="muted small">${score ? 'ค่า 10 = ธรรมดา (โบนัส +0) · ทุก 2 แต้ม = โบนัส +1' : 'ตัวเลขคือโบนัสที่บวกเข้ากับ D20 ตรงๆ'}</p>` : ''}
        <label class="field">ของในกระเป๋า<textarea id="cInv" rows="2" maxlength="2000">${esc(c.inventory)}</textarea></label>
        <label class="field">ประวัติ/บันทึก<textarea id="cNotes" rows="3" maxlength="2000">${esc(c.notes)}</textarea></label>
        <button id="charSave" class="btn gold block">บันทึกตัวละคร</button></div>`;
      charFilled = true;
      charDirty = false;
      $('#charSave').onclick = () => {
        const stats = {};
        $$('[data-stat]', sheet).forEach((i) => (stats[i.dataset.stat] = i.value));
        socket.emit('update_char', {
          name: $('#cName').value, cls: $('#cCls').value, hp: $('#cHp').value, maxHp: $('#cMax').value,
          inventory: $('#cInv').value, notes: $('#cNotes').value, stats,
        });
        charFilled = false;
        charDirty = false;
        toast('บันทึกแล้ว');
      };
    }

    const party = S.players.filter((p) => !p.isDM);
    patch($('#partyList'), party.length ? party.map((p) => {
      const c = p.char || {};
      return `<div class="card member">
        <div class="member-head"><div><span class="dot ${p.connected ? 'on' : ''}"></span><b>${esc(c.name || p.name)}</b>
          <span class="muted small">${esc(c.cls || '')}${c.name && c.name !== p.name ? ` · ${esc(p.name)}` : ''}</span></div>
          <span class="small">❤️ ${c.hp ?? '-'}/${c.maxHp ?? '-'}</span></div>
        <div class="hpbar"><div style="width:${c.maxHp ? Math.round((c.hp / c.maxHp) * 100) : 0}%"></div></div>
        ${S.settings.stats.length ? `<div class="muted small">${S.settings.stats.map((s) => `${esc(s)} ${c.stats?.[s] ?? 0}`).join(' · ')}</div>` : ''}
        ${S.isDM ? `<div class="btn-row">
          <button class="btn bad small" data-hp="-5" data-p="${p.id}">-5</button>
          <button class="btn bad small" data-hp="-1" data-p="${p.id}">-1</button>
          <button class="btn good small" data-hp="1" data-p="${p.id}">+1</button>
          <button class="btn good small" data-hp="5" data-p="${p.id}">+5</button>
          <button class="btn small" data-kick="${p.id}">เชิญออก</button></div>
          ${c.inventory ? `<div class="small"><b>กระเป๋า:</b> ${esc(c.inventory)}</div>` : ''}
          ${c.notes ? `<div class="small muted">${esc(c.notes)}</div>` : ''}` : ''}
      </div>`;
    }).join('') : `<p class="muted">ยังไม่มีผู้เล่น — กดรหัสห้องด้านบนเพื่อแชร์ให้เพื่อน</p>`);
  }
  $('#partyList').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.hp) socket.emit('dm_hp', { playerId: b.dataset.p, delta: Number(b.dataset.hp) });
    if (b.dataset.kick && confirm('เชิญผู้เล่นนี้ออกจากห้อง?')) socket.emit('kick', { playerId: b.dataset.kick });
  });

  // ---------- dice ----------
  $('#diceGrid').innerHTML = [20, 4, 6, 8, 10, 12, 100]
    .map((n) => `<button class="btn ${n === 20 ? 'd20' : ''}" data-sides="${n}">d${n}</button>`).join('');
  $('#diceGrid').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    socket.emit('free_roll', {
      sides: Number(b.dataset.sides),
      count: $('#diceCount').value,
      mod: $('#diceMod').value,
      mode: $('input[name="diceMode"]:checked').value,
      label: $('#diceLabel').value,
      hidden: $('#diceHidden').checked,
    });
  };
  function renderDice() {
    $('#advRow').classList.toggle('hidden', !S.settings.allowAdvantage);
    const blocked = !S.isDM && !S.settings.playersCanFreeRoll;
    $$('#diceGrid button').forEach((b) => (b.disabled = blocked));
    $('#diceHint').textContent = blocked
      ? 'DM ปิดการทอยอิสระไว้ — ทอยได้เฉพาะตอน DM อนุมัติการกระทำ'
      : 'ได้เปรียบ/เสียเปรียบ ใช้ได้กับ 1d20 เท่านั้น (ทอย 2 ลูก เลือกค่าสูง/ต่ำ)';
  }

  let overlayTimer;
  socket.on('dice', ({ by, roll, outcome }) => {
    const ov = $('#diceOverlay');
    const face = $('#dieFace');
    ov.classList.remove('hidden');
    face.classList.remove('rolling');
    void face.offsetWidth;
    face.classList.add('rolling');
    $('#dieOutcome').textContent = '';
    $('#dieOutcome').className = 'die-outcome';
    let ticks = 0;
    clearInterval(overlayTimer);
    overlayTimer = setInterval(() => {
      face.textContent = 1 + Math.floor(Math.random() * roll.sides);
      if (++ticks > 8) {
        clearInterval(overlayTimer);
        face.textContent = roll.count === 1 ? roll.natural ?? roll.kept : roll.total;
        $('#dieCaption').innerHTML = `${esc(by)}<br>${rollLine(roll)}`;
        if (outcome) { $('#dieOutcome').textContent = OUTCOME[outcome]; $('#dieOutcome').className = `die-outcome ${outcome}`; }
        if (navigator.vibrate) navigator.vibrate(outcome === 'crit_success' || outcome === 'crit_fail' ? [60, 40, 120] : 40);
      }
    }, 70);
    $('#dieCaption').textContent = `${by} กำลังทอย...`;
    clearTimeout(ov.t);
    ov.t = setTimeout(() => ov.classList.add('hidden'), 2600);
  });
  $('#diceOverlay').onclick = () => $('#diceOverlay').classList.add('hidden');

  // ---------- Q&A ----------
  function renderAsk() {
    const s = S.settings;
    const unanswered = S.questions.filter((q) => !q.answer).length;
    $('#askBadge').textContent = S.isDM ? unanswered || '' : tab !== 'ask' && S.questions.length > seenQuestions ? S.questions.length - seenQuestions : '';
    if (tab === 'ask') seenQuestions = S.questions.length;

    $('#rulesSummary').innerHTML = `<ul>
      <li>รูปแบบ: <b>${esc(S.presets[s.preset])}</b> · โลก: ${esc(s.theme)}</li>
      <li>ทอย <b>D20</b> ${s.stats.length ? '+ โบนัสจากค่าสถานะ' : ''} แล้วต้องได้ ≥ <b>DC</b> ถึงจะสำเร็จ (DC ปกติ ${s.defaultDC})</li>
      ${s.statMode === 'score' ? '<li>โบนัสค่าสถานะ = (ค่า − 10) ÷ 2 ปัดลง</li>' : ''}
      ${s.critRules ? '<li>ทอยได้ 20 เป๊ะ = สำเร็จขั้นสุด · ได้ 1 = พลาดขั้นสุด</li>' : ''}
      ${s.allowAdvantage ? '<li>ได้เปรียบ = ทอย 2 ลูกเอาค่าสูง · เสียเปรียบ = เอาค่าต่ำ</li>' : ''}
      <li>${s.requireApproval ? 'ทุกการกระทำ DM ต้องอนุมัติก่อน' : 'ทอยได้ทันทีไม่ต้องรออนุมัติ'}</li>
    </ul>${s.houseRules ? `<div class="house">${esc(s.houseRules)}</div>` : ''}`;

    const qs = [...S.questions].reverse();
    patch($('#questionList'), qs.length ? qs.map((q) => `
      <div class="card q">
        <div class="tag">${esc(q.name)} ถาม${q.public ? '' : ' (ส่วนตัว)'}</div>
        <div>${esc(q.text)}</div>
        ${q.answer ? `<div class="a">👑 ${esc(q.answer)}</div>` : S.isDM ? '' : '<div class="tag">รอ DM ตอบ...</div>'}
        ${S.isDM ? `<div class="row"><input maxlength="600" placeholder="${q.answer ? 'แก้คำตอบ' : 'ตอบคำถาม'}..." data-key="q:${q.id}" data-q="${q.id}" value="${esc(drafts['q:' + q.id] ?? '')}">
          <button class="btn primary small" data-answer="${q.id}">ตอบ</button></div>` : ''}
      </div>`).join('') : `<p class="muted">${S.isDM ? 'ยังไม่มีคำถามจากผู้เล่น' : 'ยังไม่มีคำถาม'}</p>`);
  }
  $('#questionList').addEventListener('input', (e) => { if (e.target.dataset.q) drafts['q:' + e.target.dataset.q] = e.target.value; });
  $('#questionList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-answer]');
    if (!b) return;
    const id = b.dataset.answer;
    const text = (drafts['q:' + id] || '').trim();
    if (!text) return;
    socket.emit('answer', { questionId: id, text });
    delete drafts['q:' + id];
  });
  $('#askSend').onclick = () => {
    const text = $('#askInput').value.trim();
    if (!text) return;
    socket.emit('ask', { text, private: $('#askPrivate').checked });
    $('#askInput').value = '';
    toast('ส่งคำถามแล้ว');
  };

  // ---------- DM controls ----------
  let settingsDirty = false;
  $$('[data-pane="dm"] .card:last-child input, [data-pane="dm"] .card:last-child select, [data-pane="dm"] .card:last-child textarea')
    .forEach((el) => el.addEventListener('input', () => (settingsDirty = true)));
  function fillSettings(force) {
    if (!(S?.isDM || S?.isHost) || (settingsDirty && !force)) return;
    const s = S.settings;
    $('#setPreset').innerHTML = Object.entries(S.presets).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
    $('#setPreset').value = s.preset;
    const themes = S.themes.includes(s.theme) ? S.themes : [...S.themes, s.theme];
    $('#setTheme').innerHTML = themes.map((t) => `<option>${esc(t)}</option>`).join('');
    $('#setTheme').value = s.theme;
    $('#setStats').value = s.stats.join(', ');
    $('#customStatsField').classList.toggle('hidden', s.preset !== 'custom');
    $('#setDC').value = s.defaultDC;
    $('#setCrit').checked = s.critRules;
    $('#setAdv').checked = s.allowAdvantage;
    $('#setApproval').checked = s.requireApproval;
    $('#setFreeRoll').checked = s.playersCanFreeRoll;
    $('#setHouse').value = s.houseRules;
    if (!$('#sceneTitleInput').value && !$('#sceneTextInput').value && force) {
      $('#sceneTitleInput').value = S.scene.title;
    }
    settingsDirty = false;
  }
  $('#setPreset').addEventListener('change', () => $('#customStatsField').classList.toggle('hidden', $('#setPreset').value !== 'custom'));
  $('#settingsSave').onclick = () => {
    const preset = $('#setPreset').value;
    if (preset !== S.settings.preset && !confirm('เปลี่ยนรูปแบบเกมจะรีเซ็ตค่าสถานะของทุกคน ตกลงไหม?')) return;
    socket.emit('update_settings', {
      preset,
      stats: $('#setStats').value.split(/[,，]/),
      theme: $('#setTheme').value,
      defaultDC: $('#setDC').value,
      critRules: $('#setCrit').checked,
      allowAdvantage: $('#setAdv').checked,
      requireApproval: $('#setApproval').checked,
      playersCanFreeRoll: $('#setFreeRoll').checked,
      houseRules: $('#setHouse').value,
    });
    settingsDirty = false;
    toast('บันทึกระบบเกมแล้ว');
  };
  $('#sceneSend').onclick = () => {
    const title = $('#sceneTitleInput').value.trim();
    const text = $('#sceneTextInput').value.trim();
    if (!title && !text) return toast('ใส่ชื่อหรือคำบรรยายฉากก่อน', 'error');
    socket.emit('set_scene', { title, text });
    $('#sceneTextInput').value = '';
    toast('ตั้งฉากแล้ว');
    setTab('story');
  };
  $('#narrateSend').onclick = () => {
    const text = $('#narrateInput').value.trim();
    if (!text) return;
    socket.emit('narrate', { text });
    $('#narrateInput').value = '';
    toast('ส่งคำบรรยายแล้ว');
  };
})();
