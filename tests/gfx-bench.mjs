// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only): picks a preset on the title's Graphics
// screen, starts Practice → Fierce (seven rivals, thorns) and keeps the player's serpent weaving with the
// real keyboard controls (← / → held in turn, Space boosts) — bodies, motes, glow, spores and eat /
// boost / death particles run all the time. A finished round goes back in with "Play again".
export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

export async function setPreset(page, preset) {
  await page.waitForSelector('[data-sr-screen="title"]:not([hidden])', { timeout: 30000 });
  await page.click('#btn-gfx-open');
  await page.waitForSelector('[data-sr-screen="graphics"]:not([hidden])');
  await page.selectOption('#gfx-preset', preset);
  await page.waitForFunction((p) => document.body.dataset.gfxPreset === p, preset);
  await page.click('#btn-gfx-close');
  await page.waitForSelector('[data-sr-screen="title"]:not([hidden])');
}

export async function start(page) {
  await page.click('#btn-play');
  await page.click('#mode-list .sr-mode-card >> nth=0'); // Practice
  await page.waitForSelector('[data-sr-screen="practice-difficulty"]:not([hidden])');
  await page.click('#diff-list .sr-blockbtn >> nth=-1'); // Fierce
  await page.waitForSelector('[data-sr-screen="play"]:not([hidden])');
  let open = true, i = 0;
  page.once('close', () => { open = false; });
  (async () => {
    while (open) {
      try {
        if (await page.locator('[data-sr-screen="results"]:not([hidden])').count()) {
          await page.click('[data-sr-screen="results"] [data-sr-nav="retry"]', { timeout: 3000 });
          await page.waitForSelector('[data-sr-screen="play"]:not([hidden])', { timeout: 5000 });
        } else {
          const key = i++ % 2 ? 'ArrowLeft' : 'ArrowRight';
          await page.keyboard.down(key);
          if (i % 3 === 0) await page.keyboard.down('Space');
          await page.waitForTimeout(500);
          await page.keyboard.up('Space');
          await page.keyboard.up(key);
        }
      } catch (e) { if (!open) return; if (process.env.BENCH_DEBUG) console.error(e.message); }
      await page.waitForTimeout(150).catch(() => {});
    }
  })();
  await page.waitForTimeout(1500);
}
