export type Cook = 'none' | 'microwave' | 'stove';

export interface PantryItem {
  name: string;
  where: string;
  minutes: number;
  cook: Cook;
}

export interface Suggestion {
  pick: string;
  where: string;
  how: string;
  note: string;
  source: 'gemma' | 'demo';
}

export interface MealWindow {
  label: string;
  start: number; // hour, 24h
  end: number;
}

export const DEFAULT_ITEMS: PantryItem[] = [
  { name: 'Banana', where: 'counter, fruit bowl', minutes: 1, cook: 'none' },
  { name: 'Protein bar', where: 'pantry, top shelf', minutes: 1, cook: 'none' },
  { name: 'String cheese', where: 'fridge door', minutes: 1, cook: 'none' },
  { name: 'Greek yogurt + granola', where: 'fridge top shelf / pantry left', minutes: 2, cook: 'none' },
  { name: 'PB&J', where: 'bread on counter, PB in pantry, jelly in fridge door', minutes: 5, cook: 'none' },
  { name: 'Frozen burrito', where: 'freezer door', minutes: 5, cook: 'microwave' },
  { name: 'Instant oatmeal', where: 'pantry, middle shelf', minutes: 5, cook: 'microwave' },
  { name: 'Leftovers', where: 'fridge, labeled containers', minutes: 5, cook: 'microwave' },
  { name: 'Eggs + toast', where: 'eggs in fridge, bread on counter', minutes: 15, cook: 'stove' },
];

export const DEFAULT_WINDOWS: MealWindow[] = [
  { label: 'Breakfast', start: 8, end: 10 },
  { label: 'Lunch', start: 12, end: 14 },
  { label: 'Dinner', start: 18, end: 20 },
];

export const FALLBACK_NUDGES = [
  "Hey. It's been a while. You + food, two minutes, I promise.",
  'Quick pit stop? Something from the fair-game list is calling your name.',
  "Brains run on snacks. Grab one, it's all yours.",
  'Pause the grind for 60 seconds and eat a thing.',
];
