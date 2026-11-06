// 3D world map (Three.js, low-poly so it runs on phones).
// create(el, { onPick }) -> { update(view), setActive(bool), destroy() }
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const SCALE = 0.9;
const pos2d = (i) => new THREE.Vector3((i.x - 50) * SCALE, 0, (i.y - 50) * SCALE);

const mats = new Map();
function mat(color, extra = {}) {
  const key = color + JSON.stringify(extra);
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0.05, ...extra }));
  return mats.get(key);
}
function mesh(geo, color, extra) {
  const m = new THREE.Mesh(geo, mat(color, extra));
  return m;
}
function at(obj, x, y, z) { obj.position.set(x, y, z); return obj; }

// ---------- building blocks ----------
function base(r, sand = '#e9d29a', top = '#5fae5a', h = 0.8) {
  const g = new THREE.Group();
  g.add(at(mesh(new THREE.CylinderGeometry(r, r * 1.2, 1.4, 9), sand), 0, 0, 0));
  g.add(at(mesh(new THREE.CylinderGeometry(r * 0.78, r * 0.95, h, 9), top), 0, 0.7 + h / 2, 0));
  return g;
}
function tree(x, z, s = 1, leaf = '#2f7d3a', y = 1.5) {
  const g = new THREE.Group();
  g.add(at(mesh(new THREE.CylinderGeometry(0.12 * s, 0.18 * s, 1.2 * s, 5), '#6d4c41'), 0, 0.6 * s, 0));
  g.add(at(mesh(new THREE.ConeGeometry(0.7 * s, 1.6 * s, 6), leaf), 0, 1.7 * s, 0));
  return at(g, x, y, z);
}
function palm(x, z, y = 1.5) {
  const g = new THREE.Group();
  const trunk = mesh(new THREE.CylinderGeometry(0.1, 0.16, 1.8, 5), '#8d6e63');
  trunk.rotation.z = 0.2;
  g.add(at(trunk, 0, 0.9, 0));
  for (let k = 0; k < 5; k++) {
    const leaf = mesh(new THREE.ConeGeometry(0.18, 1.3, 3), '#3e9b4f');
    leaf.rotation.set(Math.PI / 2.4, (k / 5) * Math.PI * 2, 0, 'YXZ');
    g.add(at(leaf, 0.2, 1.8, 0));
  }
  return at(g, x, y, z);
}
function house(x, z, wall = '#f2e6cc', roof = '#c0392b', y = 1.5, s = 1) {
  const g = new THREE.Group();
  g.add(at(mesh(new THREE.BoxGeometry(1 * s, 0.8 * s, 0.9 * s), wall), 0, 0.4 * s, 0));
  const r = mesh(new THREE.ConeGeometry(0.8 * s, 0.6 * s, 4), roof);
  r.rotation.y = Math.PI / 4;
  g.add(at(r, 0, 1.1 * s, 0));
  return at(g, x, y, z);
}
function tower(x, z, h, wall, roof, y = 1.5, r = 0.5) {
  const g = new THREE.Group();
  g.add(at(mesh(new THREE.CylinderGeometry(r, r * 1.1, h, 7), wall), 0, h / 2, 0));
  g.add(at(mesh(new THREE.ConeGeometry(r * 1.3, r * 2, 7), roof), 0, h + r, 0));
  return at(g, x, y, z);
}

