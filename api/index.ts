// Vercel Function entry: every /api/* request is rewritten here (see vercel.json) and handled by the Express app.
// Candidate data is stored in Vercel Blob on Vercel (server/repository.ts picks it via the VERCEL env var).
import { createApp } from "../server/app.js";

export default createApp();
