// The browser build's pure game modules, shared with the node tests and
// tools, typed for this client: the rules (js/rules.js: the ring, serpents,
// bots, motes, thorns, scoring — a deterministic 30 Hz simulation), the
// content (js/content.js: themes, the 40 Journey stages, five lessons, the
// challenges, practice difficulties and the Daily), the round (js/session.js:
// input folded into commands per tick, the lesson tracker, as the old
// main.js did), the save model (js/progress.js) and the look per graphics
// level (js/look.js).
import * as rules from "../js/rules.js";
import * as content from "../js/content.js";
import * as session from "../js/session.js";
import * as progress from "../js/progress.js";
import * as look from "../js/look.js";

export interface Point { x: number; y: number }
export interface Thorn { x: number; y: number; r: number }
export interface Mote { x: number; y: number; bloom?: boolean }
export interface Serpent {
  id: string; name: string; isBot: boolean; hue: number; alive: boolean; boostOn: boolean;
  x: number; y: number; heading: number; targetHeading: number; trail: Point[]; boostTicksUsed: number; mass: number;
  score: { motes: number; eliminations: number };
}
export interface Ruleset {
  arena: { outer: number; inner: number };
  serpent: { bodyRadius: number; turnRate: number; boostTurnRate: number };
  goals: { type: string; value: number }[];
  allowUndo: boolean; timeLimitTicks: number;
  mechanics: { boost: boolean; thorns: boolean };
}
export interface State {
  tick: number; phase: "active" | "terminal"; terminal: { reason: string } | null; ruleset: Ruleset;
  arena: { outer: number; inner: number; thorns: Thorn[] }; serpents: Serpent[]; motes: Mote[];
}
export interface GameEvent { type: string; serpent?: string; x: number; y: number; bloom?: boolean }
export interface Theme {
  id: string; name: string;
  sky: number; fog: number; floor: number; floorRing: number; rim: number; rimGlow: number; island: number;
  plantA: number; plantB: number; plantTip: number; mote: number; moteBloom: number; spore: number;
  serpentHues: number[];
}
export interface LessonStep { id: string; text: string; hint: string; check: { type: string; value: number } }
export interface Item {
  id: string; kind: "journey" | "learn" | "challenge" | "daily" | "practice"; name: string; brief?: string;
  seed: number; ruleset: Ruleset; theme?: string; chapter?: string; chapterName?: string; index?: number;
  steps?: LessonStep[]; baseName?: string; dayKey?: string; difficulty?: string;
}
export interface Difficulty { id: string; name: string; brief: string; ruleset: Record<string, unknown> }
export interface Round {
  item: Item; state: State; steerDir: number; desiredHeading: number; boostWanted: boolean; over: boolean;
  lesson: { index: number; done: boolean } | null;
}
export interface BreakdownRow { key: string; label: string; detail?: string; amount: number }
export interface Result { total: number; goalMet: boolean; peakTrail: number; elapsedTicks: number; breakdown: BreakdownRow[] }
export interface GoalStatus { goal: unknown; current: number; target: number }
export interface Rec { plays: number; wins: number; best: number; bestPeak: number }
export interface Doc { version: 1; records: Record<string, Rec> }
export interface Budget { particles: number; spores: number; fronds: number; specks: number; samples: number; chunks: number; haloRings: number }
export interface Look {
  preset: string; dprCap: number; glow: "off" | "on" | "high"; shadows: "off" | "on"; grade: "off" | "on";
  particles: "off" | "low" | "high"; background: "static" | "animated"; detail: "plain" | "detailed"; effects: boolean; budget: Budget;
}

interface RulesApi {
  TICK_RATE: number; HEADING_MAX: number;
  defaultRuleset(o: Record<string, unknown>): Ruleset;
  seedFromString(s: string): number;
  dailyKey(d?: Date): string;
  getGoalStatus(s: State, id: string): GoalStatus | null;
  trailLength(rs: Ruleset, s: Serpent): number;
  makeResult(s: State, me: Serpent | undefined, sessionId: string): Result;
  getLegalActions(s: State, id: string): { undo: { valid: boolean }; boost: { valid: boolean } };
}
interface ContentApi {
  THEMES: Theme[]; JOURNEY: Item[]; LESSONS: Item[]; CHALLENGES: Item[]; PRACTICE_DIFFICULTIES: Difficulty[];
  themeById(id: string | undefined): Theme;
  dailyContent(key?: string): Item;
}
interface SessionApi {
  createRound(item: Item): Round;
  human(r: Round): Serpent | undefined;
  aim(r: Round, angle: number): void;
  undo(r: Round): boolean;
  tick(r: Round): GameEvent[];
  finished(r: Round): boolean;
  meters(trail: number): string;
}
interface ProgressApi {
  emptyDoc(): Doc; normalize(d: unknown): Doc; mergeDocs(a: unknown, b: unknown): Doc; sameDoc(a: unknown, b: unknown): boolean;
  readForeign(text: string): Doc | null; recordResult(doc: Doc, item: Item, res: Result): Rec | null;
}
interface LookApi { lookFor(tier: string, levelIndex: number): Look; particleCap(l: Look): number }

export const Rules = rules as unknown as RulesApi;
export const Content = content as unknown as ContentApi;
export const Session = session as unknown as SessionApi;
export const Progress = progress as unknown as ProgressApi;
export const Looks = look as unknown as LookApi;
