import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { BlobPreconditionFailedError, get as blobGet, put as blobPut } from "@vercel/blob";
import type { Candidate, ResumeData, StoredHrUser } from "../shared/types.js";
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

/** Recruiter accounts added on the Team page. They live in the same document as the candidates. */
export interface HrUserRepository {
  listHrUsers(): Promise<StoredHrUser[]>;
  /** Fails with 409 USERNAME_TAKEN if `isTaken` says so or a stored account already has the username. */
  createHrUser(user: StoredHrUser, isTaken: (username: string) => boolean): Promise<StoredHrUser>;
  /** Applies `updater` and sets updatedAt. Returns null if the account does not exist. */
  updateHrUser(id: string, updater: (u: StoredHrUser) => StoredHrUser): Promise<StoredHrUser | null>;
  deleteHrUser(id: string): Promise<boolean>;
}

/** `hrUsers` is missing in documents saved before HR accounts existed. */
type StoreFile = { candidates: Candidate[]; hrUsers?: StoredHrUser[] };

function isStoreFile(value: unknown): value is StoreFile {
  return (
    typeof value === "object" &&
    value !== null &&
    "candidates" in value &&
    Array.isArray(value.candidates)
  );
}

// ---------- storage backends: where the one JSON document lives ----------

/** Thrown by a backend when the document changed since it was read (another instance wrote first). */
class StoreConflictError extends Error {}

interface StoreBackend {
  /** Human-readable location, used in error messages. */
  readonly label: string;
  /** The document text (null if it doesn't exist yet) and an opaque version for conditional writes. */
  read(): Promise<{ text: string | null; version: string | null }>;
  /** Writes the document. Throws StoreConflictError if `version` is no longer current. */
  write(text: string, version: string | null): Promise<void>;
}

/** Local development: data/candidates.json, written atomically (temp file + rename). Single process, so no versions. */
class FileBackend implements StoreBackend {
  constructor(private readonly filePath: string) {}

  get label(): string {
    return "data/candidates.json";
  }

  async read(): Promise<{ text: string | null; version: string | null }> {
    try {
      return { text: await readFile(this.filePath, "utf8"), version: null };
    } catch (err) {
      if (err instanceof Error && "code" in err && err.code === "ENOENT") return { text: null, version: null };
      throw err;
    }
  }

  async write(text: string): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, text, "utf8");
      await rename(tmp, this.filePath);
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
  }
}

/**
 * Vercel: the same document as a private Vercel Blob. Function instances don't share a disk, so every read
 * bypasses the CDN cache and every write is conditional on the ETag that was read (optimistic concurrency).
 * Authenticates with the project's OIDC token + BLOB_STORE_ID on Vercel, or BLOB_READ_WRITE_TOKEN elsewhere.
 */
class BlobBackend implements StoreBackend {
  constructor(private readonly pathname: string) {}

  get label(): string {
    return `Vercel Blob "${this.pathname}"`;
  }

