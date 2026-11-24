// Generates 10 FICTIONAL resumes in samples/demo/ and uploads each one through POST /api/resume,
// so every card is extracted by Gemini exactly as a recruiter upload would be.
// Usage: `npm run dev` first, then `npm run demo` (add `-- --no-upload` to only write the files).
// Resumes deliberately contain no salary or notice period: those come from the screening call.
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  contact: string;
  summary: string;
  roles: Role[];
  skills: string;
  education: string[];
}

const PROFILES: Profile[] = [
  {
    file: "ananya-iyer.docx",
    name: "Ananya Iyer",
    contact: "ananya.iyer@example.com | +91 90000 10001 | Chennai",
    summary: "Frontend engineer focused on accessible, high-performance React applications for consumer products.",
    roles: [
      { title: "Software Engineer II", company: "Brightleaf Commerce Pvt Ltd", dates: "Apr 2022 - Present", bullets: ["Own the checkout UI used by 2 million monthly users.", "Cut Largest Contentful Paint from 4.1 s to 1.9 s."] },
      { title: "Software Engineer", company: "Pixelgrove Labs", dates: "Jul 2020 - Mar 2022", bullets: ["Built a shared React component library with Storybook."] },
    ],
    skills: "React, TypeScript, Next.js, Tailwind CSS, Jest, Accessibility (WCAG)",
    education: ["B.E. in Computer Science - Fictional College of Engineering, Chennai, 2020"],
  },
  {
    file: "vikram-singh.docx",
    name: "Vikram Singh",
    contact: "vikram.singh@example.com | +91 90000 10002 | Gurugram",
    summary: "Backend engineer with 9 years building payment and ledger systems in Java and Go.",
    roles: [
      { title: "Staff Engineer", company: "Kestrel Payments Pvt Ltd", dates: "Feb 2021 - Present", bullets: ["Designed a double-entry ledger processing 30,000 transactions per second.", "Mentor 6 engineers across two teams."] },
      { title: "Senior Software Engineer", company: "Copperline Fintech", dates: "Aug 2017 - Jan 2021", bullets: ["Migrated a monolith to Go microservices on Kubernetes."] },
      { title: "Software Engineer", company: "Tessera Systems", dates: "Jun 2015 - Jul 2017", bullets: ["Built Java Spring Boot APIs for loan origination."] },
    ],
    skills: "Go, Java, Spring Boot, Kafka, PostgreSQL, Kubernetes, gRPC",
    education: ["B.Tech in Information Technology - Example Institute of Technology, Delhi, 2015"],
  },
  {
    file: "meera-nair.docx",
    name: "Meera Nair",
    contact: "meera.nair@example.com | +91 90000 10003 | Kochi",
    summary: "Data scientist building demand-forecasting and pricing models for retail and FMCG.",
    roles: [
      { title: "Senior Data Scientist", company: "Harvestline Retail Pvt Ltd", dates: "Jan 2022 - Present", bullets: ["Built SKU-level demand forecasts that reduced stockouts by 18%.", "Productionised models with MLflow and Airflow."] },
      { title: "Data Scientist", company: "Quantive Analytics", dates: "Jun 2019 - Dec 2021", bullets: ["Developed price-elasticity models for 40 product categories."] },
    ],
    skills: "Python, Pandas, Scikit-learn, XGBoost, SQL, MLflow, Airflow, Time-series forecasting",
    education: ["M.Sc. in Statistics - Fictional University of Kerala, 2019", "B.Sc. in Mathematics - Sample College, Kochi, 2017"],
  },
  {
    file: "arjun-mehta.docx",
    name: "Arjun Mehta",
    contact: "arjun.mehta@example.com | +91 90000 10004 | Mumbai",
    summary: "DevOps and platform engineer automating cloud infrastructure on AWS.",
    roles: [
      { title: "Senior DevOps Engineer", company: "Stratus Cloudworks Pvt Ltd", dates: "Mar 2021 - Present", bullets: ["Manage 120+ AWS accounts with Terraform and AWS Organizations.", "Reduced cloud spend by 27% through rightsizing and spot instances."] },
      { title: "DevOps Engineer", company: "Bluepeak Software", dates: "Jan 2018 - Feb 2021", bullets: ["Built GitHub Actions CI/CD pipelines for 40 services."] },
    ],
    skills: "AWS, Terraform, Kubernetes, Docker, GitHub Actions, Prometheus, Grafana, Bash",
    education: ["B.E. in Electronics - Example Engineering College, Pune, 2017"],
  },
  {
    file: "sneha-kulkarni.docx",
    name: "Sneha Kulkarni",
    contact: "sneha.kulkarni@example.com | +91 90000 10005 | Pune",
    summary: "QA automation engineer building reliable end-to-end and API test suites.",
    roles: [
      { title: "QA Automation Lead", company: "Northwind Health Tech", dates: "May 2022 - Present", bullets: ["Raised automated regression coverage from 35% to 85%.", "Lead a team of 3 QA engineers."] },
      { title: "QA Engineer", company: "Clearpath Infosystems", dates: "Jul 2018 - Apr 2022", bullets: ["Wrote Selenium and REST Assured suites for a hospital management product."] },
    ],
    skills: "Playwright, Selenium, Cypress, REST Assured, Java, TypeScript, JMeter",
    education: ["B.E. in Computer Engineering - Fictional Institute of Technology, Pune, 2018"],
  },
  {
    file: "rohan-das.docx",
    name: "Rohan Das",
    contact: "rohan.das@example.com | +91 90000 10006",
    summary: "Android developer shipping consumer apps in Kotlin and Jetpack Compose.",
    roles: [
      { title: "Android Developer", company: "Tangerine Mobility Pvt Ltd", dates: "Aug 2021 - Present", bullets: ["Rebuilt the rider app in Jetpack Compose; crash-free sessions rose to 99.6%."] },
      { title: "Junior Android Developer", company: "Appleseed Studios", dates: "Jun 2020 - Jul 2021", bullets: ["Implemented offline sync with Room and WorkManager."] },
    ],
    skills: "Kotlin, Jetpack Compose, Coroutines, Room, Retrofit, Firebase",
    education: ["B.Tech in Computer Science - Sample Institute of Technology, Kolkata, 2020"],
  },
  {
    file: "kavya-reddy.docx",
    name: "Kavya Reddy",
    contact: "kavya.reddy@example.com | +91 90000 10007 | Hyderabad",
    summary: "Product manager for B2B SaaS with an engineering background.",
    roles: [
      { title: "Senior Product Manager", company: "Ledgerly Software Pvt Ltd", dates: "Oct 2021 - Present", bullets: ["Own the invoicing product line; grew ARR by 45% in two years.", "Run quarterly roadmap planning with 4 engineering squads."] },
      { title: "Product Manager", company: "Fieldnote Technologies", dates: "Jan 2019 - Sep 2021", bullets: ["Launched a mobile field-sales app used by 8,000 reps."] },
      { title: "Software Engineer", company: "Fieldnote Technologies", dates: "Jul 2016 - Dec 2018", bullets: ["Built REST APIs in Python and Django."] },
    ],
    skills: "Product strategy, Roadmapping, SQL, Mixpanel, Jira, User research, A/B testing",
    education: ["MBA - Fictional School of Management, Hyderabad, 2019", "B.Tech in Computer Science - Example University, 2016"],
  },
  {
    file: "aditya-joshi.docx",
    name: "Aditya Joshi",
    contact: "aditya.joshi@example.com | +91 90000 10008 | Bengaluru",
    summary: "Machine learning engineer building LLM-powered search and retrieval systems.",
    roles: [
      { title: "ML Engineer", company: "Lexicon AI Labs", dates: "Jun 2023 - Present", bullets: ["Built a RAG pipeline over 2 million support documents.", "Cut LLM inference cost by 40% with caching and smaller models."] },
      { title: "Data Engineer", company: "Riverbank Analytics", dates: "Jul 2021 - May 2023", bullets: ["Built Spark ETL jobs feeding the company data lake."] },
    ],
    skills: "Python, PyTorch, LangChain, Vector databases, FastAPI, Spark, Docker",
    education: ["B.Tech in Computer Science - Example Institute of Technology, Bengaluru, 2021"],
  },
  {
    file: "fatima-khan.docx",
    name: "Fatima Khan",
    contact: "fatima.khan@example.com | +91 90000 10009 | Noida",
    summary: "UI/UX designer creating research-led design systems for web and mobile products.",
    roles: [
      { title: "Senior Product Designer", company: "Mosaic Interactive Pvt Ltd", dates: "Feb 2022 - Present", bullets: ["Created the company design system used across 5 products.", "Ran 60+ usability sessions to redesign onboarding."] },
      { title: "UI/UX Designer", company: "Brightside Digital", dates: "Aug 2019 - Jan 2022", bullets: ["Designed e-commerce apps for 12 retail clients."] },
    ],
    skills: "Figma, Design systems, User research, Prototyping, Usability testing, HTML/CSS",
    education: ["B.Des in Interaction Design - Fictional Institute of Design, 2019"],
  },
  {
    file: "siddharth-rao.docx",
    name: "Siddharth Rao",
    contact: "siddharth.rao@example.com | Bengaluru",
    summary: "Engineering manager who has led full-stack teams building logistics platforms.",
    roles: [
      { title: "Engineering Manager", company: "Cargoline Logistics Pvt Ltd", dates: "Jan 2020 - Present", bullets: ["Manage 3 teams (18 engineers) building route optimisation and fleet tracking.", "Hired 11 engineers and set up the on-call process."] },
      { title: "Tech Lead", company: "Swiftmile Technologies", dates: "Apr 2016 - Dec 2019", bullets: ["Led the Node.js and React rewrite of the shipment tracking portal."] },
      { title: "Software Engineer", company: "Swiftmile Technologies", dates: "Jul 2013 - Mar 2016", bullets: ["Built Java services for warehouse management."] },
    ],
    skills: "People management, System design, Node.js, React, Java, AWS, Agile delivery",
    education: ["B.E. in Computer Science - Sample College of Engineering, Mysuru, 2013"],
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
          heading("Professional Summary"),
          line(p.summary),
          heading("Experience"),
          ...p.roles.flatMap((r) => [
            new Paragraph({ children: [new TextRun({ text: `${r.title} - ${r.company}`, bold: true }), new TextRun(`   ${r.dates}`)] }),
            ...r.bullets.map(bullet),
          ]),
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
await mkdir(outDir, { recursive: true });

let failed = 0;
for (const p of PROFILES) {
  const filePath = path.join(outDir, p.file);
  await writeFile(filePath, await Packer.toBuffer(buildDoc(p)));
  if (!upload) {
    console.log(`Wrote ${filePath}`);
    continue;
  }
  const form = new FormData();
  form.append("resume", new Blob([await readFile(filePath)], { type: DOCX_MIME }), p.file);
  const res = await fetch(`${BASE_URL}/api/resume`, { method: "POST", body: form });
  const body: unknown = await res.json().catch(() => null);
  if (res.status === 201) {
    console.log(`✅ ${p.name} uploaded`);
  } else {
    failed++;
    console.log(`❌ ${p.name}: ${res.status} ${JSON.stringify(body)}`);
  }
}
console.log(upload ? `\nDone: ${PROFILES.length - failed} uploaded, ${failed} failed.` : "\nDone.");
if (failed > 0) process.exitCode = 1;
