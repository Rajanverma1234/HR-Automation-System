// Generates 10 FICTIONAL resumes in samples/demo/ and uploads each one through POST /api/resume,
// so every card is extracted by Gemini exactly as a recruiter upload would be.
// Each candidate applies for a real opening listed on https://whitecollarrealty.com/career (checked 2026-11-24).
// The careers page gives no experience requirement for most roles, so the experience levels here are
// chosen to fit each role's seniority. The SEO Executive profile meets the stated "minimum 1 year of SEO experience".
// Usage: `npm run dev` first, then `npm run demo` (add `-- --no-upload` to only write the files).
// Resumes deliberately contain no salary or notice period: those come from the screening call.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

interface Role {
  title: string;
  company: string;
  dates: string;
  bullets: string[];
}

interface Profile {
  file: string;
  name: string;
  appliedFor: string;
  contact: string;
  summary: string;
  roles: Role[];
  projects?: string[];
  skills: string;
  education: string[];
}

const COMPANY = "White Collar Realty";

const PROFILES: Profile[] = [
  {
    file: "karan-malhotra.docx",
    name: "Karan Malhotra",
    appliedFor: "Real Estate Sales Executive (Gurgaon Team)",
    contact: "karan.malhotra@example.com | +91 90000 20001 | Gurugram",
    summary: "Real estate sales executive with 3 years of experience selling premium residential projects in Gurugram, from lead follow-up to site visits and closures.",
    roles: [
      { title: "Sales Executive", company: "Skyline Estates Advisory Pvt Ltd", dates: "Aug 2023 - Present", bullets: ["Handle 60+ assigned leads a month for Golf Course Extension Road projects.", "Conducted 25+ site visits a month; closed 14 units worth Rs 38 crore in FY 2025-26."] },
      { title: "Junior Sales Associate", company: "Primeview Realtors", dates: "Jul 2022 - Jul 2023", bullets: ["Qualified inbound leads and scheduled site visits for senior executives."] },
    ],
    skills: "Residential sales, Lead follow-up, Site visits, Negotiation, CRM (Salesforce), Client relationship management",
    education: ["BBA - Fictional University of Haryana, 2022"],
  },
  {
    file: "nikhil-bansal.docx",
    name: "Nikhil Bansal",
    appliedFor: "Senior Sales Executive (Dubai Team)",
    contact: "nikhil.bansal@example.com | +91 90000 20002 | New Delhi",
    summary: "Senior property consultant with 6 years of experience, including 3 years selling Dubai off-plan apartments to Indian investors over calls and video.",
    roles: [
      { title: "Senior Property Consultant - International Desk", company: "Gulfway Property Consultants", dates: "Sep 2023 - Present", bullets: ["Sell Dubai and Abu Dhabi off-plan projects to NRI and HNI investors.", "Closed AED 22 million in sales over the last 12 months; mentor 3 junior consultants."] },
      { title: "Sales Executive", company: "Landmark Habitat Realty", dates: "Apr 2020 - Aug 2023", bullets: ["Sold luxury apartments in Delhi NCR; top performer for 5 quarters."] },
    ],
    skills: "Dubai off-plan sales, HNI client handling, Negotiation, Video presentations, Deal closure, Mentoring",
    education: ["MBA in Marketing - Example School of Business, Delhi, 2020", "B.Com - Sample College, Delhi, 2018"],
  },
  {
    file: "pooja-chauhan.docx",
    name: "Pooja Chauhan",
    appliedFor: "Business Development Executive (BDE) (Gurgaon Team)",
    contact: "pooja.chauhan@example.com | +91 90000 20003 | Faridabad",
    summary: "Inside sales professional with 2 years of experience in ed-tech, moving into real estate business development.",
    roles: [
      { title: "Business Development Associate", company: "BrightPath Learning Pvt Ltd", dates: "Jan 2024 - Present", bullets: ["Make 120+ calls a day to qualify leads and book counselling sessions.", "Achieved 115% of the monthly revenue target for 9 of the last 12 months."] },
    ],
    skills: "Inside sales, Lead qualification, Cold calling, Follow-ups, LeadSquared CRM, Communication in Hindi and English",
    education: ["B.A. in English - Fictional College, Faridabad, 2023"],
  },
  {
    file: "ritu-yadav.docx",
    name: "Ritu Yadav",
    appliedFor: "CRM Executive / Tele Sales Executive (Gurgaon Team)",
    contact: "ritu.yadav@example.com | +91 90000 20004",
    summary: "Tele-sales executive with about 1.5 years of experience calling property leads, qualifying budget and intent, and handing them over to sales.",
    roles: [
      { title: "Tele Sales Executive", company: "Callwise Solutions Pvt Ltd", dates: "May 2025 - Present", bullets: ["Call 150+ real estate leads a day for developer clients.", "Qualify budget, location and timeline, and schedule site visits for the field team."] },
      { title: "Customer Support Associate", company: "Helpline Services", dates: "Jun 2024 - Apr 2025", bullets: ["Handled inbound customer calls and logged tickets in the CRM."] },
    ],
    skills: "Tele-calling, Lead qualification, CRM data entry, Follow-up calls, Hindi, English",
    education: ["B.Com - Sample College, Rewari, 2024"],
  },
  {
    file: "imran-sheikh.docx",
    name: "Imran Sheikh",
    appliedFor: "Team Leader (Dubai Team)",
    contact: "imran.sheikh@example.com | +91 90000 20005 | Gurugram",
    summary: "Real estate sales team leader with 8 years of experience, currently leading a 6-member team selling Dubai property to Indian buyers.",
    roles: [
      { title: "Team Leader - Dubai Sales", company: "Gulfway Property Consultants", dates: "Mar 2022 - Present", bullets: ["Lead a team of 6 sales executives; the team closed AED 48 million in 2025.", "Run daily pipeline reviews and weekly call-quality coaching."] },
      { title: "Senior Sales Executive", company: "Landmark Habitat Realty", dates: "Jun 2018 - Feb 2022", bullets: ["Sold luxury residential projects in Gurugram and Noida."] },
    ],
    skills: "Team leadership, Pipeline management, Sales coaching, Dubai property market, Negotiation, Daily reporting",
    education: ["BBA - Example University, Lucknow, 2018"],
  },
  {
    file: "deepak-arora.docx",
    name: "Deepak Arora",
    appliedFor: "Sales Manager (Gurgaon Team)",
    contact: "deepak.arora@example.com | Gurugram",
    summary: "Sales manager with 12 years in real estate, responsible for team revenue, forecasting and hiring for luxury residential launches.",
    roles: [
      { title: "Sales Manager", company: "Primeview Realtors", dates: "Jan 2021 - Present", bullets: ["Manage 3 team leaders and 18 executives; Rs 420 crore in sales in FY 2025-26.", "Own monthly forecasting, hiring and performance reviews."] },
      { title: "Team Leader", company: "Skyline Estates Advisory Pvt Ltd", dates: "Apr 2017 - Dec 2020", bullets: ["Led a team of 7 for new-launch residential projects."] },
      { title: "Sales Executive", company: "Skyline Estates Advisory Pvt Ltd", dates: "Jul 2014 - Mar 2017", bullets: ["Handled site visits and closures for Golf Course Road projects."] },
    ],
    skills: "Sales leadership, Revenue forecasting, Hiring, Performance reviews, Channel partner management, Luxury residential sales",
    education: ["MBA in Sales and Marketing - Fictional Institute of Management, 2014"],
  },
  {
    file: "tanya-gupta.docx",
    name: "Tanya Gupta",
    appliedFor: "SEO Executive",
    contact: "tanya.gupta@example.com | +91 90000 20007 | Noida",
    summary: "SEO executive with about 3.5 years of experience, including real estate SEO for a property listings website.",
    roles: [
      { title: "SEO Executive", company: "Keyword Kraft Digital", dates: "Jun 2024 - Present", bullets: ["Run technical, on-page and off-page SEO for a property listings portal; organic traffic up 70%.", "Implemented schema markup and fixed Core Web Vitals issues on 300+ project pages."] },
      { title: "SEO Trainee", company: "Keyword Kraft Digital", dates: "Jun 2023 - May 2024", bullets: ["Keyword research, content briefs and backlink outreach."] },
    ],
    skills: "Technical SEO, On-page SEO, Off-page SEO, Google Search Console, GA4, Ahrefs, SEMrush, Screaming Frog, Schema markup, AI search optimisation",
    education: ["B.Sc. in Computer Science - Sample University, Noida, 2023"],
  },
  {
    file: "harshit-saxena.docx",
    name: "Harshit Saxena",
    appliedFor: "Performance Marketing Specialist",
    contact: "harshit.saxena@example.com | +91 90000 20008 | Gurugram",
    summary: "Performance marketer with 4 years running Meta, Google, YouTube and LinkedIn lead-generation campaigns for real estate developers.",
    roles: [
      { title: "Performance Marketing Executive", company: "Adreach Media Pvt Ltd", dates: "Feb 2023 - Present", bullets: ["Manage Rs 25 lakh a month in ad spend for 5 developer clients.", "Cut cost per lead by 32% while keeping site-visit conversion steady."] },
      { title: "Digital Marketing Associate", company: "Clickbridge Agency", dates: "Jan 2022 - Jan 2023", bullets: ["Ran Google Search and Meta lead-form campaigns."] },
    ],
    skills: "Meta Ads, Google Ads, YouTube Ads, LinkedIn Ads, CPL optimisation, ROAS tracking, Landing page testing, GA4",
    education: ["BBA in Marketing - Example University, Delhi, 2021"],
  },
  {
    file: "shreya-kapoor.docx",
    name: "Shreya Kapoor",
    appliedFor: "HR Recruiter",
    contact: "shreya.kapoor@example.com | +91 90000 20009 | Gurugram",
    summary: "HR recruiter with 3 years of high-volume hiring for sales teams, from sourcing and screening to offer rollout.",
    roles: [
      { title: "Talent Acquisition Executive", company: "TalentBridge Staffing Pvt Ltd", dates: "Aug 2023 - Present", bullets: ["Hire 20+ sales executives a month for real estate and BFSI clients.", "Run first-round screening calls and coordinate interviews and offers."] },
      { title: "HR Intern", company: "TalentBridge Staffing Pvt Ltd", dates: "Feb 2023 - Jul 2023", bullets: ["Sourced candidates on Naukri and LinkedIn."] },
    ],
    skills: "Sourcing, Screening, Interview coordination, Offer rollout, Naukri, LinkedIn Recruiter, Walk-in drives",
    education: ["MBA in Human Resources - Fictional School of Management, 2023"],
  },
  {
    file: "aman-khanna.docx",
    name: "Aman Khanna",
    appliedFor: "AI Agent Builder Intern",
    contact: "aman.khanna@example.com | +91 90000 20010 | Ghaziabad",
    summary: "Final-year B.Tech student who builds AI agents that use tools and APIs, looking for an internship.",
    roles: [],
    projects: [
      "Property enquiry agent: a LangGraph agent that answers buyer questions from project brochures and books site visits through a calendar API.",
      "WhatsApp lead bot: captures name, budget and location from WhatsApp chats and saves them to Google Sheets.",
    ],
    skills: "Python, LangChain, LangGraph, OpenAI API, Prompt engineering, REST APIs, FastAPI",
    education: ["B.Tech in Computer Science (final year) - Example Institute of Technology, Ghaziabad, 2023 - 2027"],
  },
];