  async read(): Promise<{ text: string | null; version: string | null }> {
    try {
      // A compressed response carries a weak ETag (W/"…") that never satisfies `ifMatch` on put, so ask for the
      // uncompressed bytes; strip a W/ prefix too, in case a proxy compresses anyway (the hash itself is the same).
      const res = await blobGet(this.pathname, { access: "private", useCache: false, headers: { "Accept-Encoding": "identity" } });
      if (res === null || res.statusCode !== 200) return { text: null, version: null };
      return { text: await new Response(res.stream).text(), version: res.blob.etag.replace(/^W\//, "") };
    } catch (err) {
      throw storageError(this.label, err);
    }
  }

  async write(text: string, version: string | null): Promise<void> {
    try {
      await blobPut(this.pathname, text, {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        // First write: must not exist yet. Later writes: only if nobody changed it since we read it.
        ...(version ? { ifMatch: version } : { allowOverwrite: false }),
      });
    } catch (err) {
      if (err instanceof BlobPreconditionFailedError) throw new StoreConflictError();
      if (version === null && err instanceof Error && /already exists/i.test(err.message)) throw new StoreConflictError();
      throw storageError(this.label, err);
    }
  }
}

function storageError(label: string, err: unknown): AppError {
  console.error(`[storage] ${label}:`, err);
  const detail = err instanceof Error ? err.message : String(err);
  return new AppError(500, `Couldn't access candidate storage (${label}): ${detail}`, "STORAGE_ERROR");
}

const MAX_CONFLICT_RETRIES = 5;

// ---------- repository ----------

export class JsonCandidateRepository implements CandidateRepository, HrUserRepository {
  /** Promise-chain lock: within one process, every operation runs after the previous one settles. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly backend: StoreBackend) {}

  /**
   * Runs `fn` exclusively. Reads are queued too, so a read never races the
   * temp-file rename (on Windows a rename can fail while another handle is open).
   */
  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async load(): Promise<{ store: StoreFile; version: string | null }> {
    const { text, version } = await this.backend.read();
    if (text === null) return { store: { candidates: [] }, version };
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw this.corrupted();
    }
    if (!isStoreFile(parsed)) throw this.corrupted();
    // Records saved before these fields existed: treat the missing fields as null.
    for (const c of parsed.candidates) {
      c.resumeData.appliedRole ??= null;
      c.interview ??= null;
      for (const call of c.calls) if (call.analysis) call.analysis.interviewSlot ??= null;
    }
    return { store: parsed, version };
  }

  private corrupted(): AppError {
    return new AppError(500, `${this.backend.label} is corrupted; fix or move it.`, "DATA_CORRUPT");
  }

  private read<T>(fn: (store: StoreFile) => T): Promise<T> {
    return this.withLock(async () => fn((await this.load()).store));
  }

  /**
   * Read-modify-write. `fn` mutates the store and returns `changed: false` to skip the write.
   * On a conflict (another instance wrote in between) the whole step is retried on fresh data.
   */
  private transact<T>(fn: (store: StoreFile) => { result: T; changed: boolean }): Promise<T> {
    return this.withLock(async () => {
      for (let attempt = 0; ; attempt++) {
        const { store, version } = await this.load();
        const { result, changed } = fn(store);
        if (!changed) return result;
        try {
          await this.backend.write(JSON.stringify(store, null, 2) + "\n", version);
          return result;
        } catch (err) {
          if (err instanceof StoreConflictError && attempt < MAX_CONFLICT_RETRIES) continue;
          if (err instanceof StoreConflictError) {
            throw new AppError(503, "Candidate storage is busy; please retry.", "STORAGE_CONFLICT");
          }
          throw err;
        }
      }
    });
  }

  list(): Promise<Candidate[]> {
    return this.read(({ candidates }) => [...candidates].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  get(id: string): Promise<Candidate | null> {
    return this.read(({ candidates }) => candidates.find((c) => c.id === id) ?? null);
  }

  create(input: { resumeData: ResumeData; resumeFileName: string }): Promise<Candidate> {
    return this.transact((store) => {
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
      return { result: candidate, changed: true };
    });
  }

  update(id: string, updater: (c: Candidate) => Candidate): Promise<Candidate | null> {
    return this.transact((store) => {
      const index = store.candidates.findIndex((c) => c.id === id);
      const existing = store.candidates[index];
      if (index === -1 || existing === undefined) return { result: null, changed: false };
      const updated: Candidate = {
        ...updater(structuredClone(existing)),
        id: existing.id,
        updatedAt: new Date().toISOString(),
      };
      store.candidates[index] = updated;
      return { result: updated, changed: true };
    });
  }

  delete(id: string): Promise<boolean> {
    return this.transact((store) => {
      const before = store.candidates.length;
      store.candidates = store.candidates.filter((c) => c.id !== id);
      return { result: store.candidates.length !== before, changed: store.candidates.length !== before };
    });
  }

  // ---------- HR accounts ----------

  listHrUsers(): Promise<StoredHrUser[]> {
    return this.read(({ hrUsers }) => [...(hrUsers ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  }

  createHrUser(user: StoredHrUser, isTaken: (username: string) => boolean): Promise<StoredHrUser> {
    return this.transact((store) => {
      const users = store.hrUsers ?? [];
      if (isTaken(user.username) || users.some((u) => u.username === user.username)) {
        throw new AppError(409, `The username "${user.username}" is already taken.`, "USERNAME_TAKEN");
      }
      store.hrUsers = [...users, user];
      return { result: user, changed: true };
    });
  }

  updateHrUser(id: string, updater: (u: StoredHrUser) => StoredHrUser): Promise<StoredHrUser | null> {
    return this.transact((store) => {
      const users = store.hrUsers ?? [];
      const existing = users.find((u) => u.id === id);
      if (!existing) return { result: null, changed: false };
      const updated: StoredHrUser = {
        ...updater(structuredClone(existing)),
        id: existing.id,
        username: existing.username,
        updatedAt: new Date().toISOString(),
      };
      store.hrUsers = users.map((u) => (u.id === id ? updated : u));
      return { result: updated, changed: true };
    });
  }

  deleteHrUser(id: string): Promise<boolean> {
    return this.transact((store) => {
      const users = store.hrUsers ?? [];
      const remaining = users.filter((u) => u.id !== id);
      store.hrUsers = remaining;
      return { result: remaining.length !== users.length, changed: remaining.length !== users.length };
    });
  }
}

/** Vercel Blob when running on Vercel (or STORAGE=blob); otherwise the local JSON file. STORAGE=file forces the file. */
function createBackend(): StoreBackend {
  const storage = process.env.STORAGE;
  const useBlob = storage === "blob" || (storage !== "file" && Boolean(process.env.VERCEL));
  return useBlob ? new BlobBackend("candidates.json") : new FileBackend(path.resolve(process.cwd(), "data", "candidates.json"));
}

const repository = new JsonCandidateRepository(createBackend());
export const candidateRepository: CandidateRepository = repository;
export const hrUserRepository: HrUserRepository = repository;
