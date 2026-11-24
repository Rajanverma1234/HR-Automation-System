import { candidateRepository } from "../server/repository.js";
import type { ResumeData } from "../shared/types.js";

// Clearly fictional data. Some fields are intentionally null to exercise null handling.
const resumeData: ResumeData = {
  name: "Priya Testcandidate",
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
