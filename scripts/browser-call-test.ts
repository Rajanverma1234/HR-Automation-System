// Browser test of the call transcript, run through the real UI: `npm run test:call`.
//
// It starts its own dev server on port 3011 with the Vapi keys blanked, so the app uses the free demo
// voice (useBrowserVoiceCall), then drives headless Microsoft Edge over the Chrome DevTools Protocol.
// The browser's speech APIs are replaced by fakes: speechSynthesis "speaks" instantly, and
// SpeechRecognition plays a candidate who answers each question (interim results first, then final).
//
// Scenario A: a full call. Checks the live transcript in the call window, the saved transcript
//   (every agent question and candidate answer, in order), the Gemini analysis, the automatic
//   interview booking ("kal 3 baje"), and the transcript and interview in the detail panel.
// Scenario B: the recruiter clicks "End call" while the candidate is mid-sentence. Checks that the
//   unfinished words are still saved.
//
// Needs GEMINI_API_KEY in .env and Microsoft Edge (or set EDGE_PATH). Uses Gemini, not Vapi: no call credits.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hashPassword } from "../server/auth.js";
import { addDays, officeDate, slotToIso } from "../shared/interview.js";
import type { Candidate } from "../shared/types.js";

const PORT = 3011;
const HMR_PORT = 24690;
const CDP_PORT = 9333;
const BASE = `http://localhost:${PORT}`;
const ROOT = process.cwd();
const SAMPLE_DOCX = path.join(ROOT, "samples", "sample-resume.docx");
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
/** The test server runs with HR login on, using this throwaway account. */
const HR_EMAIL = "test-hr@example.com";
const HR_PASSWORD = randomBytes(12).toString("base64url");
let hrCookie = "";

/** fetch() as the signed-in HR user (Node side; the browser keeps its own cookie). */
function hrFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Cookie: hrCookie } });
}

const PARTIAL_WORDS = "Haan main abhi baat kar sakta hoon, bas ek";

/** Candidate answers keyed by the agent's question. The last one books the interview in Hinglish. */
const ANSWERS: [string, string][] = [
  ["good time", "Haan, yes, abhi time hai. Go ahead."],
  ["correct\\?", "Yes, that is correct."],
  ["couldn't find your", "Main Bengaluru mein based hoon."],
  ["current CTC", "Current CTC 18 LPA hai."],
  ["expecting", "I am expecting around 24 LPA."],
  ["notice period", "Notice period 60 days hai, negotiable to 30."],
  ["change", "Mainly growth, I want bigger product ownership."],
  ["comfortable", "Yes, Gurgaon office is fine for me."],
  ["interested in", "Yes, I am very interested."],
  ["interview", "Theek hai mam, kal 3 baje mera interview schedule kar do."],
];

const FAKE_SPEECH = `(() => {
  const answers = ${JSON.stringify(ANSWERS)}.map(([re, text]) => [new RegExp(re, "i"), text]);
  const fake = { mode: "full", lastSpoken: "", spoken: [], heard: [] };
  window.__fake = fake;

  class FakeUtterance {
    constructor(text) { this.text = text; this.voice = null; this.lang = ""; this.rate = 1; this.pitch = 1; this.onstart = null; this.onend = null; this.onerror = null; }
  }
  const synth = {
    speaking: false, pending: false, paused: false,
    getVoices: () => [{ name: "Fake Neerja Online (Natural)", lang: "en-IN", default: true, localService: true, voiceURI: "fake" }],
    speak(u) {
      fake.spoken.push(u.text);
      fake.lastSpoken = u.text;
      setTimeout(() => { if (u.onstart) u.onstart(); setTimeout(() => { if (u.onend) u.onend(); }, 120); }, 20);
    },
    cancel() {}, pause() {}, resume() {}, addEventListener() {}, removeEventListener() {},
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = FakeUtterance;

  class FakeRecognition {
    constructor() { this.lang = ""; this.continuous = false; this.interimResults = false; this.onresult = null; this.onerror = null; this.onend = null; this.timers = []; }
    emit(text, isFinal) {
      if (this.onresult) this.onresult({ resultIndex: 0, results: [{ isFinal, 0: { transcript: text }, length: 1 }] });
    }
    start() {
      if (fake.mode === "hang") {
        // Interim words only, never final: the test ends the call mid-answer.
        this.timers.push(setTimeout(() => this.emit(${JSON.stringify(PARTIAL_WORDS)}, false), 200));
        return;
      }
      const hit = answers.find(([re]) => re.test(fake.lastSpoken));
      const text = hit ? hit[1] : "Okay.";
      const words = text.split(" ");
      this.timers.push(setTimeout(() => this.emit(words.slice(0, Math.ceil(words.length / 2)).join(" "), false), 150));
      this.timers.push(setTimeout(() => { fake.heard.push(text); this.emit(text, true); }, 350));
    }
    stop() { this.timers.forEach(clearTimeout); }
    abort() { this.timers.forEach(clearTimeout); }
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
})();`;

