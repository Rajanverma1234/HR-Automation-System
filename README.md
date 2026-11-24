# AI Resume-to-Call HR Screening Agent

An HR recruiter uploads a resume (PDF or DOCX). Gemini extracts structured candidate details and a candidate card appears. The recruiter clicks **Call**, and a Vapi voice agent screens the candidate live in the browser, in English, Hindi or Hinglish. When the call ends, Gemini analyses the transcript, and the result (CTC, notice period, interest, a recommendation and more) is saved against the candidate.

## Features

- **Resume parsing**: drag-and-drop PDF/DOCX (up to 5 MB). Gemini returns schema-validated JSON. Missing values stay `null` and are never invented.
- **Candidate grid**: search across name, contact details, company, title and skills; filter by New/Called; delete with confirmation.
- **Detail panel**: full resume data plus the call history, with the analysis, resume-detail checks and transcript for each call.
- **Browser voice screening**: a Vapi web call with a per-candidate system prompt. It confirms resume details, asks for anything missing, collects CTC and notice period, and closes politely. It shows a live transcript, a timer and an "agent speaking" indicator.
- **Call analysis**: a structured `CallAnalysis` from Gemini, with a shortlist/hold/reject recommendation. If analysis fails, the transcript is still saved.
- **Automatic interview scheduling**: when the candidate agrees to a day on the call ("theek hai mam, kal 3 baje schedule kar do", "Thursday after 2 pm"), the interview is booked with no recruiter step. Relative days are resolved against the real date of the call (IST). The dashboard shows Scheduled / Today / **Overdue** / Completed / No-show / Cancelled, and the recruiter can mark the outcome or reschedule. See [Interview scheduling](#interview-scheduling).
- **Follow-up calls** reuse answers from the previous call ("confirm these briefly instead of asking again").
- **CSV export**: one row per call, Excel-friendly (UTF-8 BOM, ₹ and Devanagari intact) and protected against formula injection.
- Clear error states throughout. The layout works on mobile at 375 px and is keyboard accessible.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 19, Vite, TypeScript, Tailwind CSS v4 (`@tailwindcss/vite`), lucide-react |
| Backend | Express 5 + TypeScript, run with `tsx`; Vite in middleware mode, so one process on port 3000 |
| AI | `@google/genai`, model `gemini-3.6-flash` (override with `GEMINI_MODEL`), always with `responseMimeType: "application/json"` and a `responseSchema` |
| Voice | `@vapi-ai/web` (browser WebRTC call) |
| Uploads | `multer` (memory, PDF/DOCX only, 5 MB), `mammoth` (DOCX → text) |
| Storage | `data/candidates.json`, only through `server/repository.ts` |

## Prerequisites

- Node.js **20.19+** or **22+**
- **Chrome or Edge** (desktop)
- A **microphone**
- A Google AI Studio account (Gemini API key) and a Vapi account

## Setup

1. **Install dependencies**
   ```bash
   npm install
   cp .env.example .env
   ```
2. **Gemini key**: open [Google AI Studio → API keys](https://aistudio.google.com/apikey), create a key, and put it in `.env` as `GEMINI_API_KEY`. Put it **only** in `.env`, never in `.env.example`.
3. **Vapi** ([dashboard.vapi.ai](https://dashboard.vapi.ai)):
   1. Go to **Organization → API Keys** and copy the **Public Key**, not the private one. Put it in `.env` as `VITE_VAPI_PUBLIC_KEY`.
   2. Go to **Assistants → Create Assistant** (a blank template is fine), then fill in each tab:
      - **Model**: provider **OpenAI**, model **gpt-4o**. This must match `VAPI_MODEL` in [shared/company.ts](shared/company.ts), because the app sends this model as an override. If your account uses another provider/model, change both.
      - **First message / system prompt**: anything, e.g. "Hello" / "You are a helpful assistant". The app replaces both on every call.
      - **Transcriber**: one that handles Hindi/English code-switching, e.g. **Deepgram `nova-3`** with language **`multi`**. An English-only transcriber will garble Hinglish answers.
      - **Voice**: a voice that can speak both Hindi and English, e.g. an **ElevenLabs multilingual** model (`eleven_multilingual_v2` / `eleven_turbo_v2_5`) or an Azure `hi-IN` neural voice.
      - **Tools / Functions**: turn on **End Call** so the agent can hang up after its closing line.
   3. Publish the assistant, then copy its **Assistant ID** into `.env` as `VITE_VAPI_ASSISTANT_ID`.
4. **Fill in `.env`**:
   ```env
   GEMINI_API_KEY=your-gemini-key
   VITE_VAPI_PUBLIC_KEY=your-vapi-public-key
   VITE_VAPI_ASSISTANT_ID=your-assistant-id
   # Optional: use a different Gemini model (default gemini-3.6-flash)
   # GEMINI_MODEL=gemini-3.5-flash-lite
   ```
5. **Run**
   ```bash
   npm run dev
   ```
   Open **http://localhost:3000**. Use `localhost`, not a LAN IP: the microphone only works in a secure context. To try it without your own resume, run `npm run sample` and upload `samples/sample-resume.docx`, or run `npm run seed -- --with-call`.

## npm scripts

| Script | What it does |
|---|---|
| `npm run dev` | Starts Express plus Vite (middleware mode) on port 3000 (`PORT` overrides it) |
| `npm run typecheck` | `tsc --noEmit` over server, shared, src and scripts |
| `npm run seed` | Adds a fictional candidate. Add `-- --with-call` to include an analysed call with an 8-line transcript |
| `npm run sample` | Regenerates `samples/sample-resume.docx` (fictional "Rahul Sharma") |
| `npm run e2e` | End-to-end test script (added in the next step) |

## Project structure

```
.
├── server.ts                 # Entry: dotenv, JSON body limit, API routes, error middleware, Vite middleware
├── server/
│   ├── config.ts             # getGeminiApiKey() → 503 GEMINI_NOT_CONFIGURED if missing
│   ├── errors.ts             # AppError(status, message, code)
│   ├── gemini.ts             # generateJson<T>(): JSON-schema calls, 60 s timeout, error mapping
│   ├── resumeParser.ts       # resumeSchema, extraction prompt, normalizeResumeData()
│   ├── callAnalyzer.ts       # callAnalysisSchema, analysis prompt, normalizeCallAnalysis()
│   ├── normalize.ts          # Shared string/array/enum cleaning helpers
│   ├── validation.ts         # validateSaveCallRequest()
│   ├── csv.ts                # RFC 4180 CSV with BOM + formula-injection guard
│   ├── repository.ts         # CandidateRepository interface + JSON-file implementation
│   ├── callRecorder.ts       # recordCall(): Gemini analysis + save of a finished call
│   └── routes/
│       ├── candidates.ts     # list / get / delete / save call
│       ├── resume.ts         # upload + parse
│       └── export.ts         # CSV export
├── shared/
│   ├── types.ts              # Types shared by server and browser
│   ├── agentPrompt.ts        # Per-candidate Vapi assistantOverrides (prompt, first message, variables)
│   ├── company.ts            # Agent/company facts, jobRoleFor(), VAPI_MODEL, office time zone
│   └── interview.ts          # IST date helpers, calendar for the LLMs, interviewState() (upcoming/today/overdue/…)
├── src/
│   ├── main.tsx, App.tsx, index.css, api.ts, vite-env.d.ts
│   ├── components/           # UploadDropzone, CandidateGrid/Card, Toolbar, CandidateDetailPanel,
│   │                         # CallHistory, CallModal, ConfirmDialog, DeleteCandidateDialog, Toast, ErrorBoundary
│   ├── hooks/useVapiCall.ts  # Vapi lifecycle, transcript capture, exactly-once onEnded
│   └── lib/                  # vapiConfig.ts, format.ts, scrollLock.ts (agentPrompt.ts re-exports shared/)
├── scripts/                  # seed.ts, make-sample-resume.ts, sample-transcript.json
├── samples/                  # sample-resume.docx (committed)
└── data/                     # candidates.json (runtime, gitignored)
```

## API reference

Every error is JSON `{ "error": string, "code"?: string }` with a matching HTTP status. Common codes are `NOT_FOUND`, `INVALID_BODY`, `GEMINI_NOT_CONFIGURED` (503), `GEMINI_FAILED`/`GEMINI_OVERLOADED` (502), `GEMINI_RATE_LIMIT` (429), `DATA_CORRUPT` (500) and `INTERNAL_ERROR` (500).

| Method & path | Request | Success response | Errors |
|---|---|---|---|
| `GET /api/health` | — | `200 {"ok":true,"geminiConfigured":true}` | — |
| `GET /api/candidates` | — | `200 Candidate[]`, newest first | 500 `DATA_CORRUPT` |
| `GET /api/candidates/:id` | — | `200 Candidate` | 404 `NOT_FOUND` |
| `DELETE /api/candidates/:id` | — | `204` (no body) | 404 `NOT_FOUND` |
| `PATCH /api/candidates/:id/interview` | JSON `UpdateInterviewRequest`: any of `scheduledAt` (ISO), `timeSpecified`, `status` (`scheduled`/`completed`/`no-show`/`cancelled`), `notes` | `200 Candidate` (creates the interview if none; that needs `scheduledAt`) | 400 `INVALID_BODY`, 404 `NOT_FOUND` |
| `DELETE /api/candidates/:id/interview` | — | `200 Candidate` with `interview: null` | 404 `NOT_FOUND` |
| `POST /api/resume` | `multipart/form-data`, field `resume` (PDF/DOCX ≤ 5 MB) | `201 Candidate` | 400 `NO_FILE`, 413 `LIMIT_FILE_SIZE`, 415 `UNSUPPORTED_FILE`, 422 `EMPTY_DOCUMENT` / `NOT_A_RESUME`, 429, 502, 503 |
| `POST /api/candidates/:id/calls` | JSON `SaveCallRequest` | `201 { candidate, call }` | 400 `INVALID_BODY`, 404 `NOT_FOUND` |
| `GET /api/export.csv` | — | `200 text/csv`, `attachment; filename="candidates-YYYY-MM-DD.csv"` | 500 `DATA_CORRUPT` |

**Examples**

```bash
# Upload a resume
curl -s -F "resume=@samples/sample-resume.docx" http://localhost:3000/api/resume
```
```json
{
  "id": "3f6c…", "createdAt": "2026-11-24T06:00:00.000Z", "updatedAt": "2026-11-24T06:00:00.000Z",
  "resumeFileName": "sample-resume.docx", "status": "new", "calls": [],
  "resumeData": {
    "name": "Rahul Sharma", "email": "rahul.sharma@example.com", "phone": "+91 98765 43210",
    "location": "Bengaluru", "currentCompany": "Nimbus Tech Pvt Ltd",
    "currentDesignation": "Senior Software Engineer", "totalExperienceYears": 10.4,
    "skills": ["React", "TypeScript", "Node.js", "AWS", "PostgreSQL", "Docker", "Redis", "GraphQL"],
    "education": [{ "degree": "B.Tech in Computer Science", "institution": "Fictional Institute of Engineering", "year": "2016" }],
    "previousCompanies": [{ "company": "Orbit Softworks Pvt Ltd", "designation": "Software Engineer", "duration": "Jul 2018 - Dec 2020" }],
    "summary": "Software engineer with experience in …"
  }
}
```

```bash
# Save a call (the browser does this automatically when a call ends)
curl -s -X POST http://localhost:3000/api/candidates/<id>/calls \
  -H "Content-Type: application/json" \
  -d '{"callId":"vapi-call-id","startedAt":"2026-11-24T06:00:00.000Z","endedAt":"2026-11-24T06:02:12.000Z","durationSec":132,
       "transcript":[{"role":"assistant","text":"Hi Rahul…","at":"2026-11-24T06:00:02.000Z"},
                     {"role":"user","text":"Current CTC is 18 LPA.","at":"2026-11-24T06:00:52.000Z"}]}'
```
```json
{
  "candidate": { "id": "…", "status": "called", "calls": [ … ] },
  "call": {
    "id": "…", "callId": "vapi-call-id", "durationSec": 132, "transcript": [ … ],
    "analysis": {
      "currentCTC": "18 LPA", "expectedCTC": "24-25 LPA", "noticePeriod": "60 days, negotiable to 30",
      "reasonForChange": "Growth and bigger product ownership", "preferredLocation": "Bengaluru or remote",
      "interested": "yes", "interviewAvailability": "Thursday afternoon after 2 pm",
      "confirmedOrCorrectedResumeDetails": [
        { "field": "Total experience", "resumeValue": "10.4 years", "candidateStatement": "Around 8.5 years full-time", "status": "corrected" }
      ],
      "keyNotes": ["…"], "callSummary": "…",
      "recommendation": { "decision": "shortlist", "reason": "…" }
    },
    "analysisError": null, "createdAt": "…"
  }
}
```
If the transcript has no candidate lines, or Gemini fails, the call is **still saved**, with `"analysis": null` and an explanatory `analysisError`.

```bash
curl -s -o candidates.csv http://localhost:3000/api/export.csv
curl -s -X DELETE -w "%{http_code}\n" http://localhost:3000/api/candidates/<id>   # 204
```

## Data model

All types live in [shared/types.ts](shared/types.ts) and are shared by server and client:

- `Candidate` holds `{ id, createdAt, updatedAt, resumeFileName, resumeData: ResumeData, status: "new" | "called", calls: CallRecord[], interview: Interview | null }`.
- `Interview` holds `{ scheduledAt, timeSpecified, status: "scheduled" | "completed" | "no-show" | "cancelled", source: "ai" | "recruiter", callRecordId, candidateStatement, notes }`. "Overdue" is never stored; it is derived from the clock.
- `ResumeData` holds the extracted resume fields. Missing scalars are `null` and missing lists are `[]`.
- `CallRecord` holds one call: the Vapi `callId`, timings, the `TranscriptLine[]`, and `analysis: CallAnalysis | null` with `analysisError`.
- `CallAnalysis` holds the CTC, notice period, reason for change, location, interest, availability, `interviewSlot` (`{ date, time, candidateStatement } | null`), resume-detail checks, key notes, summary and recommendation.

Conventions: ISO date strings, ids from `crypto.randomUUID()`, and `null` (never `""`) for missing values.

## How the voice agent works

- The Vapi assistant in your dashboard supplies the **voice and transcriber**. Each call passes **`assistantOverrides`** built by `buildAssistantOverrides(candidate)` in [shared/agentPrompt.ts](shared/agentPrompt.ts):
  - **`model`**: `VAPI_MODEL` (temperature 0.4) with a **system prompt generated per candidate**. It contains the known resume facts, the missing fields, a fixed flow (confirm details → ask what's missing → CTC → expected CTC → notice period → reason for change → location → interest → interview availability), the rules (one question at a time, no invented job details, no salary negotiation) and a closing script.
  - **`firstMessage`**: "Hi {firstName}, this is Priya from White Collar Realty's HR team. I'm calling about the {appliedRole} role…". The role comes from the candidate's resume (`appliedRole`, e.g. "Position applied for: SEO Executive"); when the resume doesn't name one, the agent says "an open position with us". Edit `AGENT_NAME`, `COMPANY_NAME`, `COMPANY_FACTS`, `OFFICE_LOCATION` and `DEFAULT_JOB_ROLE` in [shared/company.ts](shared/company.ts).
  - **`variableValues`**: `candidateName`, `firstName`, `currentCompany`, `currentDesignation`, `experience`, `location`, `skills`, `agentName`, `companyName` and `jobRole`, with `"not mentioned"` for nulls. You can use them as `{{firstName}}` etc. in the dashboard assistant if you prefer to edit prompts there.
- **Missing fields**: the prompt lists which of current company, current designation, total experience, current location and email are `null` in the resume, and the agent asks for those.
- **Follow-up calls**: if the candidate has an analysed earlier call, its non-null answers are added as "KNOWN FROM PREVIOUS CALL (confirm these briefly instead of asking again)".
- **Language**: the agent replies in the candidate's language (English, Hindi or Hinglish). The analysis is always written in English, with amounts kept as said ("18 LPA").
- **Transcript capture**: [useVapiCall](src/hooks/useVapiCall.ts) shows partial transcripts live (faded) but stores **only `final` transcript messages**. When the call ends, by either side or by an error mid-call, the captured transcript is posted exactly once to `POST /api/candidates/:id/calls` for analysis.

## Interview scheduling

1. **On the call**, the agent's prompt includes today's date and a two-week calendar (with "aaj / kal / parso"). When the candidate is interested, the agent asks for a day and time (in person at the Gurgaon office), repeats the exact date back ("So that's Wednesday, 25 November 2026 at 3 PM, correct?") and confirms that it's booked. On a follow-up call it confirms an existing slot or books a new one.
2. **When the call ends**, Gemini's analysis receives the call's start time and a three-week calendar. It returns `interviewSlot`: a `YYYY-MM-DD` date copied from that calendar, so it never has to work out weekdays itself, plus `HH:MM` if a time was given ("3 baje" → 15:00, a bare 1–7 means pm). Vague answers ("any weekday", "next week sometime") give `null`. The server rejects dates before the call day or more than 60 days after it.
3. **The server schedules it immediately** (`source: "ai"`). A newer call that books a different slot replaces the interview; a call with no slot leaves it unchanged.
4. **On the dashboard**, the card and the detail panel show the interview and its state, computed in IST and refreshed every 30 s:
   - **Scheduled**: in the future. **Today**: later today.
   - **Overdue**: still `scheduled`, but its time passed more than an hour ago. If only a day was agreed, it becomes overdue once that day ends. A red banner and an "Overdue" filter list these interviews.
   - **Completed / No-show / Cancelled**: set by the recruiter.
5. **Recruiter actions** in the detail panel: Mark completed, No-show, Mark as due again, Reschedule (date plus an optional time), Cancel, Remove, or Schedule manually when there's no interview.

## Free demo mode (no Vapi keys)

If `VITE_VAPI_PUBLIC_KEY` / `VITE_VAPI_ASSISTANT_ID` are not set, the **Call** button still works in Chrome/Edge, using the browser's built-in, free Web Speech API ([useBrowserVoiceCall](src/hooks/useBrowserVoiceCall.ts)):

- The agent speaks with the browser's speech synthesis (an `en-IN` voice when available).
- The candidate is heard with the browser's speech recognition (`en-IN`). This needs internet, because Chrome/Edge send the audio to their speech service.
- The agent follows a **fixed script** built from the resume ([demoScript.ts](src/lib/demoScript.ts)): greeting → confirm role/experience → missing resume fields → CTC → expected CTC → notice period → reason for change → location → interest → interview availability → closing. If there's no answer, it re-asks once.
- The transcript is saved and analysed by Gemini exactly like a Vapi call. Call ids start with `demo-`.

Limitations: it is not conversational (no follow-ups or free-form replies), and Hindi in Devanagari isn't recognised (romanised Hinglish spoken in Indian English mostly is). Add the Vapi keys for the full AI agent.

## CSV columns

There is one row per call. A candidate without calls gets one row with empty call columns. Columns, in order:

`candidateId, name, appliedRole, email, phone, location, currentCompany, currentDesignation, totalExperienceYears, skills, education, previousCompanies, resumeSummary, status, candidateCreatedAt, interviewAt, interviewStatus, interviewScheduledBy, callNumber, callId, callStartedAt, callDurationSec, currentCTC, expectedCTC, noticePeriod, reasonForChange, preferredLocation, interested, interviewAvailability, resumeDetailChecks, keyNotes, callSummary, recommendation, recommendationReason, analysisError, transcript`

How list columns are joined:

- `skills`: joined with `; `
- `education`: `degree – institution (year)`
- `previousCompanies`: `designation @ company (duration)`
- `resumeDetailChecks`: `field: status → candidateStatement`
- `keyNotes`: joined with ` | `
- `transcript`: `Agent: …` / `Candidate: …` lines separated by newlines inside one quoted cell

`callNumber` follows call order, so 1 is the first call. Values starting with `=`, `@`, `+`, `-`, a tab or CR are prefixed with `'`. Phone-like values such as `+91 98765 43210` are left as they are.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Microphone permission was denied" | Click the lock icon in the address bar → Microphone → Allow, then **Try again**. Check that the OS privacy settings allow the browser to use the mic. |
| "Microphone needs a secure context" | Open `http://localhost:3000`, not `http://192.168.x.x:3000`. Remote access needs HTTPS. |
| Vapi banner still shows after editing `.env` | `VITE_` variables are read when the server starts. **Restart `npm run dev`** and hard-refresh the page. |
| Upload says "overloaded" / 502 `GEMINI_OVERLOADED`, or requests time out | Google is returning 503 (high demand). Wait a minute and retry. If it persists, set `GEMINI_MODEL` in `.env` to another Flash model available to your key and restart. `gemini-3.5-flash-lite` is the fastest fallback (~8 s per resume, all e2e checks pass); `gemini-3.5-flash` can exceed the 60 s timeout under load. |
| 429 `GEMINI_RATE_LIMIT` | The free-tier quota is exhausted. Wait, or use a key with a higher quota. |
| Upload or analysis 404 mentioning the model | Your key can't use the configured model. Set `GEMINI_MODEL` in `.env` to a model listed for your key in AI Studio, then restart. |
| Call fails to start, or errors mentioning model/overrides | `VAPI_MODEL` in `shared/company.ts` doesn't match a provider/model enabled on your Vapi account. Make it match your assistant's model. |
| Hindi/Hinglish answers transcribed as gibberish | Set the assistant's transcriber to a multilingual model (e.g. Deepgram `nova-3`, language `multi`) and use a quiet room and a headset. |
| `EADDRINUSE: port 3000` | Another process is using the port. Stop it, or run `PORT=3001 npm run dev` (PowerShell: `$env:PORT=3001; npm run dev`). |
| "data/candidates.json is corrupted" | The app never overwrites a corrupted file. Fix the JSON or move the file away, and a fresh one is created. |

## Swapping storage

All persistence goes through the `CandidateRepository` interface in [server/repository.ts](server/repository.ts):

```ts
interface CandidateRepository {
  list(): Promise<Candidate[]>;                       // newest first
  get(id: string): Promise<Candidate | null>;
  create(input: { resumeData: ResumeData; resumeFileName: string }): Promise<Candidate>;
  update(id: string, updater: (c: Candidate) => Candidate): Promise<Candidate | null>;
  delete(id: string): Promise<boolean>;
}
```

To use Postgres, SQLite or another store, implement this interface and point the exported `candidateRepository` singleton at your class. No route or UI code needs to change. Keep `update()` atomic (a transaction or row lock), because a call can be saved while other requests run.

## Privacy

- **Resumes are sent to Google Gemini** for extraction, and **call transcripts are sent to Gemini** for analysis.
- **Call audio goes to Vapi** and the speech-to-text, LLM and voice providers configured on your assistant.
- **Data is stored as plain, unencrypted JSON** in `data/candidates.json` on this machine. It contains personal data (contact details, salary, transcripts). `data/` is gitignored, so **never commit it**, and delete it when no longer needed.
- Get candidates' consent before recording or analysing calls, and follow your local data-protection rules.
- `GEMINI_API_KEY` stays on the server. Only the `VITE_` Vapi public key and assistant ID reach the browser. The dev server refuses to serve `.env*`, `data/`, `server/` and `scripts/`.

## Out of scope / roadmap

- Authentication and recruiter accounts
- A cloud database, via a `CandidateRepository` implementation
- Production build and deployment (static frontend build, hosted API, HTTPS)
