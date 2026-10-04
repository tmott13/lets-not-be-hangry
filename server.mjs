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
const GOOGLE_MODEL = process.env.GEMMA_MODEL || 'gemma-3-27b-it';
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

// Gemma sometimes wraps JSON in ```json fences; strip them.
function cleanJson(text) {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  const start = t.indexOf('{'); const end = t.lastIndexOf('}');
  return start >= 0 && end > start ? t.slice(start, end + 1) : t;
}

async function askGoogle(system, user, json) {
  // Gemma on the Gemini API doesn't take a separate system instruction or JSON mode,
  // so the instructions go in the prompt and we clean up the reply ourselves.
  const prompt = `${system}\n\n${user}${json ? '\n\nRespond with JSON only, no code fences.' : ''}`;
  const res = await fetch(`${GEMINI_BASE}/v1beta/models/${GOOGLE_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.9, maxOutputTokens: 300 },
    }),
  });
  if (!res.ok) throw new Error(`Google ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  return json ? cleanJson(text) : text.trim();
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
  return json ? cleanJson(data.message?.content || '') : (data.message?.content || '').trim();
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, provider: PROVIDER, model: PROVIDER === 'google' ? GOOGLE_MODEL : OLLAMA_MODEL });
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
    res.json({ content });
  } catch (err) {
    console.error(err.message);
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
