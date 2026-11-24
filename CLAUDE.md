# AI Resume-to-Call HR Screening Agent

## Purpose
An HR recruiter uploads a resume (PDF/DOCX). Gemini extracts structured candidate details. A candidate card appears. The recruiter clicks "Call" and a Vapi web voice agent screens the candidate in the browser. When the call ends, Gemini analyses the transcript and the result is saved against the candidate.

## Fixed stack (NEVER change)
- React 19 + Vite + TypeScript + Tailwind CSS v4 (via the `@tailwindcss/vite` plugin) + lucide-react.
- Express 5 + TypeScript, run with tsx.
- A single `npm run dev` serves the API and the frontend on port 3000, using Vite in middleware mode.
- `@google/genai` with model `"gemini-3.6-flash"` by default, overridable via the optional server env var `GEMINI_MODEL` (history, 2026-11-24: `gemini-2.5-flash` is closed to new API keys; `gemini-3.8-flash` was persistently overloaded), ALWAYS called with `responseMimeType: "application/json"` and a `responseSchema`.
- `@vapi-ai/web` in the browser.
- Storage is `data/candidates.json`, accessed only through `server/repository.ts`.
- multer for uploads (PDF/DOCX only, 5 MB max); mammoth for DOCX→text.

## Folder layout
- `server.ts`: entry point
- `server/`: backend modules
- `shared/`: types used by both backend and frontend
- `src/`: React app
- `scripts/`: dev and test scripts
- `samples/`: test files, committed to git
- `data/`: runtime data, gitignored

## Conventions
- ESM (`"type": "module"`).
- Strict TypeScript, no `any`.
- Every API error is JSON `{ error: string, code?: string }` with the correct HTTP status.
- Missing values are `null`: never empty strings, never invented.
- Dates are ISO strings.
- ids come from `crypto.randomUUID()`.
- Express 5 uses path-to-regexp v8: never use `"*"` route patterns.

## Env vars
- `GEMINI_API_KEY`: server only, never sent to the browser.
- `GEMINI_MODEL` (optional): server only; overrides the default Gemini model.
- `VITE_VAPI_PUBLIC_KEY`, `VITE_VAPI_ASSISTANT_ID`: browser.

## Rule
Every step must end with `npm run typecheck` passing and a git commit.
