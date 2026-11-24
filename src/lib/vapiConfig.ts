// import.meta.env is injected by Vite. It is undefined when this module runs under plain Node/tsx
// (e.g. a check script), so read it defensively.
const env: Partial<ImportMetaEnv> = (import.meta.env as ImportMetaEnv | undefined) ?? {};

export const VAPI_PUBLIC_KEY: string = env.VITE_VAPI_PUBLIC_KEY?.trim() ?? "";
export const VAPI_ASSISTANT_ID: string = env.VITE_VAPI_ASSISTANT_ID?.trim() ?? "";

/** Names of the Vapi env vars that are not set. */
export const vapiMissingEnvVars: string[] = [
  ...(VAPI_PUBLIC_KEY ? [] : ["VITE_VAPI_PUBLIC_KEY"]),
  ...(VAPI_ASSISTANT_ID ? [] : ["VITE_VAPI_ASSISTANT_ID"]),
];

export const isVapiConfigured: boolean = vapiMissingEnvVars.length === 0;

/** The name the voice agent introduces itself with. */
export const AGENT_NAME = "Priya";

/** The hiring company the agent says it calls from. */
export const COMPANY_NAME = "Acme Talent";

/** How the agent refers to the opening, mid-sentence ("calling about {JOB_ROLE}"). */
export const JOB_ROLE = "the Senior Software Engineer role";

/** LLM used by the Vapi assistant for this call. Must match a provider/model enabled on your Vapi account. */
export const VAPI_MODEL = { provider: "openai", model: "gpt-4o" } as const;
