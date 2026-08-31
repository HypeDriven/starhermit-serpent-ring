/**
 * Serpent Ring — DOM shell, navigation and settings.
 */
import { setMusicVolume, setSfxVolume } from './audio.js';

const $ = (sel) => document.querySelector(sel);

function showScreen(name) {
  const main = $('#sr-main');
  if (!main) return;
  for (const sec of main.querySelectorAll('[data-sr-screen]')) {
    sec.hidden = sec.getAttribute('data-sr-screen') !== name;
  }
}

export function initUI() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[id], [data-sr-nav]');
    if (!el || !el.id && !el.hasAttribute('data-sr-nav')) return;
    let nav = null;
    if (el.id === 'btn-play') nav = 'modes';
    else if (el.id === 'help-open' ) {}
    const id = el.id;
    if (id === 'btn-help-close') { showScreen('title'); }
    else if (id === 'btn-leave') { showScreen('title'); }
    else if (id === 'btn-resume') { showScreen('play'); }
    else if (el.hasAttribute('data-sr-nav')) nav = el.getAttribute('data-sr-nav');
    if (!nav && id) return;
    const target = nav || id;
    // map known ids to screens
    let screen = null;
    switch (target) {
      case 'modes': screen = 'modes'; break;
      case 'daily': screen = 'daily-setup'; break;
      case 'journey': screen = 'journey-setup'; break;
      case 'learn': screen = 'learn-setup'; break;
      case 'challenge': screen = 'challenge-setup'; break;
      case 'play-daily': screen = 'play'; break;
      default: screen = target; break;
    }
    if (screen) showScreen(screen);
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el || !el.hasAttribute('data-sr-audio')) return;
    const which = el.getAttribute('data-sr-audio');
    const v = Number(el.value);
    if (which === 'music') setMusicVolume(v);
    else if (which === 'sfx') setSfxVolume(v);
  });

  // Initial screen.
  showScreen('title');
}
