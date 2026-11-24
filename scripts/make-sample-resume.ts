// Generates samples/sample-resume.docx for a FICTIONAL candidate.
// Deliberately contains NO salary, notice period or preferred location.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

const heading = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 240 } });
const line = (text: string) => new Paragraph({ children: [new TextRun(text)] });
const bullet = (text: string) => new Paragraph({ text, bullet: { level: 0 } });
const role = (title: string, dates: string) =>
  new Paragraph({ children: [new TextRun({ text: title, bold: true }), new TextRun(`   ${dates}`)] });

const doc = new Document({
  creator: "hr-screening-agent sample generator",
  title: "Rahul Sharma - Resume (fictional)",
  sections: [
    {
      children: [
        new Paragraph({ text: "Rahul Sharma", heading: HeadingLevel.TITLE }),
        line("rahul.sharma@example.com | +91 98765 43210 | Bengaluru"),

        heading("Professional Summary"),
        line(
          "Software engineer experienced in building scalable web applications with React, TypeScript and Node.js on AWS. " +
            "Comfortable owning features end to end, from API design to deployment.",
        ),

        heading("Experience"),
        role("Senior Software Engineer - Nimbus Tech Pvt Ltd", "Jan 2021 - Present"),
        bullet("Lead a team of 4 engineers building a customer-facing order management platform."),
        bullet("Migrated REST services to GraphQL, reducing average page payload size by 40%."),
        bullet("Introduced Redis caching and Docker-based deployments on AWS ECS."),

        role("Software Engineer - Orbit Softworks Pvt Ltd", "Jul 2018 - Dec 2020"),
        bullet("Built React and TypeScript dashboards for internal analytics."),
        bullet("Designed PostgreSQL schemas and Node.js APIs for reporting services."),

        role("Associate Software Engineer - Lumen Digital Solutions", "Jun 2016 - Jun 2018"),
        bullet("Developed and maintained Node.js microservices and automated test suites."),

        heading("Skills"),
        line("React, TypeScript, Node.js, AWS, PostgreSQL, Docker, Redis, GraphQL"),

        heading("Education"),
        line("B.Tech in Computer Science - Fictional Institute of Engineering, 2016"),
      ],
    },
  ],
});

const outPath = path.resolve(process.cwd(), "samples", "sample-resume.docx");
await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, await Packer.toBuffer(doc));
console.log(`Wrote ${outPath}`);
