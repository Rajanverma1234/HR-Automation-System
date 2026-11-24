import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import { createServer as createViteServer } from "vite";

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

  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    console.error(err instanceof Error ? err.stack : err);
    if (res.headersSent) {
      next(err);
      return;
    }
    const status =
      typeof err === "object" && err !== null && "status" in err && typeof err.status === "number"
        ? err.status
        : 500;
    const message = status < 500 && err instanceof Error ? err.message : "Internal server error";
    res.status(status).json({ error: message });
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
