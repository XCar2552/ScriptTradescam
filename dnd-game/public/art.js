/* Theme artwork drawn in SVG (no image files needed). */
window.D20Art = (() => {
  const pirate = `
<svg viewBox="0 0 400 170" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" role="img" aria-label="เรือโจรสลัดกลางทะเลยามเย็น">
  <defs>
    <linearGradient id="pSky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2b1b4f"/><stop offset=".55" stop-color="#d9566b"/><stop offset="1" stop-color="#ffb35c"/>
    </linearGradient>
    <linearGradient id="pSea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1d4e89"/><stop offset="1" stop-color="#0b1d3a"/>
    </linearGradient>
    <radialGradient id="pSun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff3b0"/><stop offset="1" stop-color="#ffb35c" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="400" height="170" fill="url(#pSky)"/>
  <circle cx="300" cy="104" r="60" fill="url(#pSun)"/>
  <circle cx="300" cy="104" r="24" fill="#ffe08a"/>
  <g fill="#fff" opacity=".7"><circle cx="40" cy="22" r="1"/><circle cx="90" cy="12" r="1.2"/><circle cx="150" cy="30" r=".9"/><circle cx="210" cy="16" r="1"/><circle cx="360" cy="24" r="1.1"/></g>
  <path d="M0 108 Q60 98 120 106 T240 104 T400 106 V170 H0Z" fill="url(#pSea)"/>
  <path d="M250 108 q16-26 36-30 q10 0 22 10 q14-6 30 6 q10 8 14 14Z" fill="#14233f"/>
  <path d="M296 80 q-2-16 4-26 M300 54 q-12-4-20 4 M300 54 q12-6 20 2 M300 54 q-6-10-16-10 M300 54 q8-8 18-6" stroke="#14233f" stroke-width="3" fill="none" stroke-linecap="round"/>
  <g transform="translate(70 62)">
    <path d="M0 46 h96 l-12 18 h-72Z" fill="#3a2418"/>
    <path d="M8 46 h80" stroke="#c8913a" stroke-width="2"/>
    <rect x="46" y="-18" width="3" height="64" fill="#3a2418"/>
    <path d="M49 -14 q30 14 0 30Z" fill="#f2e6cc"/>
    <path d="M49 20 q36 12 0 24Z" fill="#f2e6cc"/>
    <path d="M46 -12 q-34 14 0 32Z" fill="#e8d9b8"/>
    <rect x="46" y="-30" width="22" height="13" fill="#111"/>
    <circle cx="57" cy="-24.5" r="3" fill="#fff"/><path d="M52 -20 l10 -1 M52 -21 l10 1" stroke="#fff" stroke-width="1.2"/>
  </g>
  <g stroke="#ffd9a0" stroke-width="1.5" fill="none" opacity=".6">
    <path d="M20 128 q10 -4 20 0 q10 4 20 0"/><path d="M180 140 q10 -4 20 0 q10 4 20 0"/><path d="M320 132 q10 -4 20 0 q10 4 20 0"/>
  </g>
  <g fill="#1b1428"><path d="M200 40 q5 -5 10 0 q5 -5 10 0"/><path d="M226 30 q4 -4 8 0 q4 -4 8 0"/></g>
</svg>`;

  const custom = `
<svg viewBox="0 0 400 170" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" role="img" aria-label="โลกที่คุณสร้างเอง">
  <defs><linearGradient id="cSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c1236"/><stop offset="1" stop-color="#5b3fa8"/></linearGradient></defs>
  <rect width="400" height="170" fill="url(#cSky)"/>
  <g fill="#fff"><circle cx="60" cy="30" r="1.4"/><circle cx="130" cy="18" r="1"/><circle cx="250" cy="40" r="1.2"/><circle cx="330" cy="20" r="1.5"/><circle cx="370" cy="60" r="1"/></g>
  <circle cx="320" cy="50" r="18" fill="#f1ecfa" opacity=".9"/>
  <path d="M0 170 L70 90 L120 130 L190 70 L260 140 L320 100 L400 150 V170Z" fill="#2a2339"/>
  <path d="M0 170 L90 120 L160 150 L240 110 L330 160 L400 140 V170Z" fill="#16131f"/>
  <text x="200" y="100" text-anchor="middle" font-size="44" fill="#e8b04a" font-family="sans-serif">✏️</text>
</svg>`;

  const soon = (emoji, a, b) => `
<svg viewBox="0 0 400 170" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
  <defs><linearGradient id="g${a.slice(1)}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
  <rect width="400" height="170" fill="url(#g${a.slice(1)})"/>
  <text x="200" y="110" text-anchor="middle" font-size="64" font-family="sans-serif">${emoji}</text>
</svg>`;

  const art = {
    pirate,
    custom,
    dragon: soon('🐉', '#4a1010', '#c2410c'),
    neon: soon('🌃', '#0f0c29', '#c026d3'),
    haunt: soon('🕯️', '#111', '#3f3f46'),
  };
  return { banner: (id) => art[id] || custom };
})();
