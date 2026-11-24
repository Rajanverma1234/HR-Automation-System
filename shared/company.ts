// Company and agent facts used by both the browser call (src/) and the server phone call (server/).

/** The name the voice agent introduces itself with. */
export const AGENT_NAME = "Priya";

/** The hiring company the agent says it calls from. */
export const COMPANY_NAME = "White Collar Realty";

/** Facts the agent may share about the company. Source: whitecollarrealty.com and its /career page. */
export const COMPANY_FACTS =
  "White Collar Realty is a developer-authorised real estate advisory, founded in 2020, that helps buyers and investors with luxury residential and commercial property in Delhi NCR and Dubai. " +
  "Every role, including the Dubai desk, is based at the Gurgaon office: 6th Floor, Tower A, M3M Urbana Business Park, Golf Course Extension Road, Sector 67, Gurugram. The Dubai team works over calls and video from Gurgaon, so no relocation is needed.";

/** Short office location used in the screening question about work location. */
export const OFFICE_LOCATION = "our Gurgaon office on Golf Course Extension Road";

/** Used mid-sentence ("calling about {role}") when the resume doesn't say which position the candidate applied for. */
export const DEFAULT_JOB_ROLE = "an open position with us";

/** How the agent refers to this candidate's opening, mid-sentence: "the SEO Executive role", or the default. */
export function jobRoleFor(appliedRole: string | null): string {
  if (!appliedRole) return DEFAULT_JOB_ROLE;
  // "Sales Manager (Gurgaon Team)" or "Sales Manager - Gurgaon Team" is spoken as "the Sales Manager role in our Gurgaon team".
  const m = /^(.+?)\s*(?:[-–]\s*|\(\s*)([^()]*?\bteam)\)?$/i.exec(appliedRole.trim());
  const title = m?.[1] ?? appliedRole.trim();
  const base = /\b(role|position)$/i.test(title) ? `the ${title}` : `the ${title} role`;
  return m ? `${base} in our ${m[2].replace(/\bTeam$/, "team")}` : base;
}

/** LLM used by the Vapi assistant for this call. Must match a provider/model enabled on your Vapi account. */
export const VAPI_MODEL = { provider: "openai", model: "gpt-4o" } as const;
