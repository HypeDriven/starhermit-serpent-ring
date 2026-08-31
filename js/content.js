/**
 * Serpent Ring — content: versioned stages, lessons, challenges, themes,
 * achievements and offline validators. All content is data with an
 * identifier, seed, initial state, goals, allowed mechanics, par values,
 * tutorial flags and a presentation theme.
 */

import { defaultRuleset, seedFromString, dailySeed, dailyKey, TICK_RATE } from './rules.js';

export const CONTENT_VERSION = 1;

/* ------------------------------------------------------------------ *
 *  Visual themes (five) — presentation only, never gameplay.
 * ------------------------------------------------------------------ */

export const THEMES = [
  {
    id: 'night-garden',
    name: 'Night Garden',
    sky: 0x060a12, fog: 0x0a1420, floor: 0x0b1620, floorRing: 0x12303a,
    rim: 0x1d5f6b, rimGlow: 0x37e2c8, island: 0x0e2231,
    plantA: 0x1b7f77, plantB: 0x2fd8b0, plantTip: 0x9ff5e2,
    mote: 0x9fe8ff, moteBloom: 0xffd97a, spore: 0x2c8f9e,
    serpentHues: [165, 190, 145, 210, 35, 300, 260, 15],
    accent: '#37e2c8', uiGlow: 'rgba(55,226,200,0.35)',
    ambience: { base: 110, shimmer: 0.35 },
  },
  {
    id: 'ember-thicket',
    name: 'Ember Thicket',
    sky: 0x120806, fog: 0x20100a, floor: 0x1c0f0a, floorRing: 0x3a1c10,
    rim: 0x6b2f1d, rimGlow: 0xe28a37, island: 0x2a140c,
    plantA: 0x7f3a1b, plantB: 0xd86a2f, plantTip: 0xf5c89f,
    mote: 0xffd0a0, moteBloom: 0x9fffd9, spore: 0x9e5a2c,
    serpentHues: [25, 45, 10, 60, 350, 150, 200, 280],
    accent: '#e28a37', uiGlow: 'rgba(226,138,55,0.35)',
    ambience: { base: 98, shimmer: 0.5 },
  },
  {
    id: 'frost-reeds',
    name: 'Frost Reeds',
    sky: 0x080b12, fog: 0x0c1420, floor: 0x0d1520, floorRing: 0x1a3040,
    rim: 0x2d5f6b, rimGlow: 0x7ad9e2, island: 0x12222e,
    plantA: 0x2b6f7f, plantB: 0x4fc8d8, plantTip: 0xdffcff,
    mote: 0xd0f4ff, moteBloom: 0xffe9a0, spore: 0x5a9eae,
    serpentHues: [195, 175, 220, 160, 45, 320, 250, 20],
    accent: '#7ad9e2', uiGlow: 'rgba(122,217,226,0.35)',
    ambience: { base: 132, shimmer: 0.25 },
  },
  {
    id: 'golden-hollow',
    name: 'Golden Hollow',
    sky: 0x0d0c06, fog: 0x181508, floor: 0x151308, floorRing: 0x2c2610,
    rim: 0x6b5a1d, rimGlow: 0xd9e237, island: 0x201c0c,
    plantA: 0x7f7a1b, plantB: 0xc8d82f, plantTip: 0xf4f5a0,
    mote: 0xfff4c0, moteBloom: 0xa0ffe0, spore: 0x9e962c,
    serpentHues: [60, 80, 40, 100, 180, 300, 0, 220],
    accent: '#d9e237', uiGlow: 'rgba(217,226,55,0.35)',
    ambience: { base: 120, shimmer: 0.4 },
  },
  {
    id: 'void-orchard',
    name: 'Void Orchard',
    sky: 0x0b0612, fog: 0x140a20, floor: 0x120a1c, floorRing: 0x28103a,
    rim: 0x4d1d6b, rimGlow: 0xb437e2, island: 0x1c0c2a,
    plantA: 0x5a1b7f, plantB: 0x9a2fd8, plantTip: 0xe2a0f5,
    mote: 0xe0c8ff, moteBloom: 0x8affd0, spore: 0x7a2c9e,
    serpentHues: [285, 310, 260, 330, 170, 45, 200, 120],
    accent: '#b437e2', uiGlow: 'rgba(180,55,226,0.35)',
    ambience: { base: 88, shimmer: 0.55 },
  },
];

