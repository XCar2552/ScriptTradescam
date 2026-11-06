/* Avatars: 16x16 pixel characters drawn as SVG, or an uploaded photo. */
window.D20Avatar = (() => {
  const SKIN = ['#ffe0c2', '#f5c69a', '#d9a066', '#a86b3c', '#6b4226', '#8fd18f', '#bcd4ff', '#d6b4ff'];
  const HAIRC = ['#1b1b1b', '#5a3825', '#a0522d', '#e8c15a', '#f2f2f2', '#d94a4a', '#4a7bd9', '#9b59d0', '#3ecf8e', '#ff8fc8'];
  const CLOTH = ['#c0392b', '#2e86de', '#27ae60', '#8e44ad', '#f39c12', '#2c3e50', '#ecf0f1', '#16a085', '#6d4c41', '#e84393'];
  const BG = ['#2a2339', '#1f5d96', '#3a2e1d', '#4a1010', '#123d2b', '#5b3fa8', '#e8b04a', '#0b0912', '#ff8a65', '#4dd0e1'];

  const PARTS = [
    { key: 'skin', label: 'สีผิว', colors: SKIN },
    { key: 'hair', label: 'ทรงผม', options: ['สั้น', 'ยาว', 'ชี้ฟู', 'หางม้า', 'มวย', 'ผมม้า', 'หัวโล้น'] },
    { key: 'hairColor', label: 'สีผม', colors: HAIRC },
    { key: 'eyes', label: 'ตา', options: ['ปกติ', 'ตาโต', 'ยิ้มตาหยี', 'ดุ'] },
    { key: 'mouth', label: 'ปาก', options: ['ยิ้ม', 'เฉยๆ', 'อ้าปาก', 'แสยะ'] },
    { key: 'outfit', label: 'ชุด', options: ['เสื้อ', 'ลายทาง', 'โค้ทกัปตัน', 'เกราะ', 'ชุดคลุม', 'เสื้อกั๊ก'] },
    { key: 'outfitColor', label: 'สีชุด', colors: CLOTH },
    { key: 'hat', label: 'หมวก', options: ['ไม่มี', 'โจรสลัด', 'ผ้าโพกหัว', 'มงกุฎ', 'พ่อมด', 'ปีกกว้าง', 'หมวกเหล็ก', 'พ่อครัว'] },
    { key: 'acc', label: 'เครื่องประดับ', options: ['ไม่มี', 'ผ้าปิดตา', 'แว่นตา', 'หนวด', 'เครา', 'แผลเป็น', 'นกแก้ว'] },
    { key: 'bg', label: 'พื้นหลัง', colors: BG },
  ];

  const pick = (arr, n) => arr[Math.abs(n) % arr.length];
  function hash(str) {
    let h = 2166136261;
    for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return h >>> 0;
  }
  // Deterministic default look for anyone who hasn't customized yet.
  function fromSeed(seed) {
    let h = hash(seed);
    const next = () => (h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0);
    const a = { type: 'pixel' };
    for (const p of PARTS) a[p.key] = pick(p.colors || p.options, next());
    if (a.hat === 'พ่อครัว' || a.hat === 'มงกุฎ') a.hat = 'ไม่มี';
    if (a.acc !== 'ไม่มี' && next() % 2) a.acc = 'ไม่มี';
    return a;
  }
  function random() { return fromSeed(Math.random().toString(36)); }
  const AI_DEFAULT = { type: 'pixel', skin: '#bcd4ff', hair: 'หัวโล้น', hairColor: '#f2f2f2', eyes: 'ตาโต', mouth: 'ยิ้ม', outfit: 'ชุดคลุม', outfitColor: '#8e44ad', hat: 'พ่อมด', acc: 'เครา', bg: '#1f5d96' };

  // ---------- pixel drawing on a 16x16 grid ----------
  function grid(a) {
    const g = Array.from({ length: 16 }, () => Array(16).fill(null));
    const set = (x, y, c) => { if (x >= 0 && x < 16 && y >= 0 && y < 16) g[y][x] = c; };
    const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c); };
    const skin = a.skin || SKIN[1];
    const hc = a.hairColor || HAIRC[0];
    const oc = a.outfitColor || CLOTH[1];
    const dark = '#1b1428';

    // body + outfit
    const outfit = a.outfit || 'เสื้อ';
    rect(3, 11, 12, 15, oc);
    set(3, 11, null); set(12, 11, null);
    if (outfit === 'ลายทาง') { for (const y of [12, 14]) rect(3, y, 12, y, '#f2f2f2'); }
    if (outfit === 'โค้ทกัปตัน') { rect(7, 11, 8, 15, '#f2f2f2'); set(6, 12, '#e8b04a'); set(9, 12, '#e8b04a'); set(6, 14, '#e8b04a'); set(9, 14, '#e8b04a'); }
    if (outfit === 'เกราะ') { rect(3, 11, 12, 15, '#9aa4b1'); set(3, 11, null); set(12, 11, null); rect(4, 13, 11, 13, '#6b7684'); rect(3, 15, 12, 15, oc); }
    if (outfit === 'ชุดคลุม') { rect(2, 12, 13, 15, oc); rect(7, 11, 8, 15, '#e8b04a'); }
    if (outfit === 'เสื้อกั๊ก') { rect(6, 11, 9, 15, '#f2f2f2'); }
    // neck
    rect(7, 10, 8, 10, skin);
    // head
    rect(4, 3, 11, 9, skin);
    set(4, 3, null); set(11, 3, null); set(4, 9, null); set(11, 9, null);
    set(3, 6, skin); set(12, 6, skin); // ears

    // hair
    const hair = a.hair || 'สั้น';
    if (hair !== 'หัวโล้น') {
      rect(4, 2, 11, 3, hc); set(4, 4, hc); set(11, 4, hc);
      if (hair === 'ยาว') { rect(3, 3, 3, 11, hc); rect(12, 3, 12, 11, hc); set(4, 5, hc); set(11, 5, hc); }
      if (hair === 'ชี้ฟู') { for (const x of [4, 6, 8, 10]) set(x, 1, hc); set(3, 3, hc); set(12, 3, hc); }
      if (hair === 'หางม้า') { rect(12, 4, 13, 9, hc); }
      if (hair === 'มวย') { rect(6, 0, 9, 1, hc); }
      if (hair === 'ผมม้า') { rect(4, 4, 8, 4, hc); }
    }

    // eyes
    const eyes = a.eyes || 'ปกติ';
    if (eyes === 'ตาโต') { rect(6, 5, 6, 6, dark); rect(9, 5, 9, 6, dark); set(6, 5, '#fff'); set(9, 5, '#fff'); }
    else if (eyes === 'ยิ้มตาหยี') { set(5, 6, dark); set(6, 5, dark); set(7, 6, dark); set(8, 6, dark); set(9, 5, dark); set(10, 6, dark); }
    else if (eyes === 'ดุ') { set(5, 4, dark); set(6, 5, dark); set(10, 4, dark); set(9, 5, dark); set(6, 6, dark); set(9, 6, dark); }
    else { set(6, 6, dark); set(9, 6, dark); }

    // mouth
    const mouth = a.mouth || 'ยิ้ม';
    const lip = '#9b3b3b';
    if (mouth === 'ยิ้ม') { set(6, 7, lip); rect(7, 8, 8, 8, lip); set(9, 7, lip); }
    else if (mouth === 'อ้าปาก') { rect(7, 7, 8, 8, lip); }
    else if (mouth === 'แสยะ') { rect(6, 8, 9, 8, lip); set(7, 8, '#fff'); set(9, 7, lip); }
    else { rect(7, 8, 8, 8, lip); }

    // accessory
    const acc = a.acc || 'ไม่มี';
    if (acc === 'ผ้าปิดตา') { rect(4, 4, 11, 4, dark); rect(9, 5, 10, 6, dark); }
    if (acc === 'แว่นตา') { const f = '#333'; for (const x of [5, 7, 8, 10]) set(x, 6, f); rect(5, 5, 7, 5, f); rect(8, 5, 10, 5, f); }
    if (acc === 'หนวด') { rect(6, 7, 9, 7, hc); }
    if (acc === 'เครา') { rect(5, 8, 10, 10, hc); set(7, 8, lip); set(8, 8, lip); set(4, 8, hc); set(11, 8, hc); }
    if (acc === 'แผลเป็น') { set(10, 5, '#b04545'); set(11, 6, '#b04545'); set(10, 7, '#b04545'); }
    if (acc === 'นกแก้ว') { set(13, 9, '#d94a4a'); set(14, 9, '#f6c343'); rect(12, 10, 14, 11, '#3ecf8e'); set(13, 12, '#2e86de'); }

    // hat
    const hat = a.hat || 'ไม่มี';
    if (hat === 'โจรสลัด') { rect(2, 3, 13, 3, '#111'); rect(4, 1, 11, 2, '#111'); rect(6, 0, 9, 0, '#111'); set(7, 1, '#fff'); set(8, 1, '#fff'); set(7, 2, '#fff'); }
    if (hat === 'ผ้าโพกหัว') { rect(4, 2, 11, 3, '#d94a4a'); set(6, 2, '#fff'); set(9, 3, '#fff'); set(12, 3, '#d94a4a'); set(13, 4, '#d94a4a'); }
    if (hat === 'มงกุฎ') { rect(5, 1, 10, 2, '#e8b04a'); for (const x of [5, 7, 8, 10]) set(x, 0, '#e8b04a'); set(7, 1, '#d94a4a'); }
    if (hat === 'พ่อมด') { const wz = '#2b1b5e'; rect(2, 3, 13, 3, wz); rect(5, 2, 10, 2, wz); rect(6, 1, 9, 1, wz); rect(7, 0, 8, 0, wz); set(8, 1, '#f6c343'); }
    if (hat === 'ปีกกว้าง') { rect(1, 3, 14, 3, '#8d6e63'); rect(5, 1, 10, 2, '#8d6e63'); rect(5, 2, 10, 2, '#c0392b'); }
    if (hat === 'หมวกเหล็ก') { rect(4, 1, 11, 4, '#9aa4b1'); rect(4, 4, 11, 4, '#6b7684'); set(7, 0, '#d94a4a'); set(8, 0, '#d94a4a'); }
    if (hat === 'พ่อครัว') { rect(5, 0, 10, 2, '#fafafa'); rect(4, 3, 11, 3, '#e0e0e0'); }
    return g;
  }

  function pixelSVG(a) {
    const g = grid(a);
    let rects = '';
    for (let y = 0; y < 16; y++) {
      let x = 0;
      while (x < 16) {
        const c = g[y][x];
        if (!c) { x++; continue; }
        let w = 1;
        while (x + w < 16 && g[y][x + w] === c) w++;
        rects += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${c}"/>`;
        x += w;
      }
    }
    return `<svg viewBox="0 0 16 16" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect width="16" height="16" fill="${a.bg || BG[0]}"/>${rects}</svg>`;
  }

  // HTML for an avatar. `a` may be null -> default from seed.
  function html(a, seed, size = 32, extraClass = '') {
    const av = a && (a.type === 'photo' || a.type === 'pixel') ? a : seed === 'ai' ? AI_DEFAULT : fromSeed(seed || 'x');
    const inner = av.type === 'photo' ? `<img src="${String(av.data).replace(/"/g, '')}" alt="">` : pixelSVG(av);
    return `<span class="avatar ${extraClass}" style="width:${size}px;height:${size}px">${inner}</span>`;
  }

  // Resize an uploaded image to a 128x128 center-cropped JPEG data URL.
  function fromFile(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) return reject(new Error('ไฟล์นี้ไม่ใช่รูปภาพ'));
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(img.width, img.height);
        const c = document.createElement('canvas');
        c.width = c.height = 128;
        c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 128, 128);
        URL.revokeObjectURL(url);
        resolve({ type: 'photo', data: c.toDataURL('image/jpeg', 0.82) });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('เปิดรูปนี้ไม่ได้')); };
      img.src = url;
    });
  }

  return { PARTS, html, pixelSVG, fromSeed, random, fromFile, AI_DEFAULT };
})();
