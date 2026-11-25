// Makes an HR_USERS entry: a super admin (owner) account for the HR dashboard login.
//   npm run hr-user -- nisha --name Nisha              (asks for the password)
//   npm run hr-user -- --secret                        (prints a new random AUTH_SECRET)
// Put entries in HR_USERS, comma-separated: HR_USERS=nisha:scrypt$...:Nisha,owner2@x.com:scrypt$...
// Recruiters are added by a super admin on the dashboard's Team page instead.
// The password itself is never stored, only its scrypt hash.
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { hashPassword, MIN_PASSWORD_LENGTH, normalizeUsername, USERNAME_RE } from "../server/auth.js";

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    // Piped input: `echo secret | npm run hr-user -- me@x.com`
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    return Buffer.concat(chunks).toString("utf8").split(/\r?\n/)[0] ?? "";
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  // Hide what is typed: print the prompt once, then swallow the echo.
  const out = process.stdout;
  const write = out.write.bind(out);
  let muted = false;
  out.write = ((chunk: string | Uint8Array, ...rest: never[]) => (muted ? true : write(chunk, ...rest))) as typeof out.write;
  try {
    return await new Promise<string>((resolve) => {
      rl.question(`Password (min ${MIN_PASSWORD_LENGTH} characters): `, (answer) => resolve(answer));
      muted = true;
    });
  } finally {
    out.write = write;
    rl.close();
    console.log();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--secret")) {
    console.log(`AUTH_SECRET=${randomBytes(32).toString("base64url")}`);
    return;
  }
  const nameAt = args.indexOf("--name");
  const name = nameAt >= 0 ? (args[nameAt + 1] ?? "").trim().replace(/\s+/g, " ") : "";
  const positional = args.filter((a, i) => !a.startsWith("--") && (nameAt < 0 || i !== nameAt + 1));
  const username = normalizeUsername(positional[0] ?? "");
  if (!USERNAME_RE.test(username) || /[,:]/.test(name)) {
    console.error('Usage: npm run hr-user -- <username or email> [--name "Display name"]   |   npm run hr-user -- --secret');
    process.exit(1);
  }
  const password = await readPassword();
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    process.exit(1);
  }
  console.log(`${username}:${await hashPassword(password)}${name ? `:${name}` : ""}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
