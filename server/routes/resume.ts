import path from "node:path";
import { Router, type Request, type Response } from "express";
import multer from "multer";
import type { Candidate } from "../../shared/types.js";
import { AppError } from "../errors.js";
import { candidateRepository } from "../repository.js";
import { parseResume } from "../resumeParser.js";

const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function unsupported(): AppError {
  return new AppError(
    415,
    "Unsupported file type. Please upload a PDF or DOCX (old .doc files are not supported).",
    "UNSUPPORTED_FILE",
  );
}

function isAcceptedType(originalname: string, mimetype: string): boolean {
  const ext = path.extname(originalname).toLowerCase();
  if (ext === ".pdf") return mimetype === PDF_MIME;
  if (ext === ".docx") return mimetype === DOCX_MIME || mimetype === "application/octet-stream";
  return false;
}

function hasValidMagicBytes(file: Express.Multer.File): boolean {
  const ext = path.extname(file.originalname).toLowerCase();
  const head = file.buffer.subarray(0, 4).toString("latin1");
  if (ext === ".pdf") return head.startsWith("%PDF");
  if (ext === ".docx") return head.startsWith("PK");
  return false;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (isAcceptedType(file.originalname, file.mimetype)) cb(null, true);
    else cb(unsupported());
  },
});

export const resumeRouter = Router();

resumeRouter.post("/", upload.single("resume"), async (req: Request, res: Response<Candidate>) => {
  const file = req.file;
  if (!file) throw new AppError(400, "No file uploaded. Use form field 'resume'.", "NO_FILE");
  if (!hasValidMagicBytes(file)) throw unsupported();

  const resumeData = await parseResume(file);
  const candidate = await candidateRepository.create({ resumeData, resumeFileName: file.originalname });
  res.status(201).json(candidate);
});
