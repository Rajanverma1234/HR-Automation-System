import { Volume2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { getSavedVoiceName, loadVoices, previewVoice, saveVoiceName } from "../hooks/useBrowserVoiceCall";

/** Lets the recruiter audition and pick the browser voice used by the free demo agent. */
export default function VoicePicker() {
  const id = useId();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selected, setSelected] = useState<string>("");

  useEffect(() => {
    let alive = true;
    void loadVoices().then((list) => {
      if (!alive) return;
      setVoices(list);
      const saved = getSavedVoiceName();
      setSelected(saved && list.some((v) => v.name === saved) ? saved : (list[0]?.name ?? ""));
    });
    return () => {
      alive = false;
    };
  }, []);

  if (voices.length === 0) return null;
  const hasNatural = voices.some((v) => /natural/i.test(v.name));
  const current = voices.find((v) => v.name === selected);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label htmlFor={id} className="text-sm font-medium">
          Agent voice
        </label>
        <select
          id={id}
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            saveVoiceName(e.target.value);
            const v = voices.find((x) => x.name === e.target.value);
            if (v) previewVoice(v);
          }}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-indigo-200 bg-white px-3 text-sm text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          {voices.map((v) => (
            <option key={v.name} value={v.name}>
              {/natural/i.test(v.name) ? "★ " : ""}
              {v.name} ({v.lang})
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => current && previewVoice(current)}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-white px-4 text-sm font-medium text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <Volume2 className="h-4 w-4" aria-hidden />
          Preview
        </button>
      </div>
      {!hasNatural && (
        <p className="text-xs">
          No natural (★) voices found in this browser. Open this page in <strong>Microsoft Edge</strong> for free, human-sounding
          neural voices such as “Microsoft Neerja Online (Natural) – English (India)”.
        </p>
      )}
    </div>
  );
}
