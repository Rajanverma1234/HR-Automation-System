import type { Candidate } from "../../shared/types";
import { buildFirstMessage, experienceText, firstNameOf, missingResumeFields } from "./agentPrompt";
import { JOB_ROLE } from "./vapiConfig";

/**
 * Scripted screening flow for the free browser-voice demo (used when Vapi is not configured).
 * It follows the same order as the Vapi system prompt: greeting → confirm resume → missing fields → screening questions.
 */
export type DemoScript = {
  greeting: string;
  questions: string[];
  closing: string;
  callBack: string;
};

function confirmQuestion(candidate: Candidate): string | null {
  const r = candidate.resumeData;
  const exp = experienceText(r.totalExperienceYears);
  const role = r.currentDesignation && r.currentCompany
    ? `${r.currentDesignation} at ${r.currentCompany}`
    : (r.currentDesignation ?? (r.currentCompany ? `working at ${r.currentCompany}` : null));
  if (role && exp) return `Great. Your resume says you're currently a ${role}, with about ${exp} of experience. Is that correct?`;
  if (role) return `Great. Your resume says you're currently a ${role}. Is that correct?`;
  if (exp) return `Great. Your resume shows about ${exp} of experience. Is that correct?`;
  return null;
}

export function buildDemoScript(candidate: Candidate): DemoScript {
  const first = firstNameOf(candidate.resumeData.name);
  const confirm = confirmQuestion(candidate);
  // "total years of experience" etc. are only asked when the resume didn't have them.
  const missing = missingResumeFields(candidate.resumeData).map((label) => `Could you tell me your ${label}?`);

  return {
    greeting: buildFirstMessage(candidate),
    questions: [
      ...(confirm ? [confirm] : []),
      ...missing,
      "What is your current CTC?",
      "And what is your expected CTC?",
      "What is your notice period, and is it negotiable?",
      "Why are you looking for a change?",
      "Which work location would you prefer?",
      `Are you interested in ${JOB_ROLE}?`,
      "When would you be available for an interview in the coming days?",
    ],
    closing: `Thank you${first ? `, ${first}` : ""}. That's everything I needed. The recruiter will get back to you soon. Have a great day, goodbye!`,
    callBack: "No problem. The recruiter will call you back at a better time. Thank you, goodbye!",
  };
}

/** True when the candidate's reply to the greeting means "not a good time". */
export function isNotAGoodTime(reply: string): boolean {
  return /^(no\b|nope|not now|not really|busy|nahi|nahin|abhi nahi)|\b(call (me )?later|busy right now|baad mein|baad me)\b/i.test(reply.trim());
}
