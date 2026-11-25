// Makes an HR_USERS entry for the HR dashboard login.
//   npm run hr-user -- recruiter@company.com            (asks for the password)
//   npm run hr-user -- --secret                         (prints a new random AUTH_SECRET)
// Put entries in HR_USERS, comma-separated: HR_USERS=a@x.com:scrypt$...,b@x.com:scrypt$...
// The password itself is never stored, only its scrypt hash.
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { hashPassword } from "../server/auth.js";

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
      rl.question("Password (min 10 characters): ", (answer) => resolve(answer));
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
  const email = args[0]?.trim().toLowerCase();
  if (!email || !email.includes("@") || email.includes(":") || email.includes(",")) {
    console.error("Usage: npm run hr-user -- someone@company.com   |   npm run hr-user -- --secret");
    process.exit(1);
  }
  const password = await readPassword();
  if (password.length < 10) {
    console.error("Password must be at least 10 characters.");
    process.exit(1);
  }
  console.log(`${email}:${await hashPassword(password)}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
