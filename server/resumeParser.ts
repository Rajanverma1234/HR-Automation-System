import { Type, type Part, type Schema } from "@google/genai";
import mammoth from "mammoth";
import type { Education, PreviousCompany, ResumeData } from "../shared/types.js";
import { AppError } from "./errors.js";
import { generateJson } from "./gemini.js";

const nullableString: Schema = { type: Type.STRING, nullable: true };

export const resumeSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    name: nullableString,
    email: nullableString,
    phone: nullableString,
    location: nullableString,
    currentCompany: nullableString,
    currentDesignation: nullableString,
    totalExperienceYears: { type: Type.NUMBER, nullable: true },
    skills: { type: Type.ARRAY, items: { type: Type.STRING } },
    education: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          degree: nullableString,
          institution: nullableString,
          year: nullableString,
        },
        required: ["degree", "institution", "year"],
      },
    },
    previousCompanies: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          company: { type: Type.STRING },
          designation: nullableString,
          duration: nullableString,
        },
        required: ["company", "designation", "duration"],
      },
    },
    summary: nullableString,
  },
  required: [
    "name",
    "email",
    "phone",
    "location",
    "currentCompany",
    "currentDesignation",
    "totalExperienceYears",
    "skills",
    "education",
    "previousCompanies",
    "summary",
  ],
  propertyOrdering: [
    "name",
    "email",
    "phone",
    "location",
    "currentCompany",
    "currentDesignation",
    "totalExperienceYears",
    "skills",
    "education",
    "previousCompanies",
    "summary",
  ],
};

export const systemInstruction = `You extract candidate details from a resume. Use ONLY information explicitly present in the document. If a field is not present, return null (or [] for lists). Never guess, infer or invent names, emails, phone numbers, companies, titles, dates or numbers.

Field rules:
- name, email, phone, location: copy exactly as written in the resume. location is the candidate's own city/region, not an employer's address. If absent, null.
- totalExperienceYears: use the total experience figure stated in the resume. If none is stated, compute it from the employment date ranges ONLY when every range has a clear start and end. Treat "Present" (or "Current", "Till date", "Now") as today's date, which is given in the prompt. Round to 1 decimal place. Otherwise return null.
- currentCompany / currentDesignation: the role marked present/current; if no role is marked that way, the clearly most recent role. If neither can be determined, null.
- previousCompanies: every employer EXCEPT the current role, most recent first. "company" is the employer name; "designation" is the job title; "duration" is the date range or length exactly as written. Use null for any part not written.
- education: each degree or qualification with its institution and year (year as written, e.g. "2018" or "2014 - 2018"). Use null for any part not written.
- skills: technical and professional skills explicitly listed or clearly named in the resume. Deduplicated, at most 30, most relevant first.
- summary: 2-3 neutral sentences describing the candidate, based only on the resume content. No opinions, no praise, no information not in the resume.
- Never fill a field with placeholder text such as "N/A", "Not mentioned" or "Unknown"; use null instead.
- If the document is not a resume or CV, return null for every scalar field and [] for every list.`;

function buildInstruction(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `Extract the candidate details from the resume below according to your rules. Today's date is ${today}.`;
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type UploadedResume = { buffer: Buffer; mimetype: string; originalname: string };

export async function parseResume(file: UploadedResume): Promise<ResumeData> {
  const isPdf = file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf");
  let parts: Part[];

  if (isPdf) {
    parts = [
      { inlineData: { mimeType: "application/pdf", data: file.buffer.toString("base64") } },
      { text: buildInstruction() },
    ];
  } else if (file.mimetype === DOCX_MIME || file.originalname.toLowerCase().endsWith(".docx")) {
    let text: string;
    try {
      ({ value: text } = await mammoth.extractRawText({ buffer: file.buffer }));
    } catch (err) {
      console.error("[resume] mammoth failed:", err instanceof Error ? err.stack : err);
      throw new AppError(422, "Could not read any text from this DOCX file.", "EMPTY_DOCUMENT");
    }
    text = text.trim();
    if (text.length < 50) {
      throw new AppError(422, "Could not read any text from this DOCX file.", "EMPTY_DOCUMENT");
    }
    parts = [{ text: `${buildInstruction()}\n\nRESUME TEXT:\n${text}` }];
  } else {
    throw new AppError(
      415,
      "Unsupported file type. Please upload a PDF or DOCX (old .doc files are not supported).",
      "UNSUPPORTED_FILE",
    );
  }

  const raw = await generateJson<unknown>({ parts, schema: resumeSchema, systemInstruction });
  const data = normalizeResumeData(raw);

  if (data.name === null && data.email === null && data.phone === null && data.skills.length === 0) {
    throw new AppError(422, "This file doesn't look like a resume. Please upload a candidate's CV.", "NOT_A_RESUME");
  }
  return data;
}

// ---------- normalisation ----------

const EMPTY_MARKERS = new Set(["", "n/a", "na", "null", "none", "not mentioned"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return EMPTY_MARKERS.has(trimmed.toLowerCase()) ? null : trimmed;
}

function cleanNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return n;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function normalizeResumeData(raw: unknown): ResumeData {
  const r = isRecord(raw) ? raw : {};

  const seenSkills = new Set<string>();
  const skills: string[] = [];
  for (const item of asArray(r.skills)) {
    const skill = cleanString(item);
    if (skill === null) continue;
    const key = skill.toLowerCase();
    if (seenSkills.has(key)) continue;
    seenSkills.add(key);
    skills.push(skill);
  }

  const education: Education[] = asArray(r.education)
    .filter(isRecord)
    .map((e) => ({
      degree: cleanString(e.degree),
      institution: cleanString(e.institution),
      year: cleanString(e.year),
    }))
    .filter((e) => e.degree !== null || e.institution !== null || e.year !== null);

  const previousCompanies: PreviousCompany[] = [];
  for (const c of asArray(r.previousCompanies).filter(isRecord)) {
    const company = cleanString(c.company);
    const designation = cleanString(c.designation);
    const duration = cleanString(c.duration);
    // `company` is a required string in the type; an entry without one carries no usable identity.
    if (company === null) continue;
    previousCompanies.push({ company, designation, duration });
  }

  return {
    name: cleanString(r.name),
    email: cleanString(r.email),
    phone: cleanString(r.phone),
    location: cleanString(r.location),
    currentCompany: cleanString(r.currentCompany),
    currentDesignation: cleanString(r.currentDesignation),
    totalExperienceYears: cleanNumber(r.totalExperienceYears),
    skills,
    education,
    previousCompanies,
    summary: cleanString(r.summary),
  };
}
