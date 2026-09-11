/**
 * Which sender ID is the platform actually sending from?
 *
 * Admin SMS has exactly one source for this — `TERMII_SENDER_ID` in the
 * environment — and `sendSms` reads it at call time, so changing .env and
 * restarting is all it should ever take. In practice it is not always all it
 * takes, because a value already present in the process environment wins over
 * the .env file: Next only fills in variables that are not set yet. PM2 keeps
 * the environment it was first started with, so a `pm2 restart` without
 * `--update-env` re-launches the app with the OLD sender ID and the edited
 * .env is quietly ignored. The symptom is the file saying one thing and every
 * message saying another, with nothing in the logs to explain it.
 *
 * So: report both, and say plainly when they disagree.
 */

import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Strip the quoting styles a .env file is written in. */
function unquote(raw: string): string {
  const v = raw.trim();
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0]) {
    return v.slice(1, -1);
  }
  // An unquoted value runs to the first ` #` comment.
  return v.split(/\s+#/)[0].trim();
}

/**
 * Read one key out of .env text.
 *
 * Last assignment wins, matching how dotenv parses a file — which matters,
 * because appending a new TERMII_SENDER_ID below an old one is the obvious
 * way to change it and needs to behave the way it looks.
 */
export function readEnvKey(text: string, key: string): string | null {
  let found: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (m && m[1] === key) found = unquote(m[2]);
  }
  return found && found.length > 0 ? found : null;
}

/** How many times a key is assigned — more than once is worth flagging. */
export function countEnvKey(text: string, key: string): number {
  let n = 0;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && m[1] === key) n++;
  }
  return n;
}

export type SenderIdDiagnostics = {
  /** What `sendSms` will actually put in the `from` field, right now. */
  effective: string | null;
  /** What the .env file on disk says, if it can be read. */
  inFile: string | null;
  /** True when the running process disagrees with the file. */
  drifted: boolean;
  /** True when the file assigns TERMII_SENDER_ID more than once. */
  duplicated: boolean;
};

/** The sender ID admin SMS will use for the next message. */
export function platformSenderId(): string | null {
  return process.env.TERMII_SENDER_ID?.trim() || null;
}

/**
 * Compare the live value against the file.
 *
 * Reads .env from the working directory, which in a release deploy is a
 * symlink to shared/.env — the same file the app was told to read. If it
 * cannot be read (permissions, or a host that injects env another way) we
 * report no file rather than inventing a mismatch.
 */
export function senderIdDiagnostics(): SenderIdDiagnostics {
  const effective = platformSenderId();
  let inFile: string | null = null;
  let duplicated = false;

  try {
    const text = readFileSync(join(process.cwd(), ".env"), "utf8");
    inFile = readEnvKey(text, "TERMII_SENDER_ID");
    duplicated = countEnvKey(text, "TERMII_SENDER_ID") > 1;
  } catch {
    // No readable .env here. Nothing to compare against.
  }

  return {
    effective,
    inFile,
    drifted: Boolean(inFile && effective && inFile !== effective),
    duplicated,
  };
}