const heading = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 240 } });
const line = (text: string) => new Paragraph({ children: [new TextRun(text)] });
const bullet = (text: string) => new Paragraph({ text, bullet: { level: 0 } });

function buildDoc(p: Profile): Document {
  return new Document({
    creator: "hr-screening-agent demo generator",
    title: `${p.name} - Resume (fictional)`,
    sections: [
      {
        children: [
          new Paragraph({ text: p.name, heading: HeadingLevel.TITLE }),
          line(p.contact),
          new Paragraph({ children: [new TextRun({ text: "Position applied for: ", bold: true }), new TextRun(p.appliedFor)] }),
          line(`Applying to: ${COMPANY}`),
          heading("Professional Summary"),
          line(p.summary),
          ...(p.roles.length > 0
            ? [
                heading("Experience"),
                ...p.roles.flatMap((r) => [
                  new Paragraph({ children: [new TextRun({ text: `${r.title} - ${r.company}`, bold: true }), new TextRun(`   ${r.dates}`)] }),
                  ...r.bullets.map(bullet),
                ]),
              ]
            : []),
          ...(p.projects ? [heading("Projects"), ...p.projects.map(bullet)] : []),
          heading("Skills"),
          line(p.skills),
          heading("Education"),
          ...p.education.map(line),
        ],
      },
    ],
  });
}

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const upload = !process.argv.includes("--no-upload");
const outDir = path.resolve(process.cwd(), "samples", "demo");
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

