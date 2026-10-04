# Let's Not Be Hangry

A tiny app for someone who forgets to eat. Tap how much time you have (1, 5 or 15 min) and Gemma, an open-weight model, picks something from the "fair game" list and says where it is. "I finished it" adds the item to a restock list. Meal-window reminders show up if nothing was logged.

## How it's built

- **Angular 22** frontend (signals, zoneless)
- **Node/Express server** (`server.mjs`) that serves the app and forwards `/api/chat` to Gemma
- **Gemma**, two ways:
  - `LLM_PROVIDER=google`: Gemma through Google AI Studio (works anywhere, e.g. on Render)
  - `LLM_PROVIDER=ollama`: Gemma through local Ollama (nothing leaves your machine)
- The fair-game list, restock list and log are stored in the browser (localStorage).
- If the model can't be reached, the app falls back to a built-in "demo mode" pick.

## Run locally

Needs Node 22.22.3+ (or Node 24).

```
npm install
npm run build
```

Option A, Gemma via Google AI Studio:
```
GEMINI_API_KEY=your-key npm start
```

Option B, Gemma via local Ollama (fully private):
```
ollama pull gemma3:4b
LLM_PROVIDER=ollama npm start
```

Open http://localhost:3000. Check which model is in use at http://localhost:3000/api/health.

While developing the UI, run the server in one terminal (`npm start`) and `npm run dev` in another, then open http://localhost:4200 (it proxies `/api` to the server).

## Deploy on Render

1. Push this repo to GitHub.
2. In Render: New > Blueprint, pick the repo (it reads `render.yaml`). Or New > Web Service with:
   - Build command: `npm ci --include=dev && npm run build`
   - Start command: `npm start`
3. Add the environment variable `GEMINI_API_KEY` (from aistudio.google.com).
4. Optional: `GEMMA_MODEL` to use a different Gemma (default `gemma-3-27b-it`). To see which Gemma models your key can use:
   ```
   curl "https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_KEY" | grep gemma
   ```

## Settings (environment variables)

| Variable | Default | What it does |
| --- | --- | --- |
| `LLM_PROVIDER` | `google` if a key is set, else `ollama` | Where Gemma runs |
| `GEMINI_API_KEY` | (none) | Google AI Studio key |
| `GEMMA_MODEL` | `gemma-3-27b-it` | Gemma model on Google AI Studio |
| `OLLAMA_MODEL` | `gemma3:4b` | Gemma model in Ollama |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama address |
| `RATE_PER_HOUR` | `40` | Requests per visitor per hour |
| `DAILY_CAP` | `1000` | Total requests per day |
| `PORT` | `3000` | Server port (Render sets this) |

## Make it yours

Edit the fair-game list in the app, or change `DEFAULT_ITEMS` and `DEFAULT_WINDOWS` in `src/app/pantry.ts`.
