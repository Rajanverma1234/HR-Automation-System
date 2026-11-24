import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = path.dirname(fileURLToPath(import.meta.url)).replace(/\\/g, "/");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // A second dev server (e.g. the browser call test on another port) needs its own HMR WebSocket port.
    hmr: process.env.HMR_PORT ? { port: Number(process.env.HMR_PORT) } : undefined,
    fs: {
      // Vite serves any file under the project root. Keep runtime data and backend code out of the browser.
      // Setting `deny` replaces Vite's defaults, so they are repeated first.
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem}",
        "**/.git/**",
        `${root}/data/**`,
        `${root}/server/**`,
        `${root}/server.ts`,
        `${root}/scripts/**`,
      ],
    },
  },
});
