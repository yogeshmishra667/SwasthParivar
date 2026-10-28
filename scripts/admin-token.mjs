#!/usr/bin/env node
/**
 * Mint an admin access token for curl, through the real admin login:
 * email + password, then the 6-digit 2FA (TOTP) code.
 *
 * The shared `ADMIN_API_TOKEN` was removed when admin auth became
 * email + password + 2FA (admin M0-T5). Runbooks use this instead:
 *
 *   export ADMIN_JWT=$(node scripts/admin-token.mjs --api https://api.swasthparivar.com)
 *   curl -H "Authorization: Bearer $ADMIN_JWT" https://api.swasthparivar.com/admin/flags
 *
 * Prompts go to stderr and only the token goes to stdout, so `$(...)`
 * captures just the token. The password is never echoed and is never
 * read from the environment (it would end up in shell history). The
 * token lasts 15 minutes (ACCESS_TTL in admin-auth.service.ts): run the
 * script again when a call returns 401. Flag writes need the
 * super_admin or ops role.
 *
 * API base: --api <url>, else $SWASTH_API_URL, else http://localhost:4000.
 * Email: $ADMIN_EMAIL, else prompted.
 * Exit code: 0 with the token on stdout, 1 on any failure.
 */
import { createInterface } from "node:readline";
import { Writable } from "node:stream";

const apiFlag = process.argv.indexOf("--api");
const API = (
  (apiFlag > -1 ? process.argv[apiFlag + 1] : undefined) ??
  process.env.SWASTH_API_URL ??
  "http://localhost:4000"
).replace(/\/+$/, "");

// Echo typed input to stderr, except while `muted` (the password).
let muted = false;
const rl = createInterface({
  input: process.stdin,
  output: new Writable({
    write(chunk, encoding, done) {
      if (!muted) process.stderr.write(chunk, encoding);
      done();
    },
  }),
  terminal: Boolean(process.stdin.isTTY),
});
// The async iterator buffers lines, so piped input (tests, `printf … |`)
// isn't lost between prompts the way `rl.question` would lose it.
const lines = rl[Symbol.asyncIterator]();

const ask = async (prompt, { hidden = false } = {}) => {
  process.stderr.write(prompt);
  muted = hidden;
  const { value, done } = await lines.next();
  muted = false;
  if (hidden) process.stderr.write("\n");
  return done ? "" : value.trim();
};

const fail = (message) => {
  process.stderr.write(`admin-token: ${message}\n`);
  rl.close();
  process.exit(1);
};

// csurf guards every POST under /admin/auth: send back the `admin_csrf`
// cookie it set and echo its token in `x-csrf-token`.
const cookies = new Map();
let csrfToken = "";

const call = async (method, path, body) => {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        ...(cookies.size > 0
          ? { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    return fail(`cannot reach ${API} (${err.cause?.code ?? err.message})`);
  }
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    const { code = "", message = "" } = json?.error ?? {};
    return fail(`${method} ${path} → ${res.status} ${code} ${message}`.trim());
  }
  return json.data;
};

({ csrfToken } = await call("GET", "/admin/auth/csrf"));

const email = process.env.ADMIN_EMAIL?.trim() || (await ask("Admin email: "));
const password = await ask("Password: ", { hidden: true });
if (!email || !password) fail("email and password are required");

const login = await call("POST", "/admin/auth/login", { email, password });
if (login.stage === "totp_enrollment_required") {
  fail(
    "2FA isn't set up on this account yet. Sign in to the admin console once to enrol, then re-run.",
  );
}
if (login.stage !== "totp_required") fail(`unexpected login stage "${login.stage}"`);

const code = await ask("6-digit 2FA code: ");
const verified = await call("POST", "/admin/auth/totp/verify", {
  challengeToken: login.challengeToken,
  code,
});

rl.close();
process.stdout.write(`${verified.accessToken}\n`);
