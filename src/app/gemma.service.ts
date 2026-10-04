import { Injectable } from '@angular/core';
import { PantryItem, Suggestion } from './pantry';

// The Node server (server.mjs) decides where Gemma runs: Google AI Studio or local Ollama.
export const MODEL = 'Gemma';
const API_URL = '/api/chat';

const SYSTEM = `You help a busy person who forgets to eat. He is staying at his partner's place and feels shy about using her kitchen.
Pick ONE food from the provided "fair game" list that fits the time he has. Prefer no-cooking options, then microwave, then stove.
Be warm, short and a little funny. Never mention calories, diets or guilt. Remind him it's okay to take it.
Reply ONLY as JSON: {"pick": string, "where": string, "how": string, "note": string}.
"how" = one sentence on how to eat/make it. "note" = one short friendly line.`;

@Injectable({ providedIn: 'root' })
export class GemmaService {
  async suggest(minutes: number, items: PantryItem[], recent: string[]): Promise<Suggestion> {
    const options = items.filter(i => i.minutes <= minutes);
    const pool = options.length ? options : items;
    const user = `Time available: ${minutes} minute(s).
Fair game: ${JSON.stringify(pool)}
Recently suggested (avoid repeating): ${JSON.stringify(recent.slice(-3))}`;
    try {
      const content = await this.chat(SYSTEM, user, true);
      const parsed = JSON.parse(content);
      if (!parsed.pick) throw new Error('no pick');
      return { ...parsed, source: 'gemma' };
    } catch {
      return this.demoPick(pool, recent);
    }
  }

  async nudge(mealLabel: string): Promise<string | null> {
    try {
      const content = await this.chat(
        'Write ONE short, warm, slightly funny reminder (max 15 words) for someone who forgets to eat. No calories, no guilt. Plain text only.',
        `Meal: ${mealLabel}. He is busy working.`,
        false,
      );
      return content.trim().replace(/^"|"$/g, '');
    } catch {
      return null;
    }
  }

  private async chat(system: string, user: string, json: boolean): Promise<string> {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system, user, json }),
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    return data.content ?? '';
  }

  // Used when the server or model isn't reachable (e.g. an embedded demo).
  private demoPick(pool: PantryItem[], recent: string[]): Suggestion {
    const order = { none: 0, microwave: 1, stove: 2 } as const;
    const sorted = [...pool].sort((a, b) => order[a.cook] - order[b.cook]);
    const fresh = sorted.filter(i => !recent.includes(i.name));
    const list = fresh.length ? fresh : sorted;
    const item = list[Math.floor(Math.random() * Math.min(3, list.length))];
    const how =
      item.cook === 'none' ? 'Grab it and go. No dishes needed.'
      : item.cook === 'microwave' ? 'Microwave it, eat it, done.'
      : 'Quick stovetop job. Worth it.';
    return { pick: item.name, where: item.where, how, note: "It's on the list, so it's yours.", source: 'demo' };
  }
}