// ---------- island designs (by id, with generic fallbacks) ----------
const animators = [];
const DESIGNS = {
  gull(g) {
    g.add(base(4.2));
    g.add(house(-1.5, 0.8), house(0, 1.6, '#fff3d6', '#2e86de'), house(1.4, 0.4, '#f2e6cc', '#e67e22'), house(-0.4, -0.8, '#ecf0f1', '#8e44ad'));
    const lh = new THREE.Group();
    lh.add(at(mesh(new THREE.CylinderGeometry(0.45, 0.6, 3.4, 8), '#f5f5f5'), 0, 1.7, 0));
    lh.add(at(mesh(new THREE.CylinderGeometry(0.5, 0.52, 0.5, 8), '#c0392b'), 0, 1.2, 0));
    lh.add(at(mesh(new THREE.CylinderGeometry(0.47, 0.5, 0.5, 8), '#c0392b'), 0, 2.5, 0));
    const lamp = mesh(new THREE.SphereGeometry(0.4, 8, 6), '#ffe08a', { emissive: '#ffb300', emissiveIntensity: 1.2 });
    lh.add(at(lamp, 0, 3.7, 0));
    g.add(at(lh, 2.2, 1.5, -1.8));
    g.add(at(mesh(new THREE.BoxGeometry(3.4, 0.2, 0.8), '#8d6e63'), -4.6, 0.6, 1));
  },
  dino(g) {
    g.add(base(5, '#d8c38a', '#3f8f3a', 1.2));
    const big = new THREE.Group();
    big.add(at(mesh(new THREE.CylinderGeometry(0.5, 0.9, 4, 7), '#5d4037'), 0, 2, 0));
    big.add(at(mesh(new THREE.IcosahedronGeometry(2.4, 0), '#2e7d32'), 0, 5, 0));
    g.add(at(big, 0, 1.9, 0));
    for (const [x, z, s] of [[-2.8, 1.5, 1.2], [2.6, 1.8, 1], [-2, -2.4, 1.3], [2.8, -1.6, 1.1], [0.5, 3, 0.9], [-3.4, -0.4, 0.9]]) g.add(tree(x, z, s, '#1b5e20', 1.9));
    const rock = mesh(new THREE.DodecahedronGeometry(0.9, 0), '#9e9e9e');
    g.add(at(rock, 1.6, 2.2, 3));
  },
  anchor(g) {
    g.add(base(4.6, '#b0a99f', '#8d8d8d'));
    const wall = '#cfd8dc';
    g.add(at(mesh(new THREE.BoxGeometry(6, 1.2, 0.5), wall), 0, 2.1, 3), at(mesh(new THREE.BoxGeometry(6, 1.2, 0.5), wall), 0, 2.1, -3));
    g.add(at(mesh(new THREE.BoxGeometry(0.5, 1.2, 6), wall), 3, 2.1, 0), at(mesh(new THREE.BoxGeometry(0.5, 1.2, 6), wall), -3, 2.1, 0));
    for (const [x, z] of [[3, 3], [-3, 3], [3, -3], [-3, -3]]) g.add(tower(x, z, 2.4, '#eceff1', '#1f5d96', 1.5));
    g.add(tower(0, 0, 3.6, '#eceff1', '#1f5d96', 1.5, 0.8));
    const flag = mesh(new THREE.BoxGeometry(0.9, 0.5, 0.05), '#2e86de');
    g.add(at(flag, 0.5, 7.2, 0));
  },
  sand(g) {
    g.add(base(4.8, '#f0d58c', '#e8c46a'));
    const pyr = mesh(new THREE.ConeGeometry(2.4, 3, 4), '#d4a656');
    pyr.rotation.y = Math.PI / 4;
    g.add(at(pyr, -0.8, 3, -0.6));
    for (const [x, z, s] of [[2, 2, 1.4], [-2.6, 2.2, 1], [2.6, -2, 1.1]]) {
      const dune = mesh(new THREE.SphereGeometry(s, 7, 5), '#f3d27a');
      dune.scale.y = 0.35;
      g.add(at(dune, x, 1.5, z));
    }
    g.add(at(mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.1, 10), '#4fc3f7', { roughness: 0.2 }), 2.2, 1.56, 0.2));
    g.add(palm(2.9, 0.9, 1.5), palm(1.4, -0.4, 1.5));
  },
  gear(g) {
    g.add(base(4.4, '#9e9e9e', '#616161'));
    for (const [x, z, h, c] of [[-1.8, 1.2, 3, '#8d6e63'], [1.6, 1.6, 2.2, '#b0bec5'], [-0.6, -1.8, 4, '#a1887f'], [2, -1.2, 2.8, '#90a4ae']]) {
      g.add(at(mesh(new THREE.BoxGeometry(1.3, h, 1.3), c), x, 1.5 + h / 2, z));
    }
    g.add(at(mesh(new THREE.CylinderGeometry(0.25, 0.3, 3, 6), '#5d4037'), -0.6, 5.5, -1.8));
    const gearG = new THREE.Group();
    gearG.add(mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.35, 12), '#e8b04a', { metalness: 0.6, roughness: 0.4 }));
    for (let k = 0; k < 10; k++) {
      const tooth = mesh(new THREE.BoxGeometry(0.4, 0.35, 0.5), '#e8b04a', { metalness: 0.6, roughness: 0.4 });
      const a = (k / 10) * Math.PI * 2;
      tooth.position.set(Math.cos(a) * 1.6, 0, Math.sin(a) * 1.6);
      tooth.rotation.y = -a;
      gearG.add(tooth);
    }
    gearG.rotation.x = Math.PI / 2;
    g.add(at(gearG, 1.2, 5.2, 0));
    animators.push((t) => { gearG.rotation.y = t * 0.8; });
  },
  pearl(g) {
    const b = base(3.6, '#80cbc4', '#4db6ac', 0.4);
    b.position.y = -0.6;
    g.add(b);
    for (const [x, z, c, s] of [[-1, 0.6, '#ff7aa2', 1], [0.8, -0.8, '#ffb74d', 0.8], [0.6, 1.2, '#ba68c8', 0.9], [-1.4, -1, '#f06292', 0.7]]) {
      g.add(at(mesh(new THREE.ConeGeometry(0.3 * s, 1.6 * s, 5), c, { emissive: c, emissiveIntensity: 0.35 }), x, 1.2, z));
    }
    g.add(at(mesh(new THREE.CylinderGeometry(0.5, 0.7, 2.4, 6), '#e0f7fa'), 0, 1.6, 0));
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(3.6, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#b2ebf2', transparent: true, opacity: 0.3, roughness: 0.1, metalness: 0.3 }),
    );
    g.add(at(dome, 0, 0.2, 0));
  },
  mist(g) {
    g.add(base(4.4, '#5d6470', '#3b4250'));
    for (const [x, z] of [[-2, 1.5], [2.2, 1.8], [-2.6, -1.4], [1.8, -2.4]]) {
      const dead = new THREE.Group();
      dead.add(at(mesh(new THREE.CylinderGeometry(0.08, 0.16, 1.8, 4), '#2b2b2b'), 0, 0.9, 0));
      const br = mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.9, 4), '#2b2b2b');
      br.rotation.z = 0.9;
      dead.add(at(br, 0.3, 1.4, 0));
      g.add(at(dead, x, 1.9, z));
    }
    g.add(tower(0, -0.4, 4, '#4a3f6b', '#2b1b5e', 1.9, 0.9));
    g.add(tower(1.2, 0.6, 2.6, '#4a3f6b', '#2b1b5e', 1.9, 0.5));
    const fogMat = new THREE.MeshBasicMaterial({ color: '#e0e0f0', transparent: true, opacity: 0.18, depthWrite: false });
    const puffs = [];
    for (let k = 0; k < 6; k++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(1.6 + Math.random(), 8, 6), fogMat);
      const a = (k / 6) * Math.PI * 2;
      p.position.set(Math.cos(a) * 3.6, 2.4, Math.sin(a) * 3.6);
      puffs.push([p, a]);
      g.add(p);
    }
    animators.push((t) => puffs.forEach(([p, a]) => p.position.set(Math.cos(a + t * 0.15) * 3.6, 2.4 + Math.sin(t + a) * 0.3, Math.sin(a + t * 0.15) * 3.6)));
  },
  skyend(g) {
    const isle = new THREE.Group();
    const rock = mesh(new THREE.ConeGeometry(3.6, 5, 8), '#6d5a8e');
    rock.rotation.x = Math.PI;
    isle.add(at(rock, 0, -2.5, 0));
    isle.add(at(mesh(new THREE.CylinderGeometry(3.6, 3.6, 0.6, 8), '#c5b4ff'), 0, 0.3, 0));
    const crystal = mesh(new THREE.OctahedronGeometry(1.3, 0), '#ffe08a', { emissive: '#ffd34d', emissiveIntensity: 1.4 });
    isle.add(at(crystal, 0, 2.6, 0));
    for (let k = 0; k < 4; k++) isle.add(at(mesh(new THREE.BoxGeometry(0.4, 1.6, 0.4), '#e1d9f2'), Math.cos(k * 1.57) * 2.4, 1.4, Math.sin(k * 1.57) * 2.4));
    isle.position.y = 8;
    g.add(isle);
    for (let k = 0; k < 9; k++) {
      const step = mesh(new THREE.BoxGeometry(1, 0.15, 0.6), '#b2ebf2', { transparent: true, opacity: 0.7 });
      g.add(at(step, 3.2 + k * 0.35, 7.4 - k * 0.8, 1.2));
    }
    animators.push((t) => { crystal.rotation.y = t; isle.position.y = 8 + Math.sin(t * 0.8) * 0.4; });
  },
};
const GENERIC = [
  (g) => { g.add(base(4)); g.add(tree(-1, 1), tree(1.4, -0.6, 1.2), tree(0, -1.8, 0.9), house(1, 1.4)); },
  (g) => { g.add(base(4.4, '#e9d29a', '#7cb342')); g.add(palm(-1, 0.8), palm(1.2, -0.6), palm(0.2, 2)); },
  (g) => { g.add(base(3.8, '#a1887f', '#6d4c41')); g.add(tower(0, 0, 3, '#bcaaa4', '#5d4037')); },
];

