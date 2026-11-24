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

// Company/agent facts live in shared/ so the server's phone call uses the same script.
export {
  AGENT_NAME,
  COMPANY_FACTS,
  COMPANY_NAME,
  DEFAULT_JOB_ROLE,
  OFFICE_LOCATION,
  VAPI_MODEL,
  jobRoleFor,
} from "../../shared/company";
