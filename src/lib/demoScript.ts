import type { Candidate } from "../../shared/types";
import { buildFirstMessage, experienceText, firstNameOf, missingResumeFields } from "./agentPrompt";
import { OFFICE_LOCATION, jobRoleFor } from "./vapiConfig";

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
  const missing = missingResumeFields(candidate.resumeData).map(
    (label) => `I couldn't find your ${label} on the resume. Could you share that?`,
  );

  return {
    greeting: buildFirstMessage(candidate),
    questions: [
      ...(confirm ? [confirm] : []),
      ...missing,
      "So, could you tell me your current CTC?",
      "And what are you expecting for this role?",
      "What's your notice period? Is there any flexibility on that?",
      "May I ask what's making you look for a change right now?",
      `This role is based at ${OFFICE_LOCATION}. Would working from there be comfortable for you?`,
      `And are you interested in ${jobRoleFor(candidate.resumeData.appliedRole)}?`,
      "Lovely. Which day and time would suit you for an interview at our Gurgaon office? For example, tomorrow at 11 AM.",
    ],
    closing: `Thank you${first ? `, ${first}` : ""}. That's everything I needed. I've noted your interview slot, and it will appear as scheduled in our system once this call ends. The recruiter will share the details. Have a great day, goodbye!`,
    callBack: "No problem. The recruiter will call you back at a better time. Thank you, goodbye!",
  };
}

/** True when the candidate's reply to the greeting means "not a good time". */
export function isNotAGoodTime(reply: string): boolean {
  return /^(no\b|nope|not now|not really|busy|nahi|nahin|abhi nahi)|\b(call (me )?later|busy right now|baad mein|baad me)\b/i.test(reply.trim());
}