// ---------- tiny test harness ----------
let passed = 0;
class CheckFailed extends Error {}
function check(condition: unknown, label: string, detail?: string): asserts condition {
  if (!condition) {
    console.log(`❌ ${label}${detail ? `\n   ${detail}` : ""}`);
    throw new CheckFailed(label);
  }
  passed += 1;
  console.log(`✅ ${label}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- minimal CDP client ----------
type CdpMessage = { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message: string }; sessionId?: string };

class Cdp {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (r: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  private readonly listeners: ((m: CdpMessage) => void)[] = [];
  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener("message", (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data)) as CdpMessage;
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) p?.reject(new Error(msg.error.message));
        else p?.resolve(msg.result ?? {});
      } else {
        for (const l of this.listeners) l(msg);
      }
    });
  }
  static connect(url: string): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => resolve(new Cdp(ws)));
      ws.addEventListener("error", () => reject(new Error(`Can't connect to ${url}`)));
    });
  }
  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  onEvent(listener: (m: CdpMessage) => void): void {
    this.listeners.push(listener);
  }
  close(): void {
    this.ws.close();
  }
}

class Page {
  constructor(
    private readonly cdp: Cdp,
    private readonly sessionId: string,
  ) {}
  send(method: string, params: Record<string, unknown> = {}) {
    return this.cdp.send(method, params, this.sessionId);
  }
  async eval<T>(expression: string): Promise<T> {
    const res = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    const details = res.exceptionDetails as { exception?: { description?: string }; text?: string } | undefined;
    if (details) throw new Error(`Page error: ${details.exception?.description ?? details.text ?? "unknown"}`);
    return (res.result as { value: T }).value;
  }
  /** Polls a boolean page expression until it is true. */
  async waitFor(expression: string, label: string, timeoutMs = 60_000): Promise<void> {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (await this.eval<boolean>(`Boolean(${expression})`)) return;
      await sleep(300);
    }
    const dialog = await this.eval<string>(`document.querySelector('[role=dialog]')?.innerText ?? '(no dialog) page: ' + document.body.innerText`);
    check(false, label, `Timed out after ${timeoutMs / 1000}s. Dialog text:\n${dialog.slice(0, 1500)}`);
  }
  /** Clicks the first visible button whose text (or aria-label) matches, optionally inside `scope`. */
  async click(text: string, scope = "document"): Promise<void> {
    const ok = await this.eval<boolean>(`(() => {
      const b = [...${scope}.querySelectorAll('button')].find((el) => el.innerText.trim() === ${JSON.stringify(text)} || el.getAttribute('aria-label') === ${JSON.stringify(text)});
      if (!b) return false; b.click(); return true; })()`);
    check(ok, `click "${text}"`);
  }
}

