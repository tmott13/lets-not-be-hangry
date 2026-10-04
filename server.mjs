// Let's Not Be Hangry: tiny Node server.
// Serves the built Angular app and forwards /api/chat to Gemma.
// LLM_PROVIDER=google -> Gemma via Google AI Studio (needs GEMINI_API_KEY)
// LLM_PROVIDER=ollama -> Gemma via local Ollama (nothing leaves your machine)
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const KEY = process.env.GEMINI_API_KEY || '';
const PROVIDER = (process.env.LLM_PROVIDER || (KEY ? 'google' : 'ollama')).toLowerCase();
let GOOGLE_MODEL = process.env.GEMMA_MODEL || 'gemma-4-31b-it';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma3:4b';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const GEMINI_BASE = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';

// Simple abuse protection for a public demo.
const PER_IP_PER_HOUR = Number(process.env.RATE_PER_HOUR || 40);
const DAILY_CAP = Number(process.env.DAILY_CAP || 1000);
const hits = new Map();
let day = new Date().toDateString();
let dayCount = 0;
function allowed(ip) {
  const today = new Date().toDateString();
  if (today !== day) { day = today; dayCount = 0; hits.clear(); }
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 3600_000);
  if (recent.length >= PER_IP_PER_HOUR || dayCount >= DAILY_CAP) return false;
  recent.push(now); hits.set(ip, recent); dayCount++;
  return true;
}

// Pull a usable JSON object out of a model reply. Handles code fences, <think> blocks,
// extra text around the JSON, and replies that contain several {...} chunks.
function extractJson(text) {
  const t = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '');
  const candidates = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== '{') continue;
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < t.length; j++) {
      const c = t[j];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) { candidates.push(t.slice(i, j + 1)); break; }
    }
  }
  for (const c of candidates.reverse()) {
    try { const o = JSON.parse(c); if (o && typeof o === 'object' && o.pick) return JSON.stringify(o); } catch { /* try next */ }
  }
  throw new Error(`No usable JSON in reply: ${t.slice(0, 160)}`);
}

let lastReply = null;
let gemmaList = null; // filled by discoverGemma()
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function discoverGemma() {
  const res = await fetch(`${GEMINI_BASE}/v1beta/models?pageSize=200`, { headers: { 'x-goog-api-key': KEY } });
  if (!res.ok) throw new Error(`ListModels ${res.status}`);
  const data = await res.json();
  const names = (data.models || [])
    .filter(m => /gemma/i.test(m.name) && (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => m.name.replace(/^models\//, ''));
  if (!names.length) throw new Error('No Gemma models available for this key');
  // Prefer instruction-tuned, newest version, biggest size.
  const score = n => {
    const ver = parseFloat((n.match(/gemma-?(\d+(?:\.\d+)?)/i) || [])[1] || '0');
    const size = parseFloat((n.match(/(\d+(?:\.\d+)?)b/i) || [])[1] || '0');
    return (/-it\b|-it$/.test(n) ? 1000 : 0) + ver * 100 + Math.min(size, 99);
  };
  names.sort((a, b) => score(b) - score(a));
  console.log('Gemma models available:', names.join(', '));
  gemmaList = names;
  return names[0];
}

async function askGoogleOnce(model, system, user, json) {
  // Gemma on the Gemini API doesn't take a separate system instruction or JSON mode,
  // so the instructions go in the prompt and we clean up the reply ourselves.
  const prompt = `${system}\n\n${user}${json ? '\n\nRespond with JSON only, no code fences.' : ''}`;
  const res = await fetch(`${GEMINI_BASE}/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.9, maxOutputTokens: 2048 },
    }),
  });
  if (!res.ok) {
    const err = new Error(`Google ${res.status} (${model}): ${(await res.text()).slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  // Skip any "thinking" parts some models return; keep only the answer text.
  const parts = data.candidates?.[0]?.content?.parts || [];
  const text = parts.filter(p => !p.thought).map(p => p.text || '').join('');
  lastReply = { finishReason: data.candidates?.[0]?.finishReason ?? null, text: text.slice(0, 300) };
  return json ? extractJson(text) : text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}


// Try the configured Gemma; on 404 find what's available, on 5xx retry once and then
// fall back to the next available Gemma model.
async function askGoogle(system, user, json) {
  const tried = new Set();
  let model = GOOGLE_MODEL;
  for (let attempt = 0; attempt < 4; attempt++) {
    tried.add(model);
    try {
      const out = await askGoogleOnce(model, system, user, json);
      if (model !== GOOGLE_MODEL) { console.log(`Switching default model to ${model}`); GOOGLE_MODEL = model; }
      return out;
    } catch (err) {
      const s = err.status || 0;
      if (s === 404 || s >= 500) {
        if (s >= 500 && attempt === 0) { await sleep(700); tried.delete(model); continue; } // one quick retry
        if (!gemmaList) { try { await discoverGemma(); } catch (e) { console.error(e.message); } }
        const next = (gemmaList || []).find(m => !tried.has(m));
        if (next) { console.log(`${model} failed (${s}), trying ${next}`); model = next; continue; }
      }
      throw err;
    }
  }
  throw new Error('All Gemma attempts failed');
}

async function askOllama(system, user, json) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL, stream: false, ...(json ? { format: 'json' } : {}),
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  const data = await res.json();
  return json ? extractJson(data.message?.content || '') : (data.message?.content || '').trim();
}

let lastError = null;

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    provider: PROVIDER,
    model: PROVIDER === 'google' ? GOOGLE_MODEL : OLLAMA_MODEL,
    hasKey: Boolean(KEY),
    lastError,
    lastReply,
  });
});

app.post('/api/chat', async (req, res) => {
  if (!allowed(req.ip)) return res.status(429).json({ error: 'Slow down! Try again in a bit.' });
  const { system, user, json } = req.body || {};
  if (typeof system !== 'string' || typeof user !== 'string' || system.length + user.length > 8000) {
    return res.status(400).json({ error: 'Bad request' });
  }
  try {
    const content = PROVIDER === 'google'
      ? await askGoogle(system, user, !!json)
      : await askOllama(system, user, !!json);
    lastError = null;
    res.json({ content });
  } catch (err) {
    console.error(err.message);
    lastError = { at: new Date().toISOString(), message: String(err.message).replace(KEY || '__none__', '[key]').slice(0, 300) };
    res.status(502).json({ error: 'Model unavailable' });
  }
});

const dist = path.join(__dirname, 'dist', 'lets-not-be-hangry', 'browser');
app.use(express.static(dist));
app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));

app.listen(PORT, () => {
  console.log(`Let's Not Be Hangry on http://localhost:${PORT} (provider: ${PROVIDER})`);
  if (PROVIDER === 'google' && !KEY) console.warn('GEMINI_API_KEY is missing.');
});