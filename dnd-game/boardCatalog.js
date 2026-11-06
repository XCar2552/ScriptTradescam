// Things that can stand on the battle board. Pixel art lives in public/sprites.js
// under the same keys. `kind`: monster | humanoid | object.
const ENEMIES = {
  skeleton: { name: 'โครงกระดูก', hp: 8 },
  ghost: { name: 'ผี', hp: 10 },
  shark: { name: 'ฉลามยักษ์', hp: 14 },
  crab: { name: 'ปูยักษ์', hp: 12 },
  octopus: { name: 'ปลาหมึกยักษ์', hp: 20 },
  dino: { name: 'ไดโนเสาร์', hp: 22 },
  scorpion: { name: 'แมงป่องยักษ์', hp: 14 },
  robot: { name: 'หุ่นยนต์ทหาร', hp: 16 },
  golem: { name: 'โกเลม', hp: 30 },
  snake: { name: 'งูพิษ', hp: 6 },
  bat: { name: 'ค้างคาว', hp: 5 },
  slime: { name: 'สไลม์', hp: 6 },
  wolf: { name: 'หมาป่า', hp: 10 },
  boss: { name: 'จอมมาร', hp: 40 },
  navy: { name: 'ทหารเรือ', hp: 10, humanoid: true },
  thug: { name: 'โจรสลัดอันธพาล', hp: 9, humanoid: true },
  cultist: { name: 'สาวกจันทร์ดับ', hp: 12, humanoid: true },
  bandit: { name: 'โจรทะเลทราย', hp: 9, humanoid: true },
  hunter: { name: 'นักล่า', hp: 11, humanoid: true },
  rival: { name: 'กัปตันศัตรู', hp: 20, humanoid: true },
};

const OBJECTS = {
  tree: 'ต้นไม้', palm: 'ต้นมะพร้าว', rock: 'ก้อนหิน', barrel: 'ถังไม้', crate: 'ลังไม้',
  chest: 'หีบสมบัติ', cannon: 'ปืนใหญ่', wall: 'กำแพง', water: 'น้ำ', fire: 'กองไฟ',
  tomb: 'หลุมศพ', statue: 'รูปปั้น', coral: 'ปะการัง', door: 'ประตู', gear: 'เฟืองยักษ์',
};

const TERRAINS = {
  grass: 'ทุ่งหญ้า', beach: 'ชายหาด', deck: 'ดาดฟ้าเรือ', jungle: 'ป่าทึบ', desert: 'ทะเลทราย',
  stone: 'ถ้ำ/ป้อมหิน', metal: 'โรงงานเหล็ก', reef: 'ใต้สมุทร', mist: 'ดินแดนหมอก', sky: 'ลานดวงดาว',
};

// Default terrain + suggested foes for the pirate world's islands.
const ISLAND_BOARD = {
  gull: { terrain: 'deck', foes: ['thug', 'thug', 'navy'], props: ['barrel', 'crate', 'cannon'] },
  dino: { terrain: 'jungle', foes: ['dino', 'snake', 'hunter'], props: ['tree', 'tree', 'rock'] },
  anchor: { terrain: 'stone', foes: ['navy', 'navy', 'navy'], props: ['wall', 'cannon', 'crate'] },
  sand: { terrain: 'desert', foes: ['scorpion', 'bandit', 'bandit'], props: ['rock', 'palm', 'statue'] },
  gear: { terrain: 'metal', foes: ['robot', 'robot'], props: ['gear', 'crate', 'barrel'] },
  pearl: { terrain: 'reef', foes: ['octopus', 'shark', 'crab'], props: ['coral', 'coral', 'water'] },
  mist: { terrain: 'mist', foes: ['skeleton', 'ghost', 'cultist'], props: ['tomb', 'tomb', 'fire'] },
  skyend: { terrain: 'sky', foes: ['boss', 'cultist', 'cultist'], props: ['statue', 'statue', 'chest'] },
};

module.exports = { ENEMIES, OBJECTS, TERRAINS, ISLAND_BOARD };