function unknownIsland(g) {
  g.add(base(3.8, '#55606e', '#3a4352'));
  const fog = new THREE.Mesh(new THREE.SphereGeometry(3.8, 10, 8), new THREE.MeshBasicMaterial({ color: '#cfd8dc', transparent: true, opacity: 0.35, depthWrite: false }));
  fog.scale.y = 0.6;
  g.add(at(fog, 0, 2, 0));
}

function label(text, accent) {
  const c = document.createElement('canvas');
  const ctx2 = c.getContext('2d');
  const font = '600 40px system-ui, "Noto Sans Thai", sans-serif';
  ctx2.font = font;
  const w = Math.ceil(ctx2.measureText(text).width) + 40;
  c.width = w; c.height = 64;
  ctx2.font = font;
  ctx2.fillStyle = 'rgba(15,10,25,0.72)';
  ctx2.beginPath();
  if (ctx2.roundRect) ctx2.roundRect(0, 0, w, 64, 18); else ctx2.rect(0, 0, w, 64);
  ctx2.fill();
  if (accent) { ctx2.strokeStyle = accent; ctx2.lineWidth = 5; ctx2.stroke(); }
  ctx2.fillStyle = '#fff';
  ctx2.textBaseline = 'middle';
  ctx2.fillText(text, 20, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set((w / 64) * 2.6, 2.6, 1);
  s.renderOrder = 10;
  return s;
}

function ship() {
  const g = new THREE.Group();
  const hull = mesh(new THREE.BoxGeometry(2.4, 0.7, 1), '#5d4037');
  g.add(at(hull, 0, 0.35, 0));
  const bow = mesh(new THREE.ConeGeometry(0.55, 1, 4), '#5d4037');
  bow.rotation.z = -Math.PI / 2;
  bow.rotation.x = Math.PI / 4;
  g.add(at(bow, 1.65, 0.35, 0));
  g.add(at(mesh(new THREE.CylinderGeometry(0.07, 0.07, 3, 5), '#3e2723'), 0, 2, 0));
  const sail = mesh(new THREE.BoxGeometry(0.08, 1.6, 1.5), '#f2e6cc');
  g.add(at(sail, 0.05, 2.1, 0));
  g.add(at(mesh(new THREE.BoxGeometry(0.05, 0.4, 0.6), '#111'), 0, 3.4, 0.3));
  return g;
}

function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 256;
  const x = c.getContext('2d');
  const grd = x.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#22163f');
  grd.addColorStop(0.55, '#b84d6b');
  grd.addColorStop(1, '#ffb35c');
  x.fillStyle = grd;
  x.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function create(el, { onPick } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = skyTexture();
  scene.fog = new THREE.Fog('#d97a6c', 110, 230);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 500);
  camera.position.set(0, 40, 44);

  scene.add(new THREE.HemisphereLight('#ffe3c2', '#1d3557', 1.1));
  const sun = new THREE.DirectionalLight('#ffc38a', 1.8);
  sun.position.set(40, 60, 20);
  scene.add(sun);

  // Ocean with moving waves
  const seaGeo = new THREE.PlaneGeometry(260, 260, 56, 56);
  seaGeo.rotateX(-Math.PI / 2);
  const basePos = seaGeo.attributes.position.array.slice();
  const sea = new THREE.Mesh(seaGeo, new THREE.MeshStandardMaterial({ color: '#1f5d96', flatShading: true, roughness: 0.55, metalness: 0.1 }));
  scene.add(sea);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 18;
  controls.maxDistance = 95;
  controls.maxPolarAngle = 1.32;
  controls.target.set(0, 0, 0);

  const world = new THREE.Group();
  scene.add(world);
  const theShip = ship();
  scene.add(theShip);
  const ring = new THREE.Mesh(new THREE.RingGeometry(5.4, 6.1, 40), new THREE.MeshBasicMaterial({ color: '#e8b04a', transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.7;
  scene.add(ring);

  let key = '';
  let islands = [];
  let shipFrom = null, shipTo = null, shipT = 1, lastLoc = null;
  let focus = null;
  let active = true;
  let raf = 0;
  const t0 = performance.now();

  function islandPos(id) {
    const i = islands.find((x) => x.id === id);
    return i ? pos2d(i) : new THREE.Vector3();
  }
  function shipSpot(id) {
    return islandPos(id).add(new THREE.Vector3(5.2, 0, 3.2));
  }

  function rebuild(view) {
    animators.length = 0;
    world.clear();
    islands = view.islands;
    islands.forEach((i, k) => {
      const g = new THREE.Group();
      const hidden = i.unknown && !view.isDM;
      if (hidden) unknownIsland(g);
      else (DESIGNS[i.id] || GENERIC[k % GENERIC.length])(g);
      g.position.copy(pos2d(i));
      g.traverse((o) => { o.userData.islandId = i.id; });
      const lbl = label(`${hidden ? '❔' : i.emoji} ${i.name}`, i.id === view.location ? '#e8b04a' : null);
      lbl.position.set(0, i.id === 'skyend' ? 15 : 8, 0);
      lbl.userData.islandId = i.id;
      g.add(lbl);
      world.add(g);
    });
    // dashed route
    const pts = islands.map((i) => pos2d(i).setY(0.9));
    if (pts.length > 1) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: '#f2e6cc', dashSize: 1.6, gapSize: 1.2, transparent: true, opacity: 0.8 }));
      line.computeLineDistances();
      world.add(line);
    }
  }

  function update(view) {
    const k = JSON.stringify([view.islands.map((i) => [i.id, i.unknown, i.name]), view.isDM, view.location]);
    if (k !== key) { key = k; rebuild(view); }
    if (view.location !== lastLoc) {
      if (lastLoc === null) {
        theShip.position.copy(shipSpot(view.location));
        shipT = 1;
        // start looking at the crew's island
        const p = islandPos(view.location);
        controls.target.copy(p);
        camera.position.set(p.x, 40, p.z + 44);
      }
      else { shipFrom = theShip.position.clone(); shipTo = shipSpot(view.location); shipT = 0; }
      lastLoc = view.location;
    }
    if (view.selected && islands.some((i) => i.id === view.selected)) {
      const p = islandPos(view.selected);
      ring.position.x = p.x; ring.position.z = p.z;
      ring.visible = true;
      if (view.selected !== update.lastSel) { focus = p; update.lastSel = view.selected; }
    } else ring.visible = false;
    if (active && !raf) loop();
  }

  function resize() {
    const w = el.clientWidth || 300;
    const h = el.clientHeight || 240;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(el);
  resize();

  function loop() {
    raf = requestAnimationFrame(loop);
    if (!active || document.hidden || !el.isConnected) { cancelAnimationFrame(raf); raf = 0; return; }
    const t = (performance.now() - t0) / 1000;
    const arr = seaGeo.attributes.position.array;
    for (let i = 0; i < arr.length; i += 3) {
      const x = basePos[i], z = basePos[i + 2];
      arr[i + 1] = Math.sin(x * 0.12 + t * 1.1) * 0.35 + Math.cos(z * 0.1 + t * 0.9) * 0.3;
    }
    seaGeo.attributes.position.needsUpdate = true;
    seaGeo.computeVertexNormals();
    animators.forEach((f) => f(t));
    if (shipT < 1 && shipFrom && shipTo) {
      shipT = Math.min(1, shipT + 0.014);
      const e = shipT < 0.5 ? 2 * shipT * shipT : 1 - (-2 * shipT + 2) ** 2 / 2;
      theShip.position.lerpVectors(shipFrom, shipTo, e);
      const dir = shipTo.clone().sub(shipFrom);
      theShip.rotation.y = Math.atan2(-dir.z, dir.x);
      focus = theShip.position.clone();
    }
    theShip.position.y = Math.sin(t * 2) * 0.2;
    theShip.rotation.z = Math.sin(t * 1.6) * 0.06;
    if (focus) {
      controls.target.lerp(focus, 0.06);
      if (controls.target.distanceTo(focus) < 0.05) focus = null;
    }
    controls.update();
    renderer.render(scene, camera);
  }

  // Tap (not drag) on an island -> pick it
  const ray = new THREE.Raycaster();
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8 || performance.now() - down.t > 500) return;
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObjects(world.children, true).find((h) => h.object.userData.islandId);
    if (hit && onPick) onPick(hit.object.userData.islandId);
  });

  return {
    update,
    setActive(v) { active = v; if (v && !raf) loop(); },
    destroy() { cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); el.innerHTML = ''; },
  };
}
