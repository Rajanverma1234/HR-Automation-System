// Local development: `npm run dev` serves the API and the React app (Vite in middleware mode) on one port.
// On Vercel the same API runs from api/index.ts and the built app (`npm run build` → dist/) is served statically.
import "dotenv/config";
import { createServer as createViteServer } from "vite";
import { createApp } from "./server/app.js";

const REQUIRED_ENV_VARS = ["GEMINI_API_KEY", "VITE_VAPI_PUBLIC_KEY", "VITE_VAPI_ASSISTANT_ID"] as const;

for (const name of REQUIRED_ENV_VARS) {
  if (!process.env[name]) {
    console.warn(`[warn] Missing env var ${name}. Add it to .env (see .env.example).`);
  }
}

async function main(): Promise<void> {
  const app = createApp();
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
