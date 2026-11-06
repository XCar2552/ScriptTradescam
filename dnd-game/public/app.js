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
  let pickedTheme = 'pirate';
  function renderPicker(cards) {
    $('#themePicker').innerHTML = cards.map((c) => `
      <button type="button" class="theme-card ${c.id === pickedTheme ? 'picked' : ''} ${c.soon ? 'soon' : ''}" data-theme="${c.id}" ${c.soon ? 'disabled' : ''}>
        <div class="theme-art">${D20Art.banner(c.id)}</div>
        <div class="theme-info"><b>${c.emoji} ${esc(c.name)}</b><span>${c.soon ? 'เร็วๆ นี้' : esc(c.genre)}</span>
        <small>${esc(c.tagline)}</small></div>
      </button>`).join('');
    $('#customWorldFields').classList.toggle('hidden', pickedTheme !== 'custom');
    $('#presetField').classList.toggle('hidden', pickedTheme !== 'custom');
  }
  let themeCards = [];
  $('#themePicker').onclick = (e) => {
    const b = e.target.closest('[data-theme]');
    if (!b || b.disabled) return;
    pickedTheme = b.dataset.theme;
    renderPicker(themeCards);
  };
  fetch('/config').then((r) => r.json()).then((c) => {
    themeCards = c.themeCards || [];
    renderPicker(themeCards);
    if (!c.aiAvailable) {
      $('#dmModeInput option[value="ai"]').disabled = true;
      $('#aiOffHint').classList.remove('hidden');
    }
  }).catch(() => {});
  $('#createBtn').onclick = async () => {
    const name = getName();
    if (name) {
      enter(await emit('create_room', {
        name, playerId, preset: $('#presetInput').value, dmMode: $('#dmModeInput').value,
        themeId: pickedTheme, worldName: $('#worldNameInput').value, worldLore: $('#worldLoreInput').value,
      }));
    }
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
    $('#themeChip').textContent = `${aiMode ? '🤖 ' : ''}${S.world?.emoji || ''} ${S.world?.name || S.settings.theme}`;
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
    renderWorld();
    renderEnding();
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
      case 'travel': return `<div class="entry travel">${esc(e.text)}</div>`;
      case 'event': return `<div class="entry event">⚡ <b>อีเวนต์!</b> ${esc(e.text)}</div>`;
      case 'ending': return `<div class="entry ending-log ${e.type}">${e.type === 'win' ? '🏆' : '💀'} <b>${e.type === 'win' ? 'ชนะ!' : 'พ่ายแพ้'}</b> ${esc(e.text)}</div>`;
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
        ${S.world?.roles?.length ? `<label class="field">เลือกบทบาทในโลกนี้ (ใส่โบนัสค่าสถานะให้อัตโนมัติ)
          <select id="cRole"><option value="">— เลือก —</option>${S.world.roles.map((r) => `<option ${r.name === c.cls ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label>
          <div id="roleInfo" class="muted small"></div>` : ''}
        ${S.world?.powers ? `<label class="field">${esc(S.world.powers.title)} (ไม่บังคับ)
          <select id="cPower"><option value="">— ไม่มี —</option>${S.world.powers.list.map((x) => `<option value="${esc(x.name)}" ${x.name === c.power ? 'selected' : ''}>${x.icon} ${esc(x.name)} — ${esc(x.desc)}</option>`).join('')}</select></label>` : ''}
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
      const roleSel = $('#cRole');
      if (roleSel) {
        const showRole = () => {
          const r = S.world.roles.find((x) => x.name === roleSel.value);
          $('#roleInfo').textContent = r ? `${r.icon} ${r.desc} · โบนัส: ${Object.entries(r.bonus).map(([k, v]) => `${k} +${v}`).join(', ')} · ของเริ่มต้น: ${r.item}` : '';
        };
        showRole();
        roleSel.onchange = () => {
          const r = S.world.roles.find((x) => x.name === roleSel.value);
          showRole();
          if (!r) return;
          $('#cCls').value = r.name;
          $$('[data-stat]', sheet).forEach((i) => (i.value = r.bonus[i.dataset.stat] || 0));
          const inv = $('#cInv');
          if (!inv.value.trim()) inv.value = r.item;
        };
      }
      $('#charSave').onclick = () => {
        const stats = {};
        $$('[data-stat]', sheet).forEach((i) => (stats[i.dataset.stat] = i.value));
        socket.emit('update_char', {
          name: $('#cName').value, cls: $('#cCls').value, hp: $('#cHp').value, maxHp: $('#cMax').value,
          inventory: $('#cInv').value, notes: $('#cNotes').value, stats, power: $('#cPower') ? $('#cPower').value : undefined,
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
    $('#themeSwitch').innerHTML = (S.themeCards || []).filter((c) => !c.soon).map((c) => `<option value="${c.id}" ${c.id === S.world?.themeId ? 'selected' : ''}>${c.emoji} ${esc(c.name)}</option>`).join('');
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

  // ---------- WORLD ----------
  let selIsland = null;
  const wd = {}; // drafts for world inputs
  const openDet = new Set(['lore']); // which <details> sections are open
  const det = (k) => `data-det="${k}" ${openDet.has(k) ? 'open' : ''}`;
  const ROLE = { ally: ['พันธมิตร', 'ally'], villain: ['ตัวร้าย', 'villain'], neutral: ['ฝ่ายกลาง', 'neutral'] };
  const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

  function mapSVG(w) {
    const pts = w.islands.map((i) => [i.x, i.y * 0.62]);
    const path = pts.map((p, k) => `${k ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
    return `<svg viewBox="0 0 100 62" class="route-map" role="img" aria-label="แผนที่เส้นทาง">
      <defs><radialGradient id="seaG" cx=".5" cy=".4" r=".8"><stop offset="0" stop-color="#1f5d96"/><stop offset="1" stop-color="#0b1d3a"/></radialGradient></defs>
      <rect width="100" height="62" rx="3" fill="url(#seaG)"/>
      <g stroke="#ffffff22" stroke-width=".2" fill="none">${[10, 20, 30, 40, 50].map((y) => `<path d="M0 ${y} Q25 ${y - 2} 50 ${y} T100 ${y}"/>`).join('')}</g>
      <path d="${path}" stroke="#f2e6cc" stroke-width=".5" stroke-dasharray="1.4 1.2" fill="none" opacity=".75"/>
      ${w.islands.map((i) => {
        const here = i.id === S.location;
        const seen = S.visited.includes(i.id);
        const sel = i.id === selIsland;
        const y = i.y * 0.62;
        return `<g class="isl" data-island="${i.id}" style="cursor:pointer">
          <circle cx="${i.x}" cy="${y}" r="${sel ? 4.6 : 4}" fill="${seen ? '#e9d29a' : '#3a4b66'}" stroke="${sel ? '#fff' : here ? '#e8b04a' : '#0b1d3a'}" stroke-width="${sel || here ? .8 : .4}"/>
          <text x="${i.x}" y="${y + 1.5}" text-anchor="middle" font-size="4">${seen || S.isDM ? i.emoji : '❔'}</text>
          <text x="${i.x}" y="${y + 7.6}" text-anchor="middle" font-size="2.4" fill="#fff" opacity="${seen ? 1 : .6}">${esc(i.name.length > 16 ? i.name.slice(0, 15) + '…' : i.name)}</text>
          ${here ? `<text x="${i.x + 4}" y="${y - 3}" font-size="4.5">⛵</text>` : ''}
        </g>`;
      }).join('')}
    </svg>`;
  }

  function trackerHTML(t) {
    const pct = t.max >= 9999 ? 100 : Math.round((t.value / t.max) * 100);
    const danger = t.loseAt !== undefined && (t.loseAt === 0 ? t.value <= Math.ceil(t.max * 0.3) : t.value >= Math.floor(t.max * 0.7));
    return `<div class="tracker ${danger ? 'danger' : ''}">
      <div class="tracker-head"><span>${t.icon || '📊'} ${esc(t.name)}</span><b>${t.value}${t.max < 9999 ? ` / ${t.max}` : ''}</b></div>
      ${t.max < 9999 ? `<div class="hpbar"><div style="width:${pct}%"></div></div>` : ''}
      ${t.loseAt !== undefined ? `<div class="muted small">แพ้เมื่อถึง ${t.loseAt}</div>` : ''}
      ${S.canGM ? `<div class="btn-row"><button class="btn small" data-tr="${t.id}" data-d="-1">−1</button><button class="btn small" data-tr="${t.id}" data-d="1">+1</button>
        ${t.max >= 100 ? `<button class="btn small" data-tr="${t.id}" data-d="10">+10</button>` : ''}
        <button class="btn small ghost-btn" data-trdel="${t.id}" title="ลบ">🗑️</button></div>` : ''}
    </div>`;
  }

  function npcCard(n) {
    const [label, cls] = ROLE[n.role] || ROLE.neutral;
    return `<div class="npc ${cls}"><div class="npc-icon">${n.icon}</div><div>
      <b>${esc(n.name)}</b> <span class="tag ${cls}">${label}</span><div class="muted small">${esc(n.title)}</div>
      <div class="small">${esc(n.desc)}</div>
      ${n.secret ? `<div class="secret small">🔒 ${esc(n.secret)}</div>` : ''}</div></div>`;
  }

  function renderWorld() {
    const box = $('#worldView');
    const w = S.world;
    if (!w) { box.innerHTML = ''; return; }
    if (!selIsland || !w.islands.some((i) => i.id === selIsland)) selIsland = S.location;
    const isl = w.islands.find((i) => i.id === selIsland);
    const gm = S.canGM;
    const canTravel = isl && isl.id !== S.location && (S.isDM || S.dmMode === 'ai');
    const v = (k) => esc(wd[k] ?? '');
    const npcs = isl ? w.npcs.filter((n) => n.island === isl.id) : [];
    const html = `
      <div class="world-banner">${D20Art.banner(w.themeId)}<div class="world-title"><b>${w.emoji} ${esc(w.name)}</b><span>${esc(w.genre)}</span></div></div>
      ${S.ending ? `<div class="card ending-card ${S.ending.type}"><b>${S.ending.type === 'win' ? '🏆 ชนะแล้ว!' : '💀 พ่ายแพ้'}</b> ${esc(S.ending.text)}</div>` : ''}
      ${w.lore ? `<details class="card lore" ${det('lore')}><summary>📜 ตำนานของโลกนี้</summary><p>${esc(w.lore)}</p></details>` : ''}
      ${w.themeId === 'custom' && gm ? `<div class="card"><h2>✏️ ข้อมูลโลก</h2>
        <input data-key="w:name" data-w="w:name" maxlength="60" placeholder="ชื่อโลก" value="${esc(wd['w:name'] ?? w.name)}">
        <textarea data-key="w:lore" data-w="w:lore" rows="3" maxlength="2000" placeholder="ตำนาน/เรื่องย่อ" style="margin-top:8px">${esc(wd['w:lore'] ?? w.lore)}</textarea>
        <button class="btn gold block" data-act="worldInfo" style="margin-top:8px">บันทึกข้อมูลโลก</button></div>` : ''}

      <div class="card"><h2>🎯 เป้าหมาย</h2>
        <div class="goal-head good">🏆 ชนะเมื่อทำครบทุกข้อ</div>
        ${S.goals.win.length ? S.goals.win.map((g) => `<div class="goal ${g.done ? 'done' : ''}">
          ${gm ? `<input type="checkbox" data-goal="${g.id}" ${g.done ? 'checked' : ''}>` : `<span>${g.done ? '✅' : '⬜'}</span>`}
          <span>${esc(g.text)}</span>${gm ? `<button class="x" data-goaldel="${g.id}">✕</button>` : ''}</div>`).join('') : '<p class="muted small">ยังไม่มีเป้าหมาย</p>'}
        <div class="goal-head bad">💀 แพ้เมื่อเกิดข้อใดข้อหนึ่ง</div>
        ${S.goals.lose.length ? S.goals.lose.map((g) => `<div class="goal"><span>⚠️</span><span>${esc(g.text)}</span>${gm ? `<button class="x" data-goaldel="${g.id}">✕</button>` : ''}</div>`).join('') : '<p class="muted small">ยังไม่มีเงื่อนไขแพ้</p>'}
        ${gm ? `<div class="row"><select data-key="g:list" data-w="g:list"><option value="win" ${wd['g:list'] !== 'lose' ? 'selected' : ''}>เป้าหมายชนะ</option><option value="lose" ${wd['g:list'] === 'lose' ? 'selected' : ''}>เงื่อนไขแพ้</option></select></div>
          <div class="row"><input data-key="g:text" data-w="g:text" maxlength="200" placeholder="เขียนเป้าหมายเอง..." value="${v('g:text')}"><button class="btn primary small" data-act="goalAdd">เพิ่ม</button></div>
          ${S.aiAvailable ? `<div class="row"><input data-key="g:idea" data-w="g:idea" maxlength="600" placeholder="ไอเดียให้ AI (ไม่ใส่ก็ได้)" value="${v('g:idea')}"><button class="btn small" data-act="aiGoals" ${S.aiBusy ? 'disabled' : ''}>🤖 ให้ AI เขียน</button></div>
          <p class="muted small">AI จะเขียนเป้าหมายใหม่ทั้งหมดแทนของเดิม</p>` : ''}
          <div class="btn-row"><button class="btn good small" data-act="win">🏆 ประกาศชนะ</button><button class="btn bad small" data-act="lose">💀 ประกาศแพ้</button></div>` : ''}
      </div>

      ${S.trackers.length || gm ? `<div class="card"><h2>📊 มาตรวัด</h2>${S.trackers.map(trackerHTML).join('')}
        ${gm ? `<details class="add-tracker" ${det('addtr')}><summary class="small">+ เพิ่มมาตรวัด</summary>
          <div class="row"><input data-key="t:name" data-w="t:name" maxlength="40" placeholder="ชื่อ เช่น ความหิว" value="${v('t:name')}"></div>
          <div class="row"><input data-key="t:value" data-w="t:value" type="number" inputmode="numeric" placeholder="เริ่ม" value="${v('t:value')}"><input data-key="t:max" data-w="t:max" type="number" inputmode="numeric" placeholder="สูงสุด" value="${v('t:max')}"></div>
          <div class="row"><select data-key="t:lose" data-w="t:lose"><option value="">ไม่มีผลแพ้</option><option value="zero" ${wd['t:lose'] === 'zero' ? 'selected' : ''}>แพ้เมื่อเหลือ 0</option><option value="max" ${wd['t:lose'] === 'max' ? 'selected' : ''}>แพ้เมื่อเต็ม</option></select>
          <button class="btn primary small" data-act="trackerAdd">เพิ่ม</button></div></details>` : ''}</div>` : ''}

      ${w.islands.length ? `<div class="card"><h2>🗺️ แผนที่เส้นทาง</h2>${mapSVG(w)}
        <p class="muted small">แตะเกาะเพื่อดูรายละเอียด · ⛵ = ตำแหน่งปัจจุบัน · ❔ = ยังไม่เคยไป</p></div>` : ''}

      ${isl ? `<div class="card place">
        <div class="place-head"><span class="place-emoji">${isl.unknown && !S.isDM ? '❔' : isl.emoji}</span><div>
          <h2>${esc(isl.name)} ${isl.id === S.location ? '<span class="tag here">อยู่ที่นี่</span>' : ''}</h2>
          <div class="muted small">${esc(isl.kind)} · อันตราย <span class="stars">${stars(isl.danger)}</span>${isl.mapPiece && S.isDM ? ' · 🗺️ มีเศษแผนที่' : ''}</div></div></div>
        ${isl.unknown ? `<p>${esc(isl.summary)}</p><p class="muted small">ยังไม่เคยไป — ต้องไปถึงก่อนถึงจะรู้รายละเอียด</p>` : `
          <p>${esc(isl.desc)}</p>
          <h3 class="section-title">📍 สถานที่สำคัญ</h3>
          <div class="landmarks">${isl.landmarks.map((l) => `<div class="landmark"><b>${esc(l.name)}</b><span class="small muted">${esc(l.desc)}</span></div>`).join('')}</div>
          ${npcs.length ? `<h3 class="section-title">👥 ตัวละครบนเกาะ</h3>${npcs.map(npcCard).join('')}` : ''}
          ${isl.secret ? `<div class="secret"><b>🔒 ความลับ (เห็นแค่ DM)</b><br>${esc(isl.secret)}</div>` : ''}
          ${isl.events ? `<h3 class="section-title">⚡ อีเวนต์ที่อาจเกิด (เห็นแค่ DM)</h3><ul class="small">${isl.events.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}`}
        ${canTravel ? `<button class="btn gold block" data-act="travel" ${S.aiBusy ? 'disabled' : ''}>⛵ ${S.dmMode === 'ai' ? 'ออกเรือไปที่นี่' : 'พาลูกเรือไปที่นี่'}</button>` : ''}
        ${isl.id === S.location && gm && !isl.unknown ? `<button class="btn primary block" data-act="event" style="margin-top:8px" ${S.aiBusy ? 'disabled' : ''}>🎲 สุ่มอีเวนต์</button>` : ''}
      </div>` : ''}

      ${w.factions?.length ? `<div class="card"><h2>⚑ ฝ่ายต่างๆ</h2>${w.factions.map((f) => `<div class="landmark"><b>${f.icon} ${esc(f.name)}</b><span class="small muted">${esc(f.desc)}</span></div>`).join('')}</div>` : ''}
      ${w.npcs.length ? `<details class="card" ${det('npcs')}><summary><b>📖 สมุดรายชื่อตัวละคร (${w.npcs.length})</b></summary>
        ${['ally', 'villain', 'neutral'].map((r) => {
          const list = w.npcs.filter((n) => n.role === r);
          return list.length ? `<h3 class="section-title">${ROLE[r][0]}</h3>${list.map(npcCard).join('')}` : '';
        }).join('')}
        ${!S.isDM ? '<p class="muted small">ตัวละครจะปรากฏเมื่อเดินทางไปถึงเกาะของพวกเขา</p>' : ''}</details>` : ''}
      ${w.roles?.length ? `<details class="card" ${det('roles')}><summary><b>🧭 บทบาทลูกเรือ</b></summary>${w.roles.map((r) => `<div class="landmark"><b>${r.icon} ${esc(r.name)}</b><span class="small muted">${esc(r.desc)} · โบนัส ${Object.entries(r.bonus).map(([k, x]) => `${esc(k)} +${x}`).join(', ')}</span></div>`).join('')}</details>` : ''}
      ${w.powers ? `<details class="card" ${det('powers')}><summary><b>💎 ${esc(w.powers.title)}</b></summary><p class="small">${esc(w.powers.rule)}</p>${w.powers.list.map((x) => `<div class="landmark"><b>${x.icon} ${esc(x.name)}</b><span class="small muted">${esc(x.desc)}</span></div>`).join('')}</details>` : ''}`;
    patch(box, html);
  }

  $('#worldView').addEventListener('toggle', (e) => {
    const k = e.target.dataset?.det;
    if (k) e.target.open ? openDet.add(k) : openDet.delete(k);
  }, true);
  $('#worldView').addEventListener('input', (e) => { if (e.target.dataset.w) wd[e.target.dataset.w] = e.target.value; });
  $('#worldView').addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.w) wd[t.dataset.w] = t.value;
    if (t.dataset.goal) socket.emit('goal_toggle', { id: t.dataset.goal });
  });
  $('#worldView').addEventListener('click', (e) => {
    const isl = e.target.closest('[data-island]');
    if (isl) { selIsland = isl.dataset.island; renderWorld(); return; }
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tr) return socket.emit('tracker', { id: b.dataset.tr, delta: Number(b.dataset.d) });
    if (b.dataset.trdel) return confirm('ลบมาตรวัดนี้?') && socket.emit('tracker_remove', { id: b.dataset.trdel });
    if (b.dataset.goaldel) return socket.emit('goal_remove', { id: b.dataset.goaldel });
    switch (b.dataset.act) {
      case 'travel': socket.emit('travel', { islandId: selIsland }); toast('ออกเรือ! ⛵'); setTab('story'); break;
      case 'event': socket.emit('random_event'); setTab('story'); break;
      case 'goalAdd':
        if (!(wd['g:text'] || '').trim()) return toast('เขียนเป้าหมายก่อน', 'error');
        socket.emit('goal_add', { list: wd['g:list'] || 'win', text: wd['g:text'] });
        wd['g:text'] = '';
        break;
      case 'aiGoals':
        if (S.goals.win.length && !confirm('ให้ AI เขียนเป้าหมายใหม่แทนของเดิม?')) return;
        socket.emit('ai_goals', { idea: wd['g:idea'] || '' });
        wd['g:idea'] = '';
        toast('AI กำลังเขียนเป้าหมาย...');
        break;
      case 'trackerAdd':
        if (!(wd['t:name'] || '').trim()) return toast('ตั้งชื่อมาตรวัดก่อน', 'error');
        socket.emit('tracker_add', { name: wd['t:name'], value: wd['t:value'] || 0, max: wd['t:max'] || 10, loseAt: wd['t:lose'] || '' });
        for (const k of ['t:name', 't:value', 't:max', 't:lose']) delete wd[k];
        break;
      case 'win': case 'lose': {
        const text = prompt(b.dataset.act === 'win' ? 'ข้อความตอนชนะ (ไม่ใส่ก็ได้)' : 'ข้อความตอนแพ้ (ไม่ใส่ก็ได้)');
        if (text !== null) socket.emit('ending', { type: b.dataset.act, text });
        break;
      }
      case 'worldInfo':
        socket.emit('world_info', { name: wd['w:name'] ?? S.world.name, lore: wd['w:lore'] ?? S.world.lore });
        delete wd['w:name']; delete wd['w:lore'];
        toast('บันทึกแล้ว');
        break;
      default:
    }
  });

  // ---------- ENDING ----------
  let endingSeen = null;
  function renderEnding() {
    const ov = $('#endingOverlay');
    const e = S.ending;
    if (!e) { ov.classList.add('hidden'); endingSeen = null; return; }
    if (endingSeen === e.ts) return;
    ov.className = `overlay ending ${e.type}`;
    $('#endingIcon').textContent = e.type === 'win' ? '🏆' : '💀';
    $('#endingTitle').textContent = e.type === 'win' ? 'ชัยชนะ!' : 'พ่ายแพ้...';
    $('#endingText').textContent = e.text;
    $('#endingContinue').classList.toggle('hidden', !S.canGM);
    if (navigator.vibrate) navigator.vibrate(e.type === 'win' ? [80, 60, 80, 60, 200] : [300]);
  }
  $('#endingClose').onclick = () => { endingSeen = S.ending?.ts; $('#endingOverlay').classList.add('hidden'); };
  $('#endingContinue').onclick = () => { socket.emit('ending', { type: 'clear' }); };

  // ---------- Theme switch (host) ----------
  $('#themeSwitchBtn').onclick = () => {
    const id = $('#themeSwitch').value;
    if (!confirm('เปลี่ยนโลก? เป้าหมาย มาตรวัด และแผนที่จะเริ่มใหม่')) return;
    socket.emit('set_theme', { themeId: id });
    toast('เปลี่ยนโลกแล้ว');
  };
})();
