import { AlertCircle, FileUp, Loader2 } from "lucide-react";
import { useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import type { Candidate } from "../../shared/types";
import { errorMessage, uploadResume } from "../api";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".pdf", ".docx"];

type State =
  | { kind: "idle" }
  | { kind: "dragging" }
  | { kind: "uploading"; fileName: string }
  | { kind: "error"; message: string };

type Props = {
  onUploaded: (candidate: Candidate) => void;
  /** Called with the server's message when an upload fails (client-side validation errors stay inline). */
  onError?: (message: string) => void;
  disabled?: boolean;
  disabledReason?: string;
};

function validate(file: File): string | null {
  const name = file.name.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return name.endsWith(".doc")
      ? "Old .doc files are not supported. Save it as .docx or PDF and try again."
      : "Unsupported file type. Please upload a PDF or DOCX.";
  }
  if (file.size > MAX_BYTES) return "File is larger than 5 MB.";
  if (file.size === 0) return "This file is empty.";
  return null;
}

export default function UploadDropzone({ onUploaded, onError, disabled = false, disabledReason }: Props) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const uploading = state.kind === "uploading";
  const inactive = disabled || uploading;

  async function handleFile(file: File | undefined) {
    if (!file || inactive) return;
    const problem = validate(file);
    if (problem) {
      setState({ kind: "error", message: problem });
      return;
    }
    setState({ kind: "uploading", fileName: file.name });
    try {
      const candidate = await uploadResume(file);
      setState({ kind: "idle" });
      onUploaded(candidate);
    } catch (err) {
      const message = errorMessage(err);
      setState({ kind: "error", message });
      onError?.(message);
    }
  }

  function openPicker() {
    if (inactive) return;
    inputRef.current?.click();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPicker();
    }
  }

  function onDragEnter(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (inactive) return;
    dragDepth.current += 1;
    setState({ kind: "dragging" });
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.dataTransfer.dropEffect = inactive ? "none" : "copy";
  }

  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (inactive) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setState({ kind: "idle" });
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    dragDepth.current = 0;
    if (inactive) return;
    const files = e.dataTransfer.files;
    if (files.length > 1) {
      setState({ kind: "error", message: "Please drop one file at a time." });
      return;
    }
    void handleFile(files[0]);
  }

  const borderClass =
    state.kind === "dragging"
      ? "border-indigo-500 bg-indigo-50"
      : state.kind === "error"
        ? "border-red-300 bg-red-50/40"
        : "border-slate-300 bg-white hover:border-indigo-400 hover:bg-indigo-50/30";

  return (
    <div>
      <div
        role="button"
        tabIndex={inactive ? -1 : 0}
        aria-disabled={inactive}
        aria-busy={uploading}
        aria-label="Upload a resume (PDF or DOCX, up to 5 MB)"
        onClick={openPicker}
        onKeyDown={onKeyDown}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`flex min-h-44 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${borderClass} ${
          inactive ? "cursor-not-allowed opacity-60" : "cursor-pointer"
        }`}
      >
        {uploading ? (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-indigo-600" aria-hidden />
            <p className="text-sm font-medium text-slate-800">Reading resume with AI…</p>
            <p className="max-w-full truncate text-xs text-slate-500">{state.fileName}</p>
          </>
        ) : state.kind === "error" ? (
          <>
            <AlertCircle className="h-8 w-8 text-red-500" aria-hidden />
            <p className="text-sm font-medium text-red-700" role="alert">
              {state.message}
            </p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setState({ kind: "idle" });
                openPicker();
              }}
              className="min-h-11 rounded-lg bg-white px-4 text-sm font-medium text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              Try again
            </button>
          </>
        ) : (
          <>
            <FileUp
              className={`h-8 w-8 ${state.kind === "dragging" ? "text-indigo-600" : "text-slate-400"}`}
              aria-hidden
            />
            <p className="text-sm font-medium text-slate-800">
              {state.kind === "dragging" ? "Drop the resume here" : "Drag & drop a resume, or click to choose"}
            </p>
            <p className="text-xs text-slate-500">PDF or DOCX, up to 5 MB</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx"
          className="hidden"
          disabled={inactive}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            void handleFile(file);
          }}
        />
      </div>
      {disabled && disabledReason && <p className="mt-2 text-xs text-slate-500">{disabledReason}</p>}
    </div>
  );
}
