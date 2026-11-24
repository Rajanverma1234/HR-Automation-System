// End-to-end test against a running server: `npm run dev` first, then `npm run e2e [-- --keep]`.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { toE164 } from "../shared/phone.js";
import type { ApiErrorBody, CallRecord, Candidate, SaveCallRequest, TranscriptLine } from "../shared/types.js";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const ROOT = process.cwd();
const SAMPLE_DOCX = path.join(ROOT, "samples", "sample-resume.docx");
const SAMPLE_TRANSCRIPT = path.join(ROOT, "scripts", "sample-transcript.json");
const DATA_FILE = path.join(ROOT, "data", "candidates.json");
const KEEP = process.argv.includes("--keep");
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
/** Gemini answers 503 "high demand" from time to time; retry those few codes, never real failures. */
const TRANSIENT_CODES = new Set(["GEMINI_OVERLOADED", "GEMINI_RATE_LIMIT"]);

let passed = 0;
let createdId: string | null = null;

class CheckFailed extends Error {}

function ok(label: string): void {
  passed += 1;
  console.log(`✅ ${label}`);
}

function check(condition: unknown, label: string, detail?: string): asserts condition {
  if (!condition) {
    console.log(`❌ ${label}${detail ? `\n   ${detail}` : ""}`);
    throw new CheckFailed(label);
  }
  ok(label);
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorCode(body: unknown): string | undefined {
  return typeof body === "object" && body !== null && "code" in body && typeof body.code === "string" ? body.code : undefined;
}

function isApiError(body: unknown): body is ApiErrorBody {
  return typeof body === "object" && body !== null && "error" in body && typeof body.error === "string";
}

/** POSTs with retries for transient Gemini overload / rate-limit responses. */
async function postWithRetry(url: string, makeInit: () => RequestInit, label: string): Promise<{ res: Response; body: unknown }> {
  const delays = [10_000, 20_000, 40_000];
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, makeInit());
    const body = await readJson(res);
    const code = errorCode(body);
    if (code && TRANSIENT_CODES.has(code) && attempt < delays.length) {
      const wait = delays[attempt] ?? 10_000;
      console.log(`   … ${label}: ${code}, retrying in ${wait / 1000}s (attempt ${attempt + 2}/${delays.length + 1})`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    return { res, body };
  }
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function main(): Promise<void> {
  console.log(`E2E against ${BASE_URL}${KEEP ? " (--keep)" : ""}\n`);

  // 1. Health
  let health: unknown;
  try {
    health = await readJson(await fetch(`${BASE_URL}/api/health`));
  } catch {
    check(false, "Server reachable", `Can't reach ${BASE_URL}. Start it with \`npm run dev\`.`);
  }
  const h = health as { ok?: unknown; geminiConfigured?: unknown };
  check(h.ok === true, "GET /api/health → ok: true");
  check(h.geminiConfigured === true, "Gemini configured", "Set GEMINI_API_KEY in .env and restart `npm run dev`.");

  // 2. Sample resume
  if (!existsSync(SAMPLE_DOCX)) {
    console.log("   … samples/sample-resume.docx missing, generating it");
    execFileSync(process.execPath, [path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), "scripts/make-sample-resume.ts"], { stdio: "inherit" });
  }
  check(existsSync(SAMPLE_DOCX), "samples/sample-resume.docx exists");
  const docx = await readFile(SAMPLE_DOCX);

  // 3. Upload + parse
  const upload = await postWithRetry(
    `${BASE_URL}/api/resume`,
    () => {
      const form = new FormData();
      form.append("resume", new Blob([docx], { type: DOCX_MIME }), "sample-resume.docx");
      return { method: "POST", body: form };
    },
    "upload",
  );
  check(upload.res.status === 201, "POST /api/resume → 201", `Got ${upload.res.status}: ${JSON.stringify(upload.body)}`);
  const candidate = upload.body as Candidate;
  createdId = candidate.id;
  const r = candidate.resumeData;
  check(r.name?.includes("Rahul"), `name contains "Rahul" (${r.name})`);
  check(r.email === "rahul.sharma@example.com", `email === rahul.sharma@example.com (${r.email})`);
  check(r.skills.includes("React"), `skills include React (${r.skills.join(", ")})`);
  check(r.currentCompany?.includes("Nimbus"), `currentCompany contains "Nimbus" (${r.currentCompany})`);
  check(candidate.status === "new" && candidate.calls.length === 0, 'status "new" and no calls');
  check(r.appliedRole === null, `appliedRole is null (resume names no position) (${r.appliedRole})`);
  const uploadJson = JSON.stringify(candidate);
  check(!uploadJson.includes("LPA") && !/notice/i.test(uploadJson), 'No invented data ("LPA"/"notice" absent)', uploadJson);

  // 4. List includes it
  const list = (await readJson(await fetch(`${BASE_URL}/api/candidates`))) as Candidate[];
  check(Array.isArray(list) && list.some((c) => c.id === candidate.id), "GET /api/candidates includes the new candidate");

  // 5. Save call with the sample transcript → analysed
  const transcript = JSON.parse(await readFile(SAMPLE_TRANSCRIPT, "utf8")) as TranscriptLine[];
  const endedAt = new Date();
  const payload: SaveCallRequest = {
    callId: "e2e-test-call",
    startedAt: new Date(endedAt.getTime() - 4 * 60_000).toISOString(),
    endedAt: endedAt.toISOString(),
    durationSec: 240,
    transcript,
  };
  const saved = await postWithRetry(
    `${BASE_URL}/api/candidates/${candidate.id}/calls`,
    () => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    "save call",
  );
  check(saved.res.status === 201, "POST /api/candidates/:id/calls → 201", `Got ${saved.res.status}: ${JSON.stringify(saved.body)}`);
  const savedBody = saved.body as { candidate: Candidate; call: CallRecord };
  check(savedBody.candidate.status === "called", 'candidate.status === "called"');
  const a = savedBody.call.analysis;
  check(a !== null, "call.analysis is not null", `analysisError: ${savedBody.call.analysisError}`);
  check(a.expectedCTC !== null, `expectedCTC set (${a.expectedCTC})`);
  check(a.noticePeriod !== null, `noticePeriod set (${a.noticePeriod})`);
  check(["yes", "no", "maybe"].includes(a.interested), `interested is yes/no/maybe (${a.interested})`);
  check(
    ["shortlist", "hold", "reject"].includes(a.recommendation.decision),
    `recommendation is shortlist/hold/reject (${a.recommendation.decision})`,
  );
  const corrected = a.confirmedOrCorrectedResumeDetails.filter((d) => d.status === "corrected");
  check(
    corrected.length > 0,
    `a resume detail is "corrected" (${corrected.map((d) => `${d.field}: ${d.resumeValue} → ${d.candidateStatement}`).join("; ")})`,
    JSON.stringify(a.confirmedOrCorrectedResumeDetails),
  );

  // 6. Persisted on disk
  const store = JSON.parse(await readFile(DATA_FILE, "utf8")) as { candidates: Candidate[] };
  const onDisk = store.candidates.find((c) => c.id === candidate.id);
  check(onDisk !== undefined, "data/candidates.json contains the candidate");
  const diskCall = onDisk.calls.find((c) => c.callId === "e2e-test-call");
  check(diskCall !== undefined, 'on disk: call with callId "e2e-test-call"');
  check(diskCall.transcript.length === transcript.length, `on disk: transcript has ${transcript.length} lines`);
  check(diskCall.durationSec === 240, "on disk: durationSec === 240");
  check(onDisk.status === "called", 'on disk: status "called"');

  // 7. Second call (assistant-only, so no second Gemini request is needed)
  const second = await fetch(`${BASE_URL}/api/candidates/${candidate.id}/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, callId: "e2e-test-call-2", transcript: transcript.filter((l) => l.role === "assistant").slice(0, 1) }),
  });
  const secondBody = (await readJson(second)) as { candidate: Candidate; call: CallRecord };
  check(second.status === 201 && secondBody.candidate.calls.length === 2, "second call saved → calls.length === 2");
  check(secondBody.call.analysisError !== null, "assistant-only call saved with analysisError");

  // 8. CSV export
  const csvRes = await fetch(`${BASE_URL}/api/export.csv`);
  const csvBytes = new Uint8Array(await csvRes.arrayBuffer());
  check(csvRes.status === 200, "GET /api/export.csv → 200");
  check(csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf, "CSV starts with UTF-8 BOM");
  const rows = parseCsv(new TextDecoder().decode(csvBytes).replace(/^﻿/, ""));
  const header = rows[0] ?? [];
  const idCol = header.indexOf("candidateId");
  const mine = rows.slice(1).filter((row) => row[idCol] === candidate.id);
  check(mine.length === 2, `CSV has exactly 2 rows for this candidate (found ${mine.length})`);
  check(rows.slice(1).every((row) => row.length === header.length), `every CSV row has ${header.length} columns`);

  // 9. Negative: .txt upload
  const bad = new FormData();
  bad.append("resume", new Blob(["just some text"], { type: "text/plain" }), "notes.txt");
  const badRes = await fetch(`${BASE_URL}/api/resume`, { method: "POST", body: bad });
  const badBody = await readJson(badRes);
  check(badRes.status === 415 && isApiError(badBody), ".txt upload → 415 JSON error", JSON.stringify(badBody));

  // 10. Phone call (never dials: only checks validation, config and error shapes)
  const phoneCfg = (h as { phoneCall?: { configured?: unknown; missingEnvVars?: unknown } }).phoneCall;
  check(
    typeof phoneCfg?.configured === "boolean" && Array.isArray(phoneCfg.missingEnvVars),
    `health.phoneCall reports configuration (configured: ${String(phoneCfg?.configured)})`,
  );
  const phoneCases: [string | null, string | null][] = [
    ["+91-8299269534", "+918299269534"],
    ["8299269534", "+918299269534"],
    ["08299269534", "+918299269534"],
    ["+91 98765 43210 / 9123456789", "+919876543210"],
    ["+1 (737) 250-8034", "+17372508034"],
    ["12345", null],
    [null, null],
  ];
  const badPhone = phoneCases.find(([input, want]) => toE164(input) !== want);
  check(badPhone === undefined, "toE164 normalises Indian and international numbers", JSON.stringify(badPhone));
  const noJob = await fetch(`${BASE_URL}/api/candidates/${candidate.id}/phone-call`);
  const noJobBody = await readJson(noJob);
  check(noJob.status === 404 && isApiError(noJobBody), "GET /:id/phone-call before any call → 404 JSON error", JSON.stringify(noJobBody));
  const ghost = await fetch(`${BASE_URL}/api/candidates/00000000-0000-4000-8000-000000000000/phone-call`, { method: "POST" });
  check(ghost.status === 404 && isApiError(await readJson(ghost)), "POST phone-call for unknown candidate → 404");
  if (phoneCfg?.configured === false) {
    const unconfigured = await fetch(`${BASE_URL}/api/candidates/${candidate.id}/phone-call`, { method: "POST" });
    const unconfiguredBody = await readJson(unconfigured);
    check(
      unconfigured.status === 503 && isApiError(unconfiguredBody) && unconfiguredBody.code === "PHONE_NOT_CONFIGURED",
      "POST phone-call without Vapi phone env → 503 PHONE_NOT_CONFIGURED",
      JSON.stringify(unconfiguredBody),
    );
  } else {
    console.log("   … phone calls are configured: skipping the POST check so the e2e never dials a real number");
  }

  // 11. Cleanup
  if (KEEP) {
    console.log(`\n   (--keep) left candidate ${candidate.id} in place`);
  } else {
    await cleanup();
  }
}

async function cleanup(): Promise<void> {
  if (!createdId) return;
  const id = createdId;
  createdId = null;
  const del = await fetch(`${BASE_URL}/api/candidates/${id}`, { method: "DELETE" });
  check(del.status === 204, "DELETE test candidate → 204");
  const gone = await fetch(`${BASE_URL}/api/candidates/${id}`);
  check(gone.status === 404, "GET deleted candidate → 404");
}

main()
  .then(() => {
    console.log(`\n🎉 All ${passed} checks passed.`);
  })
  .catch(async (err: unknown) => {
    if (!(err instanceof CheckFailed)) console.error("\n❌ Unexpected error:", err);
    // Don't leave a half-tested candidate behind (unless --keep).
    if (createdId && !KEEP) {
      await fetch(`${BASE_URL}/api/candidates/${createdId}`, { method: "DELETE" }).catch(() => undefined);
      console.log(`   cleaned up test candidate ${createdId}`);
    }
    console.log(`\nSummary: ${passed} passed, 1 failed.`);
    process.exit(1);
  });