function findEdge(): string {
  const candidates = [
    process.env.EDGE_PATH,
    `${process.env["ProgramFiles(x86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ];
  const found = candidates.find((p): p is string => typeof p === "string" && existsSync(p));
  if (!found) throw new Error("Microsoft Edge not found. Set EDGE_PATH to msedge.exe (or chrome.exe).");
  return found;
}

async function waitForHttp(url: string, timeoutMs: number): Promise<Response> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch {
      // not up yet
    }
    if (Date.now() > until) throw new Error(`${url} did not respond within ${timeoutMs / 1000}s`);
    await sleep(500);
  }
}

async function getCandidate(id: string): Promise<Candidate> {
  return (await (await hrFetch(`${BASE}/api/candidates/${id}`)).json()) as Candidate;
}

// ---------- the test ----------
let server: ChildProcess | null = null;
let edge: ChildProcess | null = null;
let cdp: Cdp | null = null;
let profileDir: string | null = null;
let candidateId: string | null = null;
let appliedId: string | null = null;

async function main(): Promise<void> {
  console.log(`Browser call test (demo voice, headless Edge) on ${BASE}\n`);

  server = spawn(process.execPath, [path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), "server.ts"], {
    cwd: ROOT,
    // Blank Vapi keys force the free demo voice; process env wins over .env in both dotenv and Vite.
    env: {
      ...process.env,
      PORT: String(PORT),
      HMR_PORT: String(HMR_PORT),
      VITE_VAPI_PUBLIC_KEY: "",
      VITE_VAPI_ASSISTANT_ID: "",
      HR_USERS: `${HR_EMAIL}:${await hashPassword(HR_PASSWORD)}`,
      AUTH_SECRET: randomBytes(32).toString("base64url"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  server.stdout?.on("data", (d: Buffer) => (serverLog += d.toString()));
  server.stderr?.on("data", (d: Buffer) => (serverLog += d.toString()));
  try {
    await waitForHttp(`${BASE}/api/health`, 30_000);
  } catch (err) {
    console.log(serverLog);
    throw err;
  }
  check(true, `test server up on port ${PORT} (Vapi keys blanked → demo voice, HR login on)`);

  // HR login (API level): locked without a session, open with one.
  const locked = await fetch(`${BASE}/api/candidates`);
  check(locked.status === 401, `GET /api/candidates without signing in → 401 (got ${locked.status})`);
  const signIn = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: HR_EMAIL, password: HR_PASSWORD }),
  });
  hrCookie = (signIn.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  check(signIn.ok && hrCookie.startsWith("hr_session="), "HR sign-in via API returns a session cookie");

  // Test candidate from the committed sample resume.
  const form = new FormData();
  form.append("resume", new Blob([await readFile(SAMPLE_DOCX)], { type: DOCX_MIME }), "sample-resume.docx");
  const up = await fetch(`${BASE}/api/resume`, { method: "POST", body: form });
  const candidate = (await up.json()) as Candidate;
  check(up.status === 201, `uploaded sample resume → ${candidate.resumeData.name}`, JSON.stringify(candidate));
  candidateId = candidate.id;
  const name = candidate.resumeData.name ?? "Unnamed candidate";

  // Headless Edge with a fake microphone (getUserMedia succeeds without a prompt).
  profileDir = await mkdtemp(path.join(os.tmpdir(), "hr-call-test-"));
  edge = spawn(
    findEdge(),
    [
      "--headless=new",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profileDir}`,
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const version = (await (await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`, 20_000)).json()) as { webSocketDebuggerUrl: string };
  cdp = await Cdp.connect(version.webSocketDebuggerUrl);
  const { targetId } = (await cdp.send("Target.createTarget", { url: "about:blank" })) as { targetId: string };
  const { sessionId } = (await cdp.send("Target.attachToTarget", { targetId, flatten: true })) as { sessionId: string };
  const page = new Page(cdp, sessionId);
  const pageErrors: string[] = [];
  cdp.onEvent((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === "Runtime.exceptionThrown") pageErrors.push(JSON.stringify(m.params).slice(0, 400));
    if (m.method === "Runtime.consoleAPICalled" && (m.params as { type?: string }).type === "error") {
      pageErrors.push(JSON.stringify((m.params as { args?: unknown }).args).slice(0, 400));
    }
  });
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: FAKE_SPEECH });
  await page.send("Page.navigate", { url: BASE });
  check(true, "headless Edge launched with fake mic + fake Web Speech API");

  // HR login (UI): the dashboard asks for a sign-in; a wrong password is refused, the right one opens it.
  await page.waitFor(`document.querySelector('input[type=password]')`, "dashboard shows the HR sign-in form", 30_000);
  const fill = (email: string, password: string) =>
    page.eval<boolean>(`(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      for (const [sel, v] of [['input[type=email]', ${JSON.stringify(email)}], ['input[type=password]', ${JSON.stringify(password)}]]) {
        const el = document.querySelector(sel); set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return true; })()`);
  await fill(HR_EMAIL, "wrong-password-123");
  await page.click("Sign in");
  await page.waitFor(`document.querySelector('[role=alert]')?.innerText.includes('Wrong email or password')`, "wrong password is refused", 15_000);
  check(true, "wrong password is refused on the sign-in form");
  await fill(HR_EMAIL, HR_PASSWORD);
  await page.click("Sign in");

  const card = `document.querySelector('[aria-label=${JSON.stringify(`Open ${name}`)}]')`; // newest first → our upload
  await page.waitFor(card, "candidate card visible on the dashboard", 30_000);

  // ---------- Scenario A: full call ----------
  await page.click("Call", card);
  await page.waitFor(`document.querySelector('[role=dialog]')?.innerText.includes('Demo voice')`, "call window opens in demo-voice mode", 10_000);
  check(true, "call window opens in demo-voice mode");
  await page.waitFor(`document.querySelector('[aria-label="Live transcript"]')?.innerText.includes('Current CTC 18 LPA')`, "live transcript shows candidate answers during the call", 60_000);
  check(true, "live transcript shows candidate answers during the call");
  await page.waitFor(
    `/Call saved|couldn't be analysed|Couldn't save/.test(document.querySelector('[role=dialog]')?.innerText ?? '')`,
    "call ends and is saved",
    180_000,
  );
  const dialogText = await page.eval<string>(`document.querySelector('[role=dialog]').innerText`);
  check(dialogText.includes("Call saved"), "call window shows \"Call saved\" with the analysis", dialogText.slice(0, 800));

  const spoken = await page.eval<string[]>("window.__fake.spoken");
  const heard = await page.eval<string[]>("window.__fake.heard");
  const afterA = await getCandidate(candidate.id);
  const callA = afterA.calls[0];
  check(afterA.calls.length === 1 && callA !== undefined, "one call saved on the candidate");
  check(callA.callId?.startsWith("demo-") === true, `callId is a demo id (${callA.callId})`);
  const userLines = callA.transcript.filter((l) => l.role === "user").map((l) => l.text);
  const agentLines = callA.transcript.filter((l) => l.role === "assistant").map((l) => l.text);
  check(
    heard.length > 0 && heard.every((h) => userLines.includes(h)),
    `every candidate answer is in the saved transcript (${heard.length} answers)`,
    JSON.stringify({ heard, userLines }, null, 2),
  );
  check(
    spoken.every((s) => agentLines.includes(s)),
    `every agent line is in the saved transcript (${spoken.length} lines, greeting → closing)`,
    JSON.stringify({ spoken, agentLines }, null, 2),
  );
  const order = callA.transcript.map((l) => l.role[0]).join("");
  check(order.startsWith("au") && !order.includes("uu"), `lines alternate agent → candidate in order (${order})`);
  check(callA.transcript.every((l) => !Number.isNaN(Date.parse(l.at))), "every line has a valid timestamp");
  check(callA.durationSec > 0 && Date.parse(callA.endedAt) >= Date.parse(callA.startedAt), `duration recorded (${callA.durationSec}s)`);
  const a = callA.analysis;
  check(a !== null, "Gemini analysed the transcript", callA.analysisError ?? "");
  check(a.currentCTC?.includes("18") === true && a.expectedCTC?.includes("24") === true, `CTC extracted from the transcript (${a.currentCTC} → ${a.expectedCTC})`);
  const tomorrow = addDays(officeDate(new Date(callA.startedAt)), 1);
  check(
    afterA.interview?.source === "ai" && afterA.interview.scheduledAt === slotToIso(tomorrow, "15:00"),
    `"kal 3 baje" → interview booked automatically for ${tomorrow} 15:00 IST`,
    JSON.stringify({ slot: a.interviewSlot, interview: afterA.interview }),
  );

  // Detail panel shows the same transcript and the interview.
  await page.click("View details");
  await page.waitFor(`[...document.querySelectorAll('button')].some((b) => b.innerText.includes('Show transcript'))`, "detail panel opens", 15_000);
  const panelLines = await page.eval<number>(`(() => {
    const b = [...document.querySelectorAll('button')].find((el) => el.innerText.includes('Show transcript'));
    b.click();
    return Number(/\\((\\d+) lines\\)/.exec(b.innerText)?.[1] ?? -1);
  })()`);
  check(panelLines === callA.transcript.length, `detail panel: "Show transcript (${panelLines} lines)" matches the saved transcript`);
  await sleep(300);
  const panelText = await page.eval<string>(`document.querySelector('[aria-labelledby="candidate-panel-title"]').innerText`);
  check(panelText.includes("Theek hai mam, kal 3 baje"), "detail panel renders the transcript text");
  check(panelText.includes("Scheduled automatically by the AI"), "detail panel shows the AI-booked interview");
  await page.click("Close candidate details");

  // ---------- Scenario B: end the call while the candidate is mid-sentence ----------
  await page.eval(`window.__fake.mode = "hang"`);
  await page.click("Call", card);
  await page.waitFor(`document.querySelector('[aria-label="Live transcript"]')?.innerText.includes(${JSON.stringify(PARTIAL_WORDS)})`, "interim words show live (faded)", 30_000);
  check(true, "interim words show live in the call window");
  await page.click("End call");
  await page.waitFor(
    `/Call saved|couldn't be analysed|Couldn't save/.test(document.querySelector('[role=dialog]')?.innerText ?? '')`,
    "ended call is saved",
    120_000,
  );
  const afterB = await getCandidate(candidate.id);
  const callB = [...afterB.calls].sort((x, y) => y.startedAt.localeCompare(x.startedAt))[0];
  const last = callB?.transcript.at(-1);
  check(
    afterB.calls.length === 2 && last?.role === "user" && last.text === PARTIAL_WORDS,
    "words the candidate was saying when \"End call\" was clicked are saved",
    JSON.stringify(callB?.transcript),
  );

  // ---------- Signing out locks the dashboard ----------
  await page.send("Page.navigate", { url: BASE });
  await page.waitFor(card, "dashboard reloads signed in", 30_000);
  await page.click("Sign out");
  await page.waitFor(`document.querySelector('input[type=password]')`, "Sign out returns to the sign-in form", 10_000);
  const afterSignOut = await page.eval<number>(`fetch('/api/candidates').then((r) => r.status)`);
  check(afterSignOut === 401, `after Sign out the browser's API calls get 401 (got ${afterSignOut})`);

  // ---------- Scenario C: candidate self-service link (/apply), signed out ----------
  await page.eval(`window.__fake.mode = "full"`);
  await page.send("Page.navigate", { url: `${BASE}/apply` });
  await page.waitFor(`document.querySelector('input[type=file]')`, "/apply shows the resume upload", 20_000);
  const applyText = await page.eval<string>("document.body.innerText");
  check(!applyText.includes("Candidates") && !applyText.includes(name), "/apply shows no dashboard and no other candidates");
  const { root } = (await page.send("DOM.getDocument", { depth: -1, pierce: true })) as { root: { nodeId: number } };
  const { nodeId } = (await page.send("DOM.querySelector", { nodeId: root.nodeId, selector: "input[type=file]" })) as { nodeId: number };
  await page.send("DOM.setFileInputFiles", { nodeId, files: [SAMPLE_DOCX] });
  await page.waitFor(`[...document.querySelectorAll('button')].some((b) => b.innerText.includes('Start call'))`, "after upload, the Start call button appears", 90_000);
  check(true, "candidate uploaded a resume on /apply → Start call button");
  await page.click("Start call");
  await page.waitFor(`document.querySelector('[role=dialog]')?.innerText.includes('Thank you!')`, "candidate sees the thank-you after the call", 180_000);
  const candidateDialog = await page.eval<string>(`document.querySelector('[role=dialog]').innerText`);
  check(!/shortlist|reject|hold|Call saved|View details/i.test(candidateDialog), "candidate never sees the analysis or recommendation", candidateDialog.slice(0, 600));
  await page.click("Done");
  await page.waitFor(`document.body.innerText.includes('All done')`, "/apply shows All done", 10_000);
  check(true, "/apply shows \"All done\" after the call (signed out: the candidate token did the work)");

  // The candidate token opens that one record (without the analysis) and nothing else.
  const saved = JSON.parse(await page.eval<string>(`sessionStorage.getItem('applyCandidateId') ?? 'null'`)) as { id: string; token: string } | null;
  check(saved !== null && saved.token.length > 20, "/apply keeps the candidate token for a refresh");
  const own = await fetch(`${BASE}/api/candidates/${saved.id}`, { headers: { "X-Candidate-Token": saved.token } });
  const ownBody = (await own.json()) as Candidate;
  check(own.ok && ownBody.calls.length === 1 && ownBody.calls[0]?.analysis === null, "the token reads its own record, with the analysis hidden");
  const tokenElsewhere = await Promise.all([
    fetch(`${BASE}/api/candidates`, { headers: { "X-Candidate-Token": saved.token } }),
    fetch(`${BASE}/api/candidates/${candidate.id}`, { headers: { "X-Candidate-Token": saved.token } }),
    fetch(`${BASE}/api/candidates/${saved.id}`, { method: "DELETE", headers: { "X-Candidate-Token": saved.token } }),
    fetch(`${BASE}/api/export.csv`, { headers: { "X-Candidate-Token": saved.token } }),
  ]);
  check(
    tokenElsewhere.every((r) => r.status === 401),
    `the token can't list, read another candidate, delete or export (${tokenElsewhere.map((r) => r.status).join(", ")})`,
  );

  const all = (await (await hrFetch(`${BASE}/api/candidates`)).json()) as Candidate[];
  const applied = all.find((c) => c.id !== candidate.id && c.resumeFileName === "sample-resume.docx" && c.calls.length === 1);
  check(applied !== undefined, "the /apply candidate is saved with its call");
  appliedId = applied.id;
  check(applied.calls[0]?.analysis !== null && (applied.calls[0]?.transcript.length ?? 0) > 10, `its transcript (${applied.calls[0]?.transcript.length} lines) is analysed`);

  // HR dashboard (sign in again): no upload box, candidate link instead, and the new card is there.
  await page.send("Page.navigate", { url: BASE });
  await page.waitFor(`document.querySelector('input[type=password]')`, "dashboard asks to sign in again", 30_000);
  await fill(HR_EMAIL, HR_PASSWORD);
  await page.click("Sign in");
  await page.waitFor(`document.querySelectorAll('[aria-label=${JSON.stringify(`Open ${name}`)}]').length >= 2`, "HR dashboard shows the /apply candidate's card", 30_000);
  check(true, "HR dashboard shows the /apply candidate's card");
  const dash = await page.eval<{ upload: boolean; link: string }>(
    `({ upload: Boolean(document.querySelector('input[type=file]')), link: document.getElementById('candidate-link')?.value ?? '' })`,
  );
  check(!dash.upload && dash.link === `${BASE}/apply`, `HR dashboard has no upload box and shows the candidate link (${dash.link})`);

  check(pageErrors.length === 0, "no errors in the browser console", pageErrors.join("\n"));
}

async function cleanup(): Promise<void> {
  for (const id of [candidateId, appliedId]) {
    if (!id) continue;
    await hrFetch(`${BASE}/api/candidates/${id}`, { method: "DELETE" }).catch(() => undefined);
    console.log(`   cleaned up test candidate ${id}`);
  }
  try {
    await cdp?.send("Browser.close");
  } catch {
    // already closed
  }
  cdp?.close();
  edge?.kill();
  server?.kill();
  await sleep(500);
  if (profileDir) await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
}

main()
  .then(async () => {
    await cleanup();
    console.log(`\n🎉 All ${passed} checks passed.`);
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    if (!(err instanceof CheckFailed)) console.error("\n❌ Unexpected error:", err);
    await cleanup();
    console.log(`\nSummary: ${passed} passed, 1 failed.`);
    process.exit(1);
  });
