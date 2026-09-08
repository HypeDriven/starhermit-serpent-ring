/**
 * Serpent Ring — canvas 2D renderer (no external dependencies).
 */
const M_PER_UNIT = 0.01; // 100 sim units == 1 display meter

export function render(canvas, state) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0a0f18';
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2, cy = h / 2;
  const scale = (Math.min(w, h) * 0.46) / state.arena.outer;

  // Arena ring: outer wall and inner island.
  ctx.beginPath();
  ctx.arc(cx, cy, state.arena.outer * scale, 0, Math.PI * 2);
  ctx.fillStyle = '#101b2a';
  ctx.fill();
  if (state.arena.inner > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, state.arena.inner * scale, 0, Math.PI * 2);
    ctx.fillStyle = '#0d1524';
    ctx.fill();
  }

  // Thorn hazards (kill on touch).
  for (const t of state.arena.thorns) {
    ctx.beginPath();
    ctx.arc(cx + t.x * scale, cy - t.y * scale, Math.max(3, t.r * scale), 0, Math.PI * 2);
    ctx.fillStyle = '#7a1f1f';
    ctx.fill();
  }

  // Motes.
  for (const m of state.motes) {
    const r = m.bloom ? 5 : 3;
    ctx.beginPath();
    ctx.arc(cx + m.x * scale, cy - m.y * scale, r, 0, Math.PI * 2);
    ctx.fillStyle = m.bloom ? '#ffd75e' : '#9fe8ff';
    ctx.fill();
  }

  // Serpents: head plus trail. Ownership must stay legible, so the player's
  // serpent is the pale one with a white head and every rival keeps its own
  // hue from the rules state.
  for (const s of state.serpents) {
    if (!s.alive && !s.boostOn) continue;
    const mine = !s.isBot;
    const trailColor = mine ? '#e8f4ff' : `hsl(${s.hue}, 70%, 62%)`;
    const headColor = mine ? '#ffffff' : `hsl(${s.hue}, 80%, 72%)`;
    const tr = s.trail;
    for (let i = tr.length - 1; i >= 0; i -= Math.max(1, Math.floor(tr.length / 60))) {
      ctx.beginPath();
      ctx.arc(cx + tr[i].x * scale, cy - tr[i].y * scale, s.boostOn ? 4 : 3, 0, Math.PI * 2);
      ctx.fillStyle = trailColor;
      ctx.fill();
    }
    const hx = cx + s.x * scale, hy = cy - s.y * scale;
    if (mine) {
      // Ring around the player's head: readable even with effects disabled.
      ctx.beginPath();
      ctx.arc(hx, hy, s.boostOn ? 10 : 9, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(232,244,255,0.55)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(hx, hy, s.boostOn ? 6 : 5, 0, Math.PI * 2);
    ctx.fillStyle = headColor;
    ctx.fill();
  }
}
