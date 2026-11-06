// Difficulty levels. Used by the AI prompt AND enforced by the server
// (AI-chosen DCs are clamped to `dc`, AI damage is scaled by `dmg`).
const DIFFICULTY = {
  easy: {
    label: '😊 ง่าย', dc: [5, 14], defaultDC: 10, dmg: 0.5,
    ai: 'ใจดีกับผู้เล่น อนุญาตเกือบทุกอย่างที่สมเหตุสมผล (ปฏิเสธเฉพาะสิ่งที่เป็นไปไม่ได้จริงๆ) ให้คำใบ้บ่อย ศัตรูอ่อนแอและพลาดบ่อย ความผิดพลาดมีผลเบาๆ ไม่ค่อยลด HP',
  },
  normal: {
    label: '🙂 ปกติ', dc: [8, 20], defaultDC: 12, dmg: 1,
    ai: 'สมดุลและยุติธรรม ให้คำใบ้เมื่อผู้เล่นติด ศัตรูมีฝีมือพอสมควร ความผิดพลาดมีผลตามสมควร',
  },
  hard: {
    label: '😤 ยาก', dc: [10, 24], defaultDC: 14, dmg: 1.5,
    ai: 'เข้มงวด ศัตรูฉลาด แข็งแกร่ง และวางแผนเป็น ทรัพยากรหายาก ให้คำใบ้น้อย ความผิดพลาดมีราคาแพง แผนที่ไม่รอบคอบมักล้มเหลว',
  },
  nightmare: {
    label: '💀 นรก', dc: [12, 28], defaultDC: 16, dmg: 2,
    ai: 'โหดที่สุด ทุกอย่างอันตราย ศัตรูไม่ปรานีและโจมตีจุดอ่อน ไม่มีคำใบ้ ความผิดพลาดอาจถึงตาย แต่ต้องยุติธรรมเสมอ (ไม่ฆ่าผู้เล่นโดยไม่มีเหตุผล)',
  },
};
const level = (key) => DIFFICULTY[key] || DIFFICULTY.normal;
module.exports = { DIFFICULTY, level };
