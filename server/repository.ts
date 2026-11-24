import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Candidate, ResumeData } from "../shared/types.js";
import { AppError } from "./errors.js";

export interface CandidateRepository {
  /** All candidates, newest first. */
  list(): Promise<Candidate[]>;
  get(id: string): Promise<Candidate | null>;
  create(input: { resumeData: ResumeData; resumeFileName: string }): Promise<Candidate>;
  /** Applies `updater` and sets updatedAt. Returns null if the candidate does not exist. */
  update(id: string, updater: (c: Candidate) => Candidate): Promise<Candidate | null>;
  delete(id: string): Promise<boolean>;
}

type StoreFile = { candidates: Candidate[] };

function isStoreFile(value: unknown): value is StoreFile {
  return (
    typeof value === "object" &&
    value !== null &&
    "candidates" in value &&
    Array.isArray(value.candidates)
  );
}

function corrupted(): AppError {
  return new AppError(500, "data/candidates.json is corrupted; fix or move it.", "DATA_CORRUPT");
}

export class JsonFileCandidateRepository implements CandidateRepository {
  private readonly filePath: string;
  /** Promise-chain lock: every operation runs after the previous one settles. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /**
   * Runs `fn` exclusively. Reads are queued too, so a read never races the
   * temp-file rename (on Windows a rename can fail while another handle is open).
   */
  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async load(): Promise<StoreFile> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (err) {
      if (err instanceof Error && "code" in err && err.code === "ENOENT") {
        const empty: StoreFile = { candidates: [] };
        await this.save(empty);
        return empty;
      }
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw corrupted();
    }
    if (!isStoreFile(parsed)) throw corrupted();
    // Records saved before `appliedRole` existed: treat the missing field as null.
    // Same for `interview` and `interviewSlot`, added later still.
    for (const c of parsed.candidates) {
      c.resumeData.appliedRole ??= null;
      c.interview ??= null;
      for (const call of c.calls) if (call.analysis) call.analysis.interviewSlot ??= null;
    }
    return parsed;
  }

  private async save(store: StoreFile): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(store, null, 2) + "\n", "utf8");
      await rename(tmp, this.filePath);
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
  }

  list(): Promise<Candidate[]> {
    return this.withLock(async () => {
      const { candidates } = await this.load();
      return [...candidates].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  }

  get(id: string): Promise<Candidate | null> {
    return this.withLock(async () => {
      const { candidates } = await this.load();
      return candidates.find((c) => c.id === id) ?? null;
    });
  }

  create(input: { resumeData: ResumeData; resumeFileName: string }): Promise<Candidate> {
    return this.withLock(async () => {
      const store = await this.load();
      const now = new Date().toISOString();
      const candidate: Candidate = {
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
        resumeFileName: input.resumeFileName,
        resumeData: input.resumeData,
        status: "new",
        calls: [],
        interview: null,
      };
      store.candidates.push(candidate);
      await this.save(store);
      return candidate;
    });
  }

  update(id: string, updater: (c: Candidate) => Candidate): Promise<Candidate | null> {
    return this.withLock(async () => {
      const store = await this.load();
      const index = store.candidates.findIndex((c) => c.id === id);
      const existing = store.candidates[index];
      if (index === -1 || existing === undefined) return null;
      const updated: Candidate = {
        ...updater(structuredClone(existing)),
        id: existing.id,
        updatedAt: new Date().toISOString(),
      };
      store.candidates[index] = updated;
      await this.save(store);
      return updated;
    });
  }

  delete(id: string): Promise<boolean> {
    return this.withLock(async () => {
      const store = await this.load();
      const remaining = store.candidates.filter((c) => c.id !== id);
      if (remaining.length === store.candidates.length) return false;
      await this.save({ candidates: remaining });
      return true;
    });
  }
}

export const candidateRepository: CandidateRepository = new JsonFileCandidateRepository(
  path.resolve(process.cwd(), "data", "candidates.json"),
);
