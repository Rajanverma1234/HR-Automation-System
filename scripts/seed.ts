import { candidateRepository } from "../server/repository.js";
import { randomUUID } from "node:crypto";
import type { CallRecord, ResumeData, TranscriptLine } from "../shared/types.js";

// Clearly fictional data. Some fields are intentionally null to exercise null handling.
const resumeData: ResumeData = {
  name: "Priya Testcandidate",
  appliedRole: null,
  email: "priya.testcandidate@example.com",
  phone: "+91 90000 00000",
  location: null,
  currentCompany: "Acme Fictional Foods Pvt Ltd",
  currentDesignation: "Senior Software Engineer",
  totalExperienceYears: 6,
  skills: ["TypeScript", "React", "Node.js", "PostgreSQL", "AWS"],
  education: [
    { degree: "B.Tech, Computer Science", institution: "Example Institute of Technology", year: "2018" },
    { degree: null, institution: "Sample Public School", year: null },
  ],
  previousCompanies: [
    { company: "Placeholder Logistics", designation: "Software Engineer", duration: "2020 - 2022" },
    { company: "Demo Systems", designation: "Graduate Engineer Trainee", duration: null },
  ],
  summary:
    "Full-stack engineer with 6 years of experience building web platforms for supply-chain and consumer apps.",
};

const candidate = await candidateRepository.create({
  resumeData,
  resumeFileName: "priya-testcandidate-resume.pdf",
});

console.log(`Seeded candidate ${candidate.id} (${candidate.resumeData.name ?? "unnamed"})`);

if (process.argv.includes("--with-call")) {
  const endedAt = new Date(Date.now() - 60 * 60 * 1000);
  const durationSec = 263;
  const startedAt = new Date(endedAt.getTime() - durationSec * 1000);
  const at = (offsetSec: number) => new Date(startedAt.getTime() + offsetSec * 1000).toISOString();

  const transcript: TranscriptLine[] = [
    { role: "assistant", at: at(2), text: "Hi Priya, this is the screening assistant calling about the Senior Engineer role. Is now a good time to talk for five minutes?" },
    { role: "user", at: at(9), text: "Yes, sure, go ahead." },
    { role: "assistant", at: at(14), text: "Your resume says you're a Senior Software Engineer at Acme Fictional Foods with about six years of experience. Is that right?" },
    { role: "user", at: at(24), text: "Yes, that's correct. It's actually closer to six and a half years now." },
    { role: "assistant", at: at(31), text: "Thanks. Could you share your current CTC, your expected CTC and your notice period?" },
    { role: "user", at: at(40), text: "Current is 24 lakhs per annum, I'm expecting around 32, and my notice period is 60 days, negotiable to 45." },
    { role: "assistant", at: at(55), text: "Got it. Which city would you prefer to work from, and why are you looking for a change?" },
    { role: "user", at: at(66), text: "I'm based in Pune and would prefer Pune or remote. I'm looking for a bigger product-ownership role. I'm free for an interview any weekday after 4 pm." },
  ];

  const call: CallRecord = {
    id: randomUUID(),
    callId: `seed-call-${randomUUID().slice(0, 8)}`,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationSec,
    transcript,
    analysis: {
      currentCTC: "24 LPA",
      expectedCTC: "32 LPA",
      noticePeriod: "60 days (negotiable to 45)",
      reasonForChange: "Looking for a bigger product-ownership role.",
      preferredLocation: "Pune or remote",
      interested: "yes",
      interviewAvailability: "Any weekday after 4 pm",
      confirmedOrCorrectedResumeDetails: [
        { field: "Current designation", resumeValue: "Senior Software Engineer", candidateStatement: "Senior Software Engineer", status: "confirmed" },
        { field: "Current company", resumeValue: "Acme Fictional Foods Pvt Ltd", candidateStatement: "Acme Fictional Foods", status: "confirmed" },
        { field: "Total experience", resumeValue: "6 yrs", candidateStatement: "Closer to six and a half years", status: "corrected" },
        { field: "Location", resumeValue: null, candidateStatement: "Based in Pune", status: "unclear" },
      ],
      keyNotes: [
        "Notice period of 60 days, negotiable to 45.",
        "Expects roughly a 33% hike.",
        "Prefers Pune or remote.",
      ],
      callSummary:
        "Priya confirmed her current role and experience, shared compensation and notice details, and is interested in the position. She is looking for more product ownership and is available for interviews on weekday evenings.",
      recommendation: {
        decision: "shortlist",
        reason: "Relevant experience and clear interest; compensation expectation is within a typical band for the role.",
      },
    },
    analysisError: null,
    createdAt: endedAt.toISOString(),
  };

  await candidateRepository.update(candidate.id, (c) => ({ ...c, status: "called", calls: [...c.calls, call] }));
  console.log(`Added call ${call.id} with analysis and ${transcript.length}-line transcript`);
}