if (upload) {
  // Re-running replaces this script's earlier cards instead of duplicating them. Other candidates are untouched.
  const demoFiles = new Set(PROFILES.map((p) => p.file));
  const existing = (await (await fetch(`${BASE_URL}/api/candidates`)).json()) as { id: string; resumeFileName: string }[];
  for (const c of existing.filter((c) => demoFiles.has(c.resumeFileName))) {
    await fetch(`${BASE_URL}/api/candidates/${c.id}`, { method: "DELETE" });
  }
}

let failed = 0;
for (const p of PROFILES) {
  const filePath = path.join(outDir, p.file);
  await writeFile(filePath, await Packer.toBuffer(buildDoc(p)));
  if (!upload) {
    console.log(`Wrote ${filePath}`);
    continue;
  }
  const bytes = await readFile(filePath);
  let res: Response;
  let body: unknown;
  // Gemini 503s surface as 502 GEMINI_OVERLOADED; wait and retry a couple of times before giving up.
  for (let attempt = 1; ; attempt++) {
    const form = new FormData();
    form.append("resume", new Blob([bytes], { type: DOCX_MIME }), p.file);
    res = await fetch(`${BASE_URL}/api/resume`, { method: "POST", body: form });
    body = await res.json().catch(() => null);
    if (res.status !== 502 || attempt === 3) break;
    console.log(`… ${p.name}: AI busy, retrying in 20 s`);
    await new Promise((r) => setTimeout(r, 20_000));
  }
  if (res.status === 201) {
    console.log(`✅ ${p.name} (${p.appliedFor}) uploaded`);
  } else {
    failed++;
    console.log(`❌ ${p.name}: ${res.status} ${JSON.stringify(body)}`);
  }
}
console.log(upload ? `\nDone: ${PROFILES.length - failed} uploaded, ${failed} failed.` : "\nDone.");
if (failed > 0) process.exitCode = 1;
