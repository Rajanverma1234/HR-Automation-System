// Team page for super admins: who can sign in, add recruiters, reset their passwords, remove them.
// Owner (super admin) accounts come from the server's HR_USERS setting and are read-only here.
import { KeyRound, Loader2, ShieldCheck, Trash2, UserPlus, Users, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import type { HrUserSummary } from "../../shared/types";
import { createHrUser, deleteHrUser, errorMessage, listHrUsers, updateHrUser } from "../api";
import { lockBodyScroll } from "../lib/scrollLock";
import ConfirmDialog from "./ConfirmDialog";
import { useToast } from "./Toast";

const MIN_PASSWORD = 10;
const inputClass =
  "min-h-11 w-full rounded-lg border border-slate-300 px-3 text-base font-normal focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30";

type Props = { currentUsername: string | null; onClose: () => void };

export default function TeamPanel({ currentUsername, onClose }: Props) {
  const toast = useToast();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [users, setUsers] = useState<HrUserSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<HrUserSummary | null>(null);
  const [removing, setRemoving] = useState<HrUserSummary | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const load = useCallback(() => {
    setLoadError(null);
    listHrUsers()
      .then(setUsers)
      .catch((err: unknown) => setLoadError(errorMessage(err)));
  }, []);

  useEffect(() => {
    load();
    const unlock = lockBodyScroll();
    closeRef.current?.focus();
    return unlock;
  }, [load]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const nestedOpen = resetFor !== null || removing !== null;
  useEffect(() => {
    if (nestedOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nestedOpen]);

  async function confirmRemove() {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      await deleteHrUser(removing.id);
      setUsers((list) => list?.filter((u) => u.id !== removing.id) ?? null);
      toast.success(`Removed ${removing.name ?? removing.username}`);
      setRemoving(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRemoveBusy(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/40" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="flex h-full w-full max-w-lg flex-col bg-slate-50 shadow-xl">
        <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <Users className="h-5 w-5 text-indigo-600" aria-hidden />
          <h2 id={titleId} className="flex-1 text-base font-semibold">
            Team
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close team"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
          <AddRecruiterForm onAdded={(u) => setUsers((list) => [...(list ?? []), u])} />

          <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">Who can sign in</h3>
            {loadError ? (
              <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-red-700">
                {loadError}
                <button type="button" onClick={load} className="min-h-11 rounded-lg px-3 font-medium text-red-700 hover:bg-red-50">
                  Retry
                </button>
              </div>
            ) : users === null ? (
              <div className="flex justify-center p-6">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-label="Loading team" />
              </div>
            ) : (
              <ul className="divide-y divide-slate-100" aria-label="HR accounts">
                {users.map((u) => (
                  <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {u.name ?? u.username}
                        {u.username === currentUsername && <span className="ml-1 text-xs font-normal text-slate-500">(you)</span>}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {u.username}
                        {u.createdBy ? ` · added by ${u.createdBy}` : ""}
                      </p>
                    </div>
                    {u.role === "superadmin" ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200"
                        title="Owner account, set on the server (HR_USERS). Can manage the team and delete candidates."
                      >
                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                        Super admin
                      </span>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">Recruiter</span>
                        <button
                          type="button"
                          onClick={() => setResetFor(u)}
                          aria-label={`Reset password for ${u.username}`}
                          title="Reset password"
                          className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                        >
                          <KeyRound className="h-4 w-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => setRemoving(u)}
                          aria-label={`Remove ${u.username}`}
                          title="Remove account"
                          className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="text-xs text-slate-500">
            Recruiters can view, call and update candidates. Only super admins can manage the team and delete candidates. Super admin
            accounts are set on the server (HR_USERS) and can't be changed here.
          </p>
        </div>
      </div>

      {resetFor && <ResetPasswordDialog user={resetFor} onClose={() => setResetFor(null)} />}
      <ConfirmDialog
        open={removing !== null}
        title="Remove this account?"
        message={`${removing?.name ?? removing?.username ?? ""} will be signed out and won't be able to sign in again. Candidates aren't affected.`}
        confirmLabel="Remove"
        destructive
        loading={removeBusy}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setRemoving(null)}
      />
    </div>,
    document.body,
  );
}

function AddRecruiterForm({ onAdded }: { onAdded: (user: HrUserSummary) => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createHrUser({ name: name.trim() || null, username: username.trim(), password });
      onAdded(created);
      toast.success(`Added ${created.name ?? created.username}. Share the username and password with them.`);
      setName("");
      setUsername("");
      setPassword("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Add a recruiter">
      <h3 className="text-sm font-semibold text-slate-700">Add a recruiter</h3>
      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Name
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Username
        <input
          className={inputClass}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          minLength={3}
          maxLength={64}
          autoCapitalize="none"
          spellCheck={false}
          autoComplete="off"
          placeholder="e.g. priya"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Password
        <input
          className={inputClass}
          type="text"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={MIN_PASSWORD}
          autoComplete="new-password"
          spellCheck={false}
        />
        <span className="text-xs font-normal text-slate-500">At least {MIN_PASSWORD} characters. Share it with them privately.</span>
      </label>
      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <UserPlus className="h-4 w-4" aria-hidden />}
        Add recruiter
      </button>
    </form>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: HrUserSummary; onClose: () => void }) {
  const toast = useToast();
  const titleId = useId();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await updateHrUser(user.id, { password });
      toast.success(`New password set for ${user.name ?? user.username}. They've been signed out everywhere.`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={(e) => void submit(e)}
        className="flex w-full max-w-sm flex-col gap-3 rounded-xl bg-white p-5 shadow-xl"
      >
        <h3 id={titleId} className="text-base font-semibold">
          Reset password for {user.name ?? user.username}
        </h3>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          New password
          <input
            className={inputClass}
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={MIN_PASSWORD}
            autoFocus
            autoComplete="new-password"
            spellCheck={false}
          />
        </label>
        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Set password
          </button>
        </div>
      </form>
    </div>
  );
}
