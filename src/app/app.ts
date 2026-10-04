import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { GemmaService, MODEL } from './gemma.service';
import {
  Cook,
  DEFAULT_ITEMS,
  DEFAULT_WINDOWS,
  FALLBACK_NUDGES,
  MealWindow,
  PantryItem,
  Suggestion,
} from './pantry';

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

@Component({
  selector: 'app-root',
  imports: [],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit, OnDestroy {
  private gemma = inject(GemmaService);
  readonly model = MODEL;

  items = signal<PantryItem[]>(load('fc.items', DEFAULT_ITEMS));
  restock = signal<string[]>(load('fc.restock', []));
  ateLog = signal<string[]>(load('fc.ate', [])); // ISO timestamps
  windows = signal<MealWindow[]>(load('fc.windows', DEFAULT_WINDOWS));

  suggestion = signal<Suggestion | null>(null);
  loading = signal<number | null>(null);
  lastMinutes = signal(5);
  recent = signal<string[]>([]);
  nudge = signal<string | null>(null);
  showList = signal(false);
  now = signal(new Date());

  draft = signal<PantryItem>({ name: '', where: '', minutes: 1, cook: 'none' });
  addError = signal<string | null>(null);
  cooks: Cook[] = ['none', 'microwave', 'stove'];

  readonly times = [
    { m: 1, label: '1 min', sub: 'grab & go', emoji: '🍌', tone: 'sun' },
    { m: 5, label: '5 min', sub: 'quick zap', emoji: '🌯', tone: 'mint' },
    { m: 15, label: '15 min', sub: 'real food', emoji: '🍳', tone: 'tomato' },
  ];

  emojiFor(name: string): string {
    const n = name.toLowerCase();
    const map: [RegExp, string][] = [
      [/banana/, '🍌'],
      [/apple/, '🍎'],
      [/burrito|wrap/, '🌯'],
      [/pizza/, '🍕'],
      [/egg/, '🍳'],
      [/toast|bread|pb|sandwich/, '🥪'],
      [/yogurt|granola/, '🥣'],
      [/oat/, '🥣'],
      [/cheese/, '🧀'],
      [/bar/, '🍫'],
      [/leftover/, '🥡'],
      [/noodle|ramen|pasta/, '🍜'],
      [/soup/, '🍲'],
      [/chip|cracker|pretzel/, '🥨'],
      [/nut|almond|trail/, '🥜'],
      [/fruit|grape|berr/, '🍇'],
      [/rice/, '🍚'],
    ];
    return map.find(([re]) => re.test(n))?.[1] ?? '🍽️';
  }

  lastAte = computed(() => {
    const log = this.ateLog();
    return log.length ? new Date(log[log.length - 1]) : null;
  });

  private timer?: ReturnType<typeof setInterval>;
  private nudgedFor = new Set<string>();

  constructor() {
    effect(() => save('fc.items', this.items()));
    effect(() => save('fc.restock', this.restock()));
    effect(() => save('fc.ate', this.ateLog()));
    effect(() => save('fc.windows', this.windows()));
  }

  ngOnInit() {
    this.checkNudge();
    this.timer = setInterval(() => {
      this.now.set(new Date());
      this.checkNudge();
    }, 60_000);
  }
  ngOnDestroy() {
    clearInterval(this.timer);
  }

  async pick(minutes: number) {
    this.loading.set(minutes);
    this.lastMinutes.set(minutes);
    const s = await this.gemma.suggest(minutes, this.items(), this.recent());
    this.recent.update((r) => [...r, s.pick].slice(-5));
    this.suggestion.set(s);
    this.loading.set(null);
  }

  ate() {
    this.ateLog.update((l) => [...l, new Date().toISOString()].slice(-50));
    this.nudge.set(null);
    this.suggestion.set(null);
  }

  finished(name: string) {
    if (!this.restock().includes(name)) this.restock.update((r) => [...r, name]);
    this.ate();
  }

  clearRestock() {
    this.restock.set([]);
  }

  setDraft<K extends keyof PantryItem>(key: K, value: PantryItem[K]) {
    this.draft.update((d) => ({ ...d, [key]: value }));
    this.addError.set(null);
  }

  addItem(event?: Event) {
    event?.preventDefault();
    const d = this.draft();
    const name = d.name.trim();
    if (!name) {
      this.addError.set('Add a food name first.');
      return;
    }
    if (this.items().some((i) => i.name.toLowerCase() === name.toLowerCase())) {
      this.addError.set(`${name} is already on the list.`);
      return;
    }
    const minutes = Math.max(1, Math.round(Number(d.minutes) || 1));
    this.items.update((list) => [
      ...list,
      { name, where: d.where.trim() || 'ask me', minutes, cook: d.cook },
    ]);
    this.draft.set({ name: '', where: '', minutes: 1, cook: 'none' });
  }

  removeItem(i: number) {
    this.items.update((list) => list.filter((_, idx) => idx !== i));
  }

  timeAgo(d: Date | null): string {
    if (!d) return 'not logged yet';
    const mins = Math.round((this.now().getTime() - d.getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const h = Math.floor(mins / 60);
    return h < 24 ? `${h}h ${mins % 60}m ago` : d.toLocaleDateString();
  }

  // A window counts as missed once it's past its end and nothing was logged inside it today.
  private async checkNudge() {
    const now = new Date();
    const hour = now.getHours() + now.getMinutes() / 60;
    const today = now.toDateString();
    for (const w of this.windows()) {
      const key = `${today}-${w.label}`;
      if (this.nudgedFor.has(key)) continue;
      const inWindowLate = hour >= w.end - 0.5 && hour < w.end + 2;
      const ateInWindow = this.ateLog().some((t) => {
        const d = new Date(t);
        const h = d.getHours() + d.getMinutes() / 60;
        return d.toDateString() === today && h >= w.start - 1 && h <= hour;
      });
      if (inWindowLate && !ateInWindow) {
        this.nudgedFor.add(key);
        const text =
          (await this.gemma.nudge(w.label)) ??
          FALLBACK_NUDGES[Math.floor(Math.random() * FALLBACK_NUDGES.length)];
        this.nudge.set(`${w.label} check: ${text}`);
        this.notify(text);
        break;
      }
    }
  }

  private notify(text: string) {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted')
      new Notification("Let's Not Be Hangry", { body: text });
  }
  enableNotifications() {
    if ('Notification' in window) Notification.requestPermission();
  }
}
