import { AlertTriangle, Loader2, LogIn, UserSearch } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { AuthSession } from "../../shared/types";
import { COMPANY_NAME } from "../../shared/company";
import { errorMessage, login } from "../api";

type Props = {
  /** false when the server has no valid HR_USERS / AUTH_SECRET: nobody can sign in yet. */
  configured: boolean;
  onSignedIn: (session: AuthSession) => void;
};

export default function LoginPage({ configured, onSignedIn }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await login(username, password));
    } catch (err) {
      setError(errorMessage(err));
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 text-slate-900">
      <main className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-white">
            <UserSearch className="h-6 w-6" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-semibold">HR Screening Agent</h1>
            <p className="text-sm text-slate-500">{COMPANY_NAME} · HR team sign-in</p>
          </div>
        </div>

        {!configured ? (
          <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            HR sign-in isn't set up on the server yet. The admin needs to set HR_USERS and AUTH_SECRET.
          </p>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              Username
              <input
                type="text"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="min-h-11 rounded-lg border border-slate-300 px-3 text-base font-normal focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              Password
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="min-h-11 rounded-lg border border-slate-300 px-3 text-base font-normal focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              />
            </label>
            {error && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <LogIn className="h-4 w-4" aria-hidden />}
              Sign in
            </button>
          </form>
        )}

        <p className="mt-4 text-center text-xs text-slate-500">
          Candidates: please use the application link HR shared with you.
        </p>
      </main>
    </div>
  );
}
