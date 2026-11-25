import express, { type Express, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import type { ApiErrorBody } from "../shared/types.js";
import { apiAccessGuard, authRouter } from "./auth.js";
import { AppError } from "./errors.js";
import { candidatesRouter } from "./routes/candidates.js";
import { exportRouter } from "./routes/export.js";
import { hrUsersRouter } from "./routes/hrUsers.js";
import { resumeRouter } from "./routes/resume.js";

/**
 * The API: routes, JSON 404 and the JSON error handler. Shared by local dev (server.ts, with Vite in
 * middleware mode in front of the SPA) and Vercel (api/index.ts, with the built SPA served statically).
 */
export function createApp(): Express {
  const app = express();
  // Behind Vercel's proxy: lets req.secure see HTTPS, so the session cookie gets the Secure flag.
  app.set("trust proxy", true);
  app.use(express.json({ limit: "2mb" }));

  // Deny by default: everything under /api needs an HR session except the public /apply routes.
  app.use(apiAccessGuard);

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ ok: true, geminiConfigured: Boolean(process.env.GEMINI_API_KEY) });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/hr-users", hrUsersRouter);
  app.use("/api/candidates", candidatesRouter);
  app.use("/api/resume", resumeRouter);
  app.use("/api", exportRouter);

  app.use("/api", (_req: Request, res: Response<ApiErrorBody>) => {
    res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
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
      const code = err.status === 413 ? "PAYLOAD_TOO_LARGE" : "INVALID_BODY";
      res.status(err.status).json({ error: err.message, code });
      return;
    }
    console.error(err instanceof Error ? err.stack : err);
    res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
  });

  return app;
}