export function themeById(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

/* ------------------------------------------------------------------ *
 *  Journey — 40 authored stages in 5 chapters. Difficulty grows by
 *  adding one mechanic at a time, then combining, then mastery stages.
 * ------------------------------------------------------------------ */

const CHAPTERS = [
  { id: 'ch1', name: 'First Sprouts', theme: 'night-garden' },
  { id: 'ch2', name: 'Ember Lessons', theme: 'ember-thicket' },
  { id: 'ch3', name: 'Cold Currents', theme: 'frost-reeds' },
  { id: 'ch4', name: 'Heavy Pollen', theme: 'golden-hollow' },
  { id: 'ch5', name: 'The Void Orchard', theme: 'void-orchard' },
];

// Bot skill ladder: sense radius, lookahead avoidance, think interval, boost appetite.
const SKILLS = [
  { sense: 3400, avoid: 1400, reaction: 9, aggression: 8 },
  { sense: 4200, avoid: 1500, reaction: 7, aggression: 14 },
  { sense: 5000, avoid: 1650, reaction: 6, aggression: 22 },
  { sense: 5800, avoid: 1800, reaction: 5, aggression: 32 },
  { sense: 6600, avoid: 2000, reaction: 4, aggression: 45 },
];

function stage(ch, idx, def) {
  const n = (ch - 1) * 8 + idx;
  const chapter = CHAPTERS[ch - 1];
  const id = 'j' + String(n).padStart(2, '0');
  const seed = seedFromString('journey:' + id);
  const mastery = idx === 8;
  const ruleset = defaultRuleset({
    id: 'journey-' + id,
    arena: {
      outer: def.outer ?? 12000,
      inner: def.inner ?? 3000,
      thornCount: def.thorns ?? 0,
    },
    bots: { count: def.bots ?? 0, skill: SKILLS[def.skill ?? 0] },
    goals: def.goals,
    winBy: def.winBy ?? 'goal',
    timeLimitTicks: def.timeLimit ? def.timeLimit * TICK_RATE : 0,
    mechanics: { boost: def.boost ?? true, thorns: (def.thorns ?? 0) > 0 },
    motes: def.motes ? { target: def.motes } : {},
    allowUndo: false,
    respawn: false,
  });
  return {
    id, version: CONTENT_VERSION, kind: 'journey',
    chapter: chapter.id, chapterName: chapter.name, index: n,
    name: def.name,
    brief: def.brief,
    seed,
    ruleset,
    par: def.par || null,
    tutorialFlags: def.tutorial || [],
    theme: def.theme || chapter.theme,
    mastery,
    expectedSeconds: def.expected || 90,
    ranked: true,
  };
}

export const JOURNEY = [
  // ---- Chapter 1: First Sprouts — steering, gathering, first rivals ----
  stage(1, 1, { name: 'First Light', brief: 'Grow to 9 m. No rivals, no thorns — just you and the motes.', bots: 0, boost: false, goals: [{ type: 'reach-length', value: 90 }], par: { ticks: 1500 }, expected: 60, tutorial: ['steer'] }),
  stage(1, 2, { name: 'Sweet Pollen', brief: 'Gather motes to reach 12 m.', bots: 0, boost: false, goals: [{ type: 'reach-length', value: 120 }], motes: 280, par: { ticks: 1700 }, expected: 70, tutorial: ['collect'] }),
  stage(1, 3, { name: 'Shed to Speed', brief: 'Boost is yours now. Reach 13 m — boosting spends length, so spend it well.', bots: 0, goals: [{ type: 'reach-length', value: 130 }], par: { ticks: 1600 }, expected: 70, tutorial: ['boost'] }),
  stage(1, 4, { name: 'One Shy Rival', brief: 'Reed drifts the ring. Outgrow it: reach 15 m first.', bots: 1, skill: 0, goals: [{ type: 'reach-length', value: 150 }], par: { ticks: 2100 }, expected: 90 }),
  stage(1, 5, { name: 'Twin Reeds', brief: 'Two rivals graze the garden. Reach 16 m before they do.', bots: 2, skill: 0, goals: [{ type: 'reach-length', value: 160 }], par: { ticks: 2300 }, expected: 100 }),
  stage(1, 6, { name: 'The Long Way Round', brief: 'A wide ring, sparse motes. Survive 90 seconds.', bots: 2, skill: 1, motes: 160, goals: [{ type: 'survive', value: 2700 }], winBy: 'survive', par: { score: 900 }, expected: 95 }),
  stage(1, 7, { name: 'First Thorns', brief: 'Three thorn clusters wake in the ring. Reach 15 m without pricking yourself.', bots: 2, skill: 1, thorns: 3, goals: [{ type: 'reach-length', value: 150 }], par: { ticks: 2600 }, expected: 100, tutorial: ['avoid'] }),
  stage(1, 8, { name: 'Mastery: Night Garden', brief: 'Four rivals, thorns, and a score to beat: 2600 points.', bots: 4, skill: 1, thorns: 4, goals: [{ type: 'score', value: 2600 }], winBy: 'score', par: { ticks: 4200 }, expected: 150 }),

  // ---- Chapter 2: Ember Lessons — pressure, eliminations ----
  stage(2, 1, { name: 'Warm Currents', brief: 'Ember light, three hungry rivals. Reach 17 m.', bots: 3, skill: 1, goals: [{ type: 'reach-length', value: 170 }], par: { ticks: 2600 }, expected: 110 }),
  stage(2, 2, { name: 'Crossing Paths', brief: 'Cut across a rival\'s line and live: eliminate 1 serpent.', bots: 3, skill: 1, goals: [{ type: 'eliminate', value: 1 }], par: { ticks: 3600 }, expected: 130, tutorial: ['eliminate'] }),
  stage(2, 3, { name: 'Cinder Sprint', brief: 'Score 1400 points in 100 seconds.', bots: 3, skill: 1, goals: [{ type: 'score', value: 1400 }], winBy: 'score', timeLimit: 100, par: { ticks: 2400 }, expected: 100 }),
  stage(2, 4, { name: 'Thorn Nursery', brief: 'Six clusters of ember thorn. Reach 18 m.', bots: 3, skill: 2, thorns: 6, goals: [{ type: 'reach-length', value: 180 }], par: { ticks: 3200 }, expected: 120 }),
  stage(2, 5, { name: 'The Squeeze', brief: 'A narrow ring. Survive 2 minutes with four rivals.', bots: 4, skill: 2, outer: 10500, inner: 4500, goals: [{ type: 'survive', value: 3600 }], winBy: 'survive', par: { score: 1600 }, expected: 125 }),
  stage(2, 6, { name: 'Ash Bloom', brief: 'Bloom motes burn bright. Score 2400; boost often, eat what you shed.', bots: 4, skill: 2, thorns: 3, goals: [{ type: 'score', value: 2400 }], winBy: 'score', par: { ticks: 3800 }, expected: 140 }),
  stage(2, 7, { name: 'Riot of Reeds', brief: 'Five rivals. Eliminate 2 of them.', bots: 5, skill: 2, thorns: 3, goals: [{ type: 'eliminate', value: 2 }], par: { ticks: 5400 }, expected: 170 }),
  stage(2, 8, { name: 'Mastery: Ember Thicket', brief: 'Last one glowing wins. Outlive all five rivals.', bots: 5, skill: 2, thorns: 5, goals: [{ type: 'survive', value: 999999 }], winBy: 'last-standing', par: { ticks: 6000 }, expected: 200 }),

  // ---- Chapter 3: Cold Currents — tighter rings, sharper rivals ----
  stage(3, 1, { name: 'Thin Ice', brief: 'A slender ring of frost. Reach 18 m.', bots: 3, skill: 2, outer: 11000, inner: 5000, goals: [{ type: 'reach-length', value: 180 }], par: { ticks: 3400 }, expected: 120 }),
  stage(3, 2, { name: 'Slow Synchrony', brief: 'Score 2200 among patient, watchful rivals.', bots: 4, skill: 2, outer: 11000, inner: 4000, goals: [{ type: 'score', value: 2200 }], winBy: 'score', par: { ticks: 4200 }, expected: 150 }),
  stage(3, 3, { name: 'Hoarfrost Hedge', brief: 'Eight thorn clusters. Reach 20 m.', bots: 4, skill: 3, thorns: 8, goals: [{ type: 'reach-length', value: 200 }], par: { ticks: 4200 }, expected: 150 }),
  stage(3, 4, { name: 'White-Out', brief: 'Sparse motes in a wide field. Survive 150 seconds.', bots: 4, skill: 3, motes: 150, goals: [{ type: 'survive', value: 4500 }], winBy: 'survive', par: { score: 1800 }, expected: 155 }),
  stage(3, 5, { name: 'Cold Snap', brief: 'Score 1800 in 90 seconds. Keep moving.', bots: 4, skill: 3, goals: [{ type: 'score', value: 1800 }], winBy: 'score', timeLimit: 90, par: { ticks: 2200 }, expected: 95 }),
  stage(3, 6, { name: 'Frozen Choir', brief: 'Five rivals sing thin. Eliminate 2.', bots: 5, skill: 3, thorns: 4, goals: [{ type: 'eliminate', value: 2 }], par: { ticks: 6000 }, expected: 190 }),
  stage(3, 7, { name: 'Glacier Pace', brief: 'A small ring, six rivals. Reach 22 m.', bots: 6, skill: 3, outer: 10000, inner: 3500, goals: [{ type: 'reach-length', value: 220 }], par: { ticks: 5400 }, expected: 180 }),
  stage(3, 8, { name: 'Mastery: Frost Reeds', brief: 'Score 4200 under the frost lights.', bots: 5, skill: 3, thorns: 6, goals: [{ type: 'score', value: 4200 }], winBy: 'score', par: { ticks: 7200 }, expected: 240 }),

  // ---- Chapter 4: Heavy Pollen — density and tempo ----
  stage(4, 1, { name: 'Thick Air', brief: 'Motes everywhere, rivals too. Reach 22 m.', bots: 5, skill: 3, motes: 330, goals: [{ type: 'reach-length', value: 220 }], par: { ticks: 3600 }, expected: 130 }),
  stage(4, 2, { name: 'Golden Minute', brief: 'Score 1600 in 60 seconds.', bots: 5, skill: 3, motes: 300, goals: [{ type: 'score', value: 1600 }], winBy: 'score', timeLimit: 60, par: { ticks: 1600 }, expected: 65 }),
  stage(4, 3, { name: 'Bramble Gate', brief: 'Ten thorn clusters guard the pollen. Reach 23 m.', bots: 5, skill: 4, thorns: 10, goals: [{ type: 'reach-length', value: 230 }], par: { ticks: 5400 }, expected: 180 }),
  stage(4, 4, { name: 'Swarm Season', brief: 'Seven rivals. Survive 3 minutes.', bots: 7, skill: 4, goals: [{ type: 'survive', value: 5400 }], winBy: 'survive', par: { score: 2600 }, expected: 185 }),
  stage(4, 5, { name: 'Amber Ambush', brief: 'Eliminate 3 rivals among the thorns.', bots: 6, skill: 4, thorns: 5, goals: [{ type: 'eliminate', value: 3 }], par: { ticks: 8100 }, expected: 250 }),
  stage(4, 6, { name: 'Heavy Crown', brief: 'Score 5200. The ring rewards the patient.', bots: 6, skill: 4, thorns: 4, goals: [{ type: 'score', value: 5200 }], winBy: 'score', par: { ticks: 9000 }, expected: 300 }),
  stage(4, 7, { name: 'Pollen Rush', brief: 'Score 2600 in 2 minutes, six rivals racing you.', bots: 6, skill: 4, motes: 280, goals: [{ type: 'score', value: 2600 }], winBy: 'score', timeLimit: 120, par: { ticks: 3000 }, expected: 125 }),
  stage(4, 8, { name: 'Mastery: Golden Hollow', brief: 'Outlive seven rivals in a thorned ring.', bots: 7, skill: 4, thorns: 7, goals: [{ type: 'survive', value: 999999 }], winBy: 'last-standing', par: { ticks: 9000 }, expected: 300 }),

  // ---- Chapter 5: The Void Orchard — everything at once ----
  stage(5, 1, { name: 'Strange Fruit', brief: 'The orchard glows violet. Reach 24 m.', bots: 6, skill: 4, thorns: 4, goals: [{ type: 'reach-length', value: 240 }], par: { ticks: 5400 }, expected: 180 }),
  stage(5, 2, { name: 'Hollow Stars', brief: 'Score 3000 in 100 seconds.', bots: 6, skill: 4, goals: [{ type: 'score', value: 3000 }], winBy: 'score', timeLimit: 100, par: { ticks: 2700 }, expected: 105 }),
  stage(5, 3, { name: 'Black Thorns', brief: 'Twelve clusters. Reach 25 m.', bots: 6, skill: 4, thorns: 12, goals: [{ type: 'reach-length', value: 250 }], par: { ticks: 6600 }, expected: 220 }),
  stage(5, 4, { name: 'The Vigil', brief: 'Survive 4 minutes in the orchard.', bots: 7, skill: 4, thorns: 4, goals: [{ type: 'survive', value: 7200 }], winBy: 'survive', par: { score: 3400 }, expected: 245 }),
  stage(5, 5, { name: 'Reaper\'s Row', brief: 'Eliminate 4 rivals.', bots: 7, skill: 4, thorns: 5, goals: [{ type: 'eliminate', value: 4 }], par: { ticks: 10800 }, expected: 340 }),
  stage(5, 6, { name: 'Void Chorus', brief: 'Score 6000 among eight rivals.', bots: 8, skill: 4, thorns: 5, goals: [{ type: 'score', value: 6000 }], winBy: 'score', par: { ticks: 10800 }, expected: 350 }),
  stage(5, 7, { name: 'Last Orchard', brief: 'Eight rivals, ten thorn clusters, one winner.', bots: 8, skill: 4, thorns: 10, goals: [{ type: 'survive', value: 999999 }], winBy: 'last-standing', par: { ticks: 10800 }, expected: 360 }),
  stage(5, 8, { name: 'Mastery: Serpent Ring', brief: 'Score 8000 in the heart of the void. Become the ring.', bots: 8, skill: 4, thorns: 8, motes: 300, goals: [{ type: 'score', value: 8000 }], winBy: 'score', par: { ticks: 13500 }, expected: 450 }),
];

export function journeyStage(id) {
  return JOURNEY.find((s) => s.id === id) || null;
}

/* ------------------------------------------------------------------ *
 *  Learn — interactive lessons; each step requires the player to act.
 *  Completion predicates read engine state; hints use getLegalActions.
 * ------------------------------------------------------------------ */

export const LESSONS = [
  {
    id: 'learn-steer', version: CONTENT_VERSION, kind: 'learn',
    name: 'Lesson 1 — Steering', theme: 'night-garden',
    brief: 'Your serpent always glides forward. You choose where.',
    seed: seedFromString('lesson:steer'),
    ruleset: defaultRuleset({
      id: 'lesson-steer', bots: { count: 0 }, mechanics: { boost: false, thorns: false },
      goals: [{ type: 'survive', value: 99999999 }], winBy: 'survive', arena: { outer: 11000, inner: 2500 },
      motes: { target: 170 },
    }),
    steps: [
      { id: 'turn', text: 'Steer: move your pointer (or hold ← / →) to bend your path. Turn at least a quarter circle.', hint: 'Point where you want to go; the serpent follows smoothly.', check: { type: 'heading-turned', value: 16384 } },
      { id: 'ring', text: 'Follow the ring all the way around once without touching the edges.', hint: 'The pale rim and the dark island both end your glide.', check: { type: 'laps', value: 1 } },
      { id: 'done', text: 'Well steered. Glide on a moment to finish.', hint: '', check: { type: 'ticks', value: 60 } },
    ],
    expectedSeconds: 60, ranked: false,
  },
  {
    id: 'learn-collect', version: CONTENT_VERSION, kind: 'learn',
    name: 'Lesson 2 — Gathering', theme: 'night-garden',
    brief: 'Motes of light are food. Food is length.',
    seed: seedFromString('lesson:collect'),
    ruleset: defaultRuleset({
      id: 'lesson-collect', bots: { count: 0 }, mechanics: { boost: false, thorns: false },
      goals: [{ type: 'survive', value: 99999999 }], winBy: 'survive', arena: { outer: 11000, inner: 2500 },
      motes: { target: 260 },
    }),
    steps: [
      { id: 'eat5', text: 'Eat 5 motes. Aim your path through the glowing seeds.', hint: 'Golden bloom motes are worth much more.', check: { type: 'motes', value: 5 } },
      { id: 'grow', text: 'Grow to 10 m. Watch your ribbon lengthen behind you.', hint: 'Every mote adds to your length.', check: { type: 'length', value: 100 } },
      { id: 'bloom', text: 'Catch a bright bloom mote.', hint: 'Bloom motes are larger and warmer than the rest.', check: { type: 'bloom', value: 1 } },
    ],
    expectedSeconds: 90, ranked: false,
  },
  {
    id: 'learn-boost', version: CONTENT_VERSION, kind: 'learn',
    name: 'Lesson 3 — Boosting', theme: 'ember-thicket',
    brief: 'Spend length for speed. What you shed, you may eat again.',
    seed: seedFromString('lesson:boost'),
    ruleset: defaultRuleset({
      id: 'lesson-boost', bots: { count: 0 }, mechanics: { boost: true, thorns: false },
      goals: [{ type: 'survive', value: 99999999 }], winBy: 'survive', arena: { outer: 11000, inner: 2500 },
      motes: { target: 250 },
    }),
    steps: [
      { id: 'mass', text: 'First, gather strength: eat 6 motes.', hint: 'Boost unlocks once you carry enough mass.', check: { type: 'motes', value: 6 } },
      { id: 'boost', text: 'Hold boost (pointer press, Space, or gamepad A) and glide fast for a breath.', hint: 'Boosting sheds length behind you as fresh motes.', check: { type: 'boost-ticks', value: 45 } },
      { id: 'reclaim', text: 'Turn around and eat 3 of the motes you shed.', hint: 'Your shed light is yours to reclaim.', check: { type: 'motes-after', value: 3 } },
    ],
    expectedSeconds: 90, ranked: false,
  },
  {
    id: 'learn-avoid', version: CONTENT_VERSION, kind: 'learn',
    name: 'Lesson 4 — Other Serpents', theme: 'frost-reeds',
    brief: 'Bodies are walls. Heads are fragile.',
    seed: seedFromString('lesson:avoid'),
    ruleset: defaultRuleset({
      id: 'lesson-avoid', bots: { count: 2, skill: { sense: 2800, avoid: 1500, reaction: 10, aggression: 0 } },
      mechanics: { boost: true, thorns: false },
      goals: [{ type: 'survive', value: 99999999 }], winBy: 'survive', arena: { outer: 11000, inner: 3000 },
    }),
    steps: [
      { id: 'near', text: 'Glide near a rival\'s trail — then bend away. Never touch another body.', hint: 'Your head is the only fragile part. Theirs is too.', check: { type: 'proximity', value: 1 } },
      { id: 'cut', text: 'Make a rival strike your body: cut across its path — or simply outlast the moment.', hint: 'Boost across their nose, then curl away.', check: { type: 'eliminate-or-survive', value: 2400 } },
    ],
    expectedSeconds: 120, ranked: false,
  },
  {
    id: 'learn-mastery', version: CONTENT_VERSION, kind: 'learn',
    name: 'Lesson 5 — The Whole Ring', theme: 'void-orchard',
    brief: 'Everything together: steer, gather, boost, avoid, outlast.',
    seed: seedFromString('lesson:mastery'),
    ruleset: defaultRuleset({
      id: 'lesson-mastery', bots: { count: 3, skill: { sense: 3800, avoid: 1400, reaction: 8, aggression: 10 } },
      mechanics: { boost: true, thorns: true }, arena: { outer: 11500, inner: 3000, thornCount: 3 },
      goals: [{ type: 'survive', value: 99999999 }], winBy: 'survive',
    }),
    steps: [
      { id: 'final', text: 'Reach 13 m and survive among rivals and thorns.', hint: 'All your skills, one ring.', check: { type: 'length-alive', value: 130 } },
    ],
    expectedSeconds: 150, ranked: false,
  },
];

export function lessonById(id) {
  return LESSONS.find((l) => l.id === id) || null;
}

/* ------------------------------------------------------------------ *
 *  Challenges — constrained goals: move limits, speed targets,
 *  altered layouts, restricted tools.
 * ------------------------------------------------------------------ */

export const CHALLENGES = [
  {
    id: 'ch-ember-sprint', version: CONTENT_VERSION, kind: 'challenge',
    name: 'Ember Sprint', theme: 'ember-thicket',
    brief: 'Reach 13 m in 45 seconds. Speed target — waste nothing.',
    seed: seedFromString('challenge:ember-sprint'),
    ruleset: defaultRuleset({
      id: 'ch-ember-sprint', bots: { count: 2, skill: { sense: 3800, avoid: 1400, reaction: 8, aggression: 10 } },
      goals: [{ type: 'reach-length', value: 130 }], timeLimitTicks: 45 * TICK_RATE,
      arena: { outer: 10500, inner: 2500 }, motes: { target: 280 },
    }),
    expectedSeconds: 50, ranked: true,
  },
  {
    id: 'ch-frugal-bloom', version: CONTENT_VERSION, kind: 'challenge',
    name: 'Frugal Bloom', theme: 'golden-hollow',
    brief: 'A boost budget of 240 ticks for the whole run. Reach 15 m.',
    seed: seedFromString('challenge:frugal-bloom'),
    ruleset: defaultRuleset({
      id: 'ch-frugal-bloom', bots: { count: 2, skill: { sense: 3800, avoid: 1400, reaction: 8, aggression: 10 } },
      goals: [{ type: 'reach-length', value: 150 }], moveLimit: 240,
      arena: { outer: 11000, inner: 3000 }, motes: { target: 260 },
    }),
    expectedSeconds: 150, ranked: true,
  },
  {
    id: 'ch-thorn-maze', version: CONTENT_VERSION, kind: 'challenge',
    name: 'Thorn Maze', theme: 'frost-reeds',
    brief: 'Sixteen thorn clusters, an altered narrow layout. Reach 15 m.',
    seed: seedFromString('challenge:thorn-maze'),
    ruleset: defaultRuleset({
      id: 'ch-thorn-maze', bots: { count: 0 },
      goals: [{ type: 'reach-length', value: 150 }],
      arena: { outer: 10500, inner: 4500, thornCount: 16 }, mechanics: { boost: true, thorns: true },
      motes: { target: 250 },
    }),
    expectedSeconds: 180, ranked: true,
  },
  {
    id: 'ch-still-waters', version: CONTENT_VERSION, kind: 'challenge',
    name: 'Still Waters', theme: 'night-garden',
    brief: 'No boost at all. Pure lines. Reach 16 m among four rivals.',
    seed: seedFromString('challenge:still-waters'),
    ruleset: defaultRuleset({
      id: 'ch-still-waters', bots: { count: 4, skill: { sense: 4400, avoid: 1500, reaction: 7, aggression: 15 } },
      mechanics: { boost: false, thorns: false },
      goals: [{ type: 'reach-length', value: 160 }], arena: { outer: 11500, inner: 3000 },
    }),
    expectedSeconds: 200, ranked: true,
  },
  {
    id: 'ch-mote-rush', version: CONTENT_VERSION, kind: 'challenge',
    name: 'Mote Rush', theme: 'void-orchard',
    brief: 'Score 2000 points in 75 seconds. Nothing but appetite.',
    seed: seedFromString('challenge:mote-rush'),
    ruleset: defaultRuleset({
      id: 'ch-mote-rush', bots: { count: 3, skill: { sense: 5000, avoid: 1500, reaction: 6, aggression: 25 } },
      goals: [{ type: 'score', value: 2000 }], winBy: 'score', timeLimitTicks: 75 * TICK_RATE,
      motes: { target: 330 }, arena: { outer: 11000, inner: 2500 },
    }),
    expectedSeconds: 80, ranked: true,
  },
  {
    id: 'ch-one-life', version: CONTENT_VERSION, kind: 'challenge',
    name: 'One Life Ring', theme: 'void-orchard',
    brief: 'Six fierce rivals. One life. Outlast them all.',
    seed: seedFromString('challenge:one-life'),
    ruleset: defaultRuleset({
      id: 'ch-one-life', bots: { count: 6, skill: { sense: 6000, avoid: 1700, reaction: 4, aggression: 40 } },
      goals: [{ type: 'survive', value: 999999 }], winBy: 'last-standing',
      arena: { outer: 11000, inner: 3500, thornCount: 4 }, mechanics: { boost: true, thorns: true },
    }),
    expectedSeconds: 240, ranked: true,
  },
];

export function challengeById(id) {
  return CHALLENGES.find((c) => c.id === id) || null;
}

/* ------------------------------------------------------------------ *
 *  Practice difficulty presets (not ranked; assists declared)
 * ------------------------------------------------------------------ */

export const PRACTICE_DIFFICULTIES = [
  {
    id: 'calm', name: 'Calm',
    brief: 'Two gentle rivals, a wide ring, no thorns.',
    ruleset: {
      bots: { count: 2, skill: { sense: 3000, avoid: 1400, reaction: 10, aggression: 5 } },
      arena: { outer: 12500, inner: 2500 }, motes: { target: 260 },
      goals: [{ type: 'score', value: 2000 }], winBy: 'score', allowUndo: true,
    },
  },
  {
    id: 'standard', name: 'Standard',
    brief: 'Four rivals, a few thorns — the classic ring.',
    ruleset: {
      bots: { count: 4, skill: { sense: 5000, avoid: 1500, reaction: 6, aggression: 22 } },
      arena: { outer: 12000, inner: 3000, thornCount: 3 }, mechanics: { boost: true, thorns: true },
      goals: [{ type: 'score', value: 3000 }], winBy: 'score', allowUndo: true,
    },
  },
  {
    id: 'fierce', name: 'Fierce',
    brief: 'Seven sharp rivals in a thorned ring.',
    ruleset: {
      bots: { count: 7, skill: { sense: 6200, avoid: 1800, reaction: 4, aggression: 42 } },
      arena: { outer: 11500, inner: 3500, thornCount: 6 }, mechanics: { boost: true, thorns: true },
      goals: [{ type: 'score', value: 4500 }], winBy: 'score', allowUndo: true,
    },
  },
];

/* ------------------------------------------------------------------ *
 *  Daily challenge — one shared seed and ruleset per UTC day.
 * ------------------------------------------------------------------ */

export function dailyContent(key = dailyKey()) {
  const seed = dailySeed(new Date(key + 'T00:00:00Z'));
  const variant = seed % 3; // three rotating daily skeletons
  const skeletons = [
    {
      name: 'Daily Bloom', theme: THEMES[seed % THEMES.length].id,
      goals: [{ type: 'score', value: 2200 }], winBy: 'score', timeLimitTicks: 120 * TICK_RATE,
      bots: { count: 5, skill: { sense: 5000, avoid: 1500, reaction: 6, aggression: 25 } },
      arena: { outer: 11500, inner: 3000, thornCount: 3 },
    },
    {
      name: 'Daily Coil', theme: THEMES[(seed >>> 3) % THEMES.length].id,
      goals: [{ type: 'score', value: 2600 }], winBy: 'score', timeLimitTicks: 100 * TICK_RATE,
      bots: { count: 6, skill: { sense: 5500, avoid: 1600, reaction: 5, aggression: 30 } },
      arena: { outer: 11000, inner: 4000, thornCount: 5 },
    },
    {
      name: 'Daily Ring', theme: THEMES[(seed >>> 5) % THEMES.length].id,
      goals: [{ type: 'score', value: 3000 }], winBy: 'score', timeLimitTicks: 90 * TICK_RATE,
      bots: { count: 4, skill: { sense: 5800, avoid: 1700, reaction: 5, aggression: 35 } },
      arena: { outer: 10500, inner: 2500, thornCount: 7 },
    },
  ];
  const sk = skeletons[variant];
  const ruleset = defaultRuleset({
    id: 'daily-' + key,
    arena: sk.arena,
    bots: sk.bots,
    goals: sk.goals,
    winBy: sk.winBy,
    timeLimitTicks: sk.timeLimitTicks,
    mechanics: { boost: true, thorns: true },
  });
  return {
    id: 'daily-' + key, version: CONTENT_VERSION, kind: 'daily',
    name: sk.name + ' — ' + key, brief: 'One shared ring for everyone today. Rank by score when time runs out.',
    seed, ruleset, theme: sk.theme, dayKey: key,
    expectedSeconds: Math.round(sk.timeLimitTicks / TICK_RATE),
    ranked: true, tutorialFlags: [], par: null, mastery: false,
  };
}

/* ------------------------------------------------------------------ *
 *  Achievements — small static set; stable keys; idempotent unlocks.
 * ------------------------------------------------------------------ */

export const ACHIEVEMENTS = [
  { key: 'first_completion', name: 'First Glow', desc: 'Finish your first round of Serpent Ring.', kind: 'first-completion' },
  { key: 'mechanic_mastery', name: 'Ring Scholar', desc: 'Complete all five lessons in Learn.', kind: 'mechanic-mastery' },
  { key: 'daily_streak_3', name: 'Three Dawns', desc: 'Complete the daily challenge on three consecutive days.', kind: 'streak' },
  { key: 'void_champion', name: 'Void Champion', desc: 'Complete Journey stage 40, “Mastery: Serpent Ring”.', kind: 'milestone' },
  { key: 'mote_legend', name: 'Mote Legend', desc: 'Gather 25,000 motes across your whole journey.', kind: 'long-term' },
];

/* ------------------------------------------------------------------ *
 *  Content registry + offline validators
 * ------------------------------------------------------------------ */

export function allContent() {
  return [
    ...LESSONS,
    ...JOURNEY,
    ...CHALLENGES,
  ];
}

export function contentById(id) {
  if (id.startsWith('daily-')) return dailyContent(id.replace('daily-', ''));
  return allContent().find((c) => c.id === id) || null;
}

/**
 * Offline validators: prove basic legality, reachable goals, bounded
 * duration, and absence of soft locks. Reachability is proven by a
 * deterministic all-bot simulation; for elimination goals we accept the
 * explicitly declared solution class "eliminations occur at the required
 * rate across the field" (credited kills ≥ goal within the time bound).
 */
export function validateContentItem(item, { simulate } = {}) {
  const problems = [];
  if (!item.id || typeof item.id !== 'string') problems.push('missing id');
  if (!Number.isInteger(item.seed)) problems.push('missing integer seed');
  if (!item.ruleset) problems.push('missing ruleset');
  if (!item.theme) problems.push('missing theme');
  if (typeof item.expectedSeconds !== 'number' || item.expectedSeconds <= 0) problems.push('missing bounded expected duration');
  const rs = item.ruleset;
  if (rs) {
    if (!Array.isArray(rs.goals) || rs.goals.length === 0) problems.push('no goals');
    if (rs.arena.outer <= rs.arena.inner + 2500) problems.push('ring too narrow');
    if (rs.motes.target < 20) problems.push('mote field too thin — possible soft lock');
    if (rs.serpent.baseSpeed <= 0 || rs.serpent.turnRate <= 0) problems.push('illegal motion constants');
    if (rs.mechanics.thorns && rs.arena.thornCount > 24) problems.push('thorn count unbounded');
    for (const g of rs.goals || []) {
      if (!['reach-length', 'score', 'survive', 'eliminate'].includes(g.type)) problems.push('unknown goal type ' + g.type);
      if (!(g.value > 0)) problems.push('goal without value');
      if (g.type === 'reach-length' && g.value > rs.serpent.maxTrail) problems.push('length goal unreachable (above trail cap)');
      if (g.type === 'eliminate' && g.value > rs.bots.count) problems.push('elimination goal exceeds rival count');
    }
  }
  if (simulate && rs && item.kind !== 'learn') {
    const proof = simulate(item);
    if (!proof.ok) problems.push('simulation proof failed: ' + proof.why);
  }
  return { id: item.id, ok: problems.length === 0, problems };
}

export function validateAllContent(opts = {}) {
  return allContent().map((c) => validateContentItem(c, opts));
}
