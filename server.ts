import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { createServer as createViteServer } from "vite";
import type { ApiErrorBody } from "./shared/types.js";
import { AppError } from "./server/errors.js";
import { candidatesRouter } from "./server/routes/candidates.js";
import { exportRouter } from "./server/routes/export.js";
import { resumeRouter } from "./server/routes/resume.js";

const REQUIRED_ENV_VARS = ["GEMINI_API_KEY", "VITE_VAPI_PUBLIC_KEY", "VITE_VAPI_ASSISTANT_ID"] as const;

for (const name of REQUIRED_ENV_VARS) {
  if (!process.env[name]) {
    console.warn(`[warn] Missing env var ${name}. Add it to .env (see .env.example).`);
  }
}

async function main(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ ok: true, geminiConfigured: Boolean(process.env.GEMINI_API_KEY) });
  });

  app.use("/api/candidates", candidatesRouter);
  app.use("/api/resume", resumeRouter);
  app.use("/api", exportRouter);

  app.use("/api", (_req: Request, res: Response<ApiErrorBody>) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use((err: unknown, _req: Request, res: Response<ApiErrorBody>, next: NextFunction) => {
    if (res.headersSent) {
      console.error(err instanceof Error ? err.stack : err);
      next(err);
      return;
    }
    if (err instanceof AppError) {
      if (err.status >= 500) console.error(err.stack);
      const body: ApiErrorBody = { error: err.message };
      if (err.code !== undefined) body.code = err.code;
      res.status(err.status).json(body);
      return;
    }
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: "File is larger than 5 MB.", code: err.code });
      } else {
        res.status(400).json({ error: err.message, code: err.code });
      }
      return;
    }
    // Client errors raised by Express's own body parser (e.g. malformed JSON, payload too large).
    if (
      err instanceof Error &&
      "expose" in err &&
      err.expose === true &&
      "status" in err &&
      typeof err.status === "number" &&
      err.status >= 400 &&
      err.status < 500
    ) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error(err instanceof Error ? err.stack : err);
    res.status(500).json({ error: "Internal server error" });
  });

  const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
