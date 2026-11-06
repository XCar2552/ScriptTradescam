/* Pixel-art sprites (12x12) for monsters and board objects.
   Human enemies reuse the avatar renderer with fixed looks. */
window.D20Sprites = (() => {
  const S = {
    skeleton: { p: { w: '#eeeeee', k: '#222', g: '#9e9e9e' }, r: [
      '....wwww....', '...wwwwww...', '...wkwwkw...', '...wwwwww...', '....wkkw....', '.....ww.....',
      '..gwwwwwwg..', '..g.wggw.g..', '....wwww....', '....w..w....', '....w..w....', '...ww..ww...'] },
    ghost: { p: { w: '#e8f0ff', k: '#222' }, r: [
      '....wwww....', '...wwwwww...', '..wwwwwwww..', '..wwkwwkww..', '..wwkwwkww..', '..wwwwwwww..',
      '..wwwkkwww..', '..wwwwwwww..', '..wwwwwwww..', '..wwwwwwww..', '..w.ww..ww..', '............'] },
    shark: { p: { b: '#5c7fa3', w: '#f2f2f2', k: '#111', r: '#c0392b' }, r: [
      '.....b......', '....bb......', '...bbb......', '..bbbbbbb...', '.bbbbbbbbbb.', 'bbkbbbbbbbbb',
      'bwwwwwbbbbb.', '.rwrwrwbbb..', '..wwwwwbb.b.', '...........b', '............', '............'] },
    crab: { p: { r: '#d84315', o: '#ff8a65', k: '#111', w: '#fff' }, r: [
      '.r........r.', 'rr........rr', 'r.r......r.r', '...rwrrwr...', '...rkrrkr...', '..rrrrrrrr..',
      '.rrooooooor.', 'r.rrrrrrrr.r', '.r.r....r.r.', 'r..r....r..r', '............', '............'] },
    octopus: { p: { p: '#8e44ad', l: '#c39bd3', k: '#111', w: '#fff' }, r: [
      '....pppp....', '...pppppp...', '..pppppppp..', '..pwkppwkp..', '..pppppppp..', '..pplppplp..',
      '...pppppp...', '..p.p.pp.p..', '.p..p.p..p..', '.p.p..p.p.p.', 'p..p.p..p..p', '............'] },
    dino: { p: { g: '#43a047', d: '#2e7d32', w: '#fff', k: '#111' }, r: [
      '.......gggg.', '......ggkgg.', '......gggggg', '......ggwwww', '......gggg..', '..d..ggggg..',
      '.dggggggggg.', 'dggggggggg..', '.gggggggg...', '..gg...gg...', '..gg...gg...', '.ggg..ggg...'] },
    scorpion: { p: { o: '#bf8040', k: '#111' }, r: [
      '........ooo.', '.........oo.', '..........o.', '.........oo.', 'o..oooooo...', '.ooookoko...',
      'o.oooooooo..', '..o.o.o.o...', '.o..o.o..o..', '............', '............', '............'] },
    robot: { p: { g: '#90a4ae', d: '#546e7a', r: '#ff5252', y: '#ffd54f' }, r: [
      '.....y......', '.....d......', '...gggggg...', '...grggrg...', '...gggggg...', '...gdddgg...',
      '.dggggggggd.', '.d.gyyyyg.d.', '.d.gggggg.d.', '...gg..gg...', '...dd..dd...', '..ddd..ddd..'] },
    golem: { p: { c: '#b87333', d: '#8a5a2b', y: '#ffd54f' }, r: [
      '...cccccc...', '..cccccccc..', '..cyccccyc..', '..cccccccc..', '.dccddddccd.', 'dccccccccccd',
      'dcc.cccc.ccd', 'dcc.cccc.ccd', '.d..cccc..d.', '...cc..cc...', '..ccc..ccc..', '..ddd..ddd..'] },
    snake: { p: { g: '#7cb342', r: '#e53935', k: '#111' }, r: [
      '............', '....gggg....', '...gkggkg...', '...gggggg...', '....r..r....', '.....gg.....',
      '....gg......', '...gg.......', '...ggggggg..', '........gg..', '.ggggggggg..', 'gg..........'] },
    bat: { p: { k: '#3e2723', r: '#ff1744' }, r: [
      '............', 'k..........k', 'kk..k..k..kk', 'kkk.kkkk.kkk', 'kkkkkrrkkkkk', 'kkkkkkkkkkkk',
      '.kk.kkkk.kk.', '.k...kk...k.', '.....k.k....', '............', '............', '............'] },
    slime: { p: { g: '#66bb6a', l: '#a5d6a7', k: '#1b5e20' }, r: [
      '............', '............', '.....gg.....', '....gggg....', '...gggggg...', '..gglgggggg.',
      '..ggkggkggg.', '.gggggggggg.', '.gggkkkgggg.', 'gggggggggggg', 'gggggggggggg', '............'] },
    wolf: { p: { g: '#757575', d: '#424242', w: '#eeeeee', k: '#111', r: '#d32f2f' }, r: [
      '.d........d.', '.dd......dd.', '.ggg....ggg.', '..gggggggg..', '..gkggggkg..', '..gggwwggg..',
      '...gwkkwg...', '...ggrrgg...', '..gggggggg..', '.gg.gggg.gg.', '.g..g..g..g.', '............'] },
    boss: { p: { k: '#1a1a2e', p: '#4a148c', y: '#ffd700', r: '#ff1744', s: '#d6b4ff' }, r: [
      '...y.yy.y...', '...yyyyyy...', '...ssssss...', '...srssrs...', '...ssssss...', '..kpssssspk.',
      '.kkpppppppkk', 'kkkpppppppkk', 'kk.ppyppp.kk', 'k..ppppppp.k', '...pp...pp..', '..kkk...kkk.'] },
    // ---- objects ----
    tree: { p: { g: '#2e7d32', l: '#43a047', b: '#6d4c41' }, r: [
      '....llll....', '..llgggggl..', '.lgggggggggl', '.ggglgggglgg', '.gggggggggg.', '..gggggggg..',
      '...ggggggg..', '.....bb.....', '.....bb.....', '.....bb.....', '....bbbb....', '............'] },
    palm: { p: { g: '#43a047', b: '#8d6e63' }, r: [
      '..gg....gg..', '.g..gggg..g.', 'g..gggggg..g', '...g.bb.g...', '.....b......', '.....b......',
      '......b.....', '......b.....', '......b.....', '.....bb.....', '....bbbb....', '............'] },
    rock: { p: { g: '#9e9e9e', d: '#616161', l: '#bdbdbd' }, r: [
      '............', '............', '............', '....llll....', '...lggggd...', '..lgggggggd.',
      '.lggggggggd.', '.ggggdgggggd', 'dggggggdgggd', '.ddddddddddd', '............', '............'] },
    barrel: { p: { b: '#8d6e63', d: '#5d4037', k: '#424242' }, r: [
      '............', '...dddddd...', '..bbbbbbbb..', '..kkkkkkkk..', '.bbbbbbbbbb.', '.bdbbdbbdbb.',
      '.bbbbbbbbbb.', '..kkkkkkkk..', '..bbbbbbbb..', '...dddddd...', '............', '............'] },
    crate: { p: { b: '#c8a165', d: '#8d6e63' }, r: [
      '............', '.dddddddddd.', '.dbbbbbbbbd.', '.dbdbbbbdbd.', '.dbbdbbdbbd.', '.dbbbddbbbd.',
      '.dbbbddbbbd.', '.dbbdbbdbbd.', '.dbdbbbbdbd.', '.dbbbbbbbbd.', '.dddddddddd.', '............'] },
    chest: { p: { b: '#8d6e63', d: '#5d4037', y: '#ffd54f' }, r: [
      '............', '............', '..dddddddd..', '.dbbbbbbbbd.', '.dbbbbbbbbd.', '.yyyyyyyyyy.',
      '.dbbbyybbbd.', '.dbbbyybbbd.', '.dbbbbbbbbd.', '.dddddddddd.', '............', '............'] },
    cannon: { p: { k: '#37474f', g: '#607d8b', b: '#6d4c41' }, r: [
      '............', '............', '............', '...kkkkkkkk.', '..kggggggggk', '..kggggggggk',
      '...kkkkkkkk.', '..bbbbbb....', '.bkbbbbkb...', '.bkb..bkb...', '..k....k....', '............'] },
    wall: { p: { g: '#8d8d8d', d: '#5f5f5f' }, r: [
      'dddddddddddd', 'gggdggggdggg', 'gggdggggdggg', 'dddddddddddd', 'gdggggdggggd', 'gdggggdggggd',
      'dddddddddddd', 'gggdggggdggg', 'gggdggggdggg', 'dddddddddddd', 'gdggggdggggd', 'dddddddddddd'] },
    water: { p: { b: '#1f6fb2', l: '#4fa3e0', w: '#bfe3ff' }, r: [
      'bbbbbbbbbbbb', 'bblllbbbbbbb', 'blwwlbbbllbb', 'bbbbbbblwwlb', 'bbbbbbbbbbbb', 'bbbllbbbbbbb',
      'bblwwlbbbbbb', 'bbbbbbbbllbb', 'bbbbbbblwwlb', 'bbbbbbbbbbbb', 'bllbbbbbbbbb', 'bbbbbbbbbbbb'] },
    fire: { p: { r: '#e53935', o: '#fb8c00', y: '#fdd835', b: '#6d4c41' }, r: [
      '............', '.....r......', '....rr..r...', '...rrorrr...', '...roooor...', '..rooyyoor..',
      '..royyyyor..', '...ryyyyr...', '..bbbbbbbb..', '.bb.bbbb.bb.', '............', '............'] },
    tomb: { p: { g: '#9e9e9e', d: '#616161', b: '#5d4037' }, r: [
      '............', '....gggg....', '...gggggg...', '...ggdggg...', '...gdddgg...', '...ggdggg...',
      '...gggggg...', '...gggggg...', '...gggggg...', '.bbbbbbbbbb.', 'bbbbbbbbbbbb', '............'] },
    statue: { p: { g: '#b0bec5', d: '#78909c' }, r: [
      '....gggg....', '....gddg....', '....gggg....', '...gggggg...', '..g.gggg.g..', '....gggg....',
      '....g..g....', '....g..g....', '..dddddddd..', '..dggggggd..', '..dddddddd..', '............'] },
    coral: { p: { p: '#ff7aa2', o: '#ffb74d', r: '#e91e63' }, r: [
      '............', '.p....o.....', '.p.p..o.o...', '.ppp.ooo..r.', '..p...o..rr.', '..p..oo..r..',
      '..pp.o..rr..', '...pp.o.r...', '....ppoor...', '.....pror...', '....ppppp...', '............'] },
    door: { p: { b: '#6d4c41', d: '#3e2723', y: '#ffd54f' }, r: [
      '...dddddd...', '..dbbbbbbd..', '.dbbbbbbbbd.', '.dbbdbbdbbd.', '.dbbdbbdbbd.', '.dbbbbbbbbd.',
      '.dbbbbbbybd.', '.dbbdbbdbbd.', '.dbbdbbdbbd.', '.dbbbbbbbbd.', '.dddddddddd.', '............'] },
    gear: { p: { y: '#ffb300', d: '#e65100' }, r: [
      '.....yy.....', '..y.yyyy.y..', '..yyyyyyyy..', '.yyyyddyyyy.', 'yyyyd..dyyyy', 'yyyd....dyyy',
      'yyyd....dyyy', 'yyyyd..dyyyy', '.yyyyddyyyy.', '..yyyyyyyy..', '..y.yyyy.y..', '.....yy.....'] },
  };

  // Human enemies drawn with the avatar renderer.
  const HUMANS = {
    navy: { skin: '#f5c69a', hair: 'สั้น', hairColor: '#1b1b1b', eyes: 'ดุ', mouth: 'เฉยๆ', outfit: 'โค้ทกัปตัน', outfitColor: '#2e86de', hat: 'หมวกเหล็ก', acc: 'ไม่มี', bg: '#1f5d96' },
    thug: { skin: '#d9a066', hair: 'หัวโล้น', hairColor: '#1b1b1b', eyes: 'ดุ', mouth: 'แสยะ', outfit: 'ลายทาง', outfitColor: '#c0392b', hat: 'ผ้าโพกหัว', acc: 'แผลเป็น', bg: '#4a1010' },
    cultist: { skin: '#bcd4ff', hair: 'หัวโล้น', hairColor: '#1b1b1b', eyes: 'ดุ', mouth: 'เฉยๆ', outfit: 'ชุดคลุม', outfitColor: '#2c3e50', hat: 'พ่อมด', acc: 'ไม่มี', bg: '#0b0912' },
    bandit: { skin: '#a86b3c', hair: 'ยาว', hairColor: '#1b1b1b', eyes: 'ดุ', mouth: 'แสยะ', outfit: 'เสื้อกั๊ก', outfitColor: '#f39c12', hat: 'ผ้าโพกหัว', acc: 'ผ้าปิดตา', bg: '#3a2e1d' },
    hunter: { skin: '#ffe0c2', hair: 'หางม้า', hairColor: '#5a3825', eyes: 'ดุ', mouth: 'แสยะ', outfit: 'เสื้อกั๊ก', outfitColor: '#27ae60', hat: 'ปีกกว้าง', acc: 'ไม่มี', bg: '#123d2b' },
    rival: { skin: '#f5c69a', hair: 'ยาว', hairColor: '#d94a4a', eyes: 'ดุ', mouth: 'แสยะ', outfit: 'โค้ทกัปตัน', outfitColor: '#8e44ad', hat: 'โจรสลัด', acc: 'ผ้าปิดตา', bg: '#4a1010' },
  };

  function svg(key) {
    const s = S[key];
    if (!s) return null;
    let rects = '';
    s.r.forEach((row, y) => {
      let x = 0;
      while (x < 12) {
        const ch = row[x];
        if (ch === '.' || !s.p[ch]) { x++; continue; }
        let w = 1;
        while (x + w < 12 && row[x + w] === ch) w++;
        rects += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${s.p[ch]}"/>`;
        x += w;
      }
    });
    return `<svg viewBox="0 0 12 12" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
  }

  // HTML for any board sprite key (monster, object or human enemy).
  function html(key, size = 32) {
    if (HUMANS[key]) return D20Avatar.html({ type: 'pixel', ...HUMANS[key] }, key, size, 'sprite-av');
    const s = svg(key);
    return `<span class="sprite" style="width:${size}px;height:${size}px">${s || '❔'}</span>`;
  }

  return { html, has: (k) => Boolean(S[k] || HUMANS[k]) };
})();
