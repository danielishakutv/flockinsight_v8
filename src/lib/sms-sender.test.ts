import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  countEnvKey,
  platformSenderId,
  readEnvKey,
  senderIdDiagnostics,
} from "@/lib/sms-sender";

describe("readEnvKey", () => {
  it("reads a plain assignment", () => {
    expect(readEnvKey("TERMII_SENDER_ID=FlockInsight", "TERMII_SENDER_ID")).toBe(
      "FlockInsight",
    );
  });

  it("ignores a key that merely starts the same way", () => {
    // TERMII_SENDER_ID_OLD must not be mistaken for the real one.
    const text = "TERMII_SENDER_ID_OLD=TEDxYola\nTERMII_SENDER_ID=FlockInsight";
    expect(readEnvKey(text, "TERMII_SENDER_ID")).toBe("FlockInsight");
  });

  it("takes the LAST assignment, the way dotenv does", () => {
    // Appending the new value under the old one is the obvious way to change
    // it, so it has to behave the way it looks.
    const text = "TERMII_SENDER_ID=TEDxYola\nTERMII_SENDER_ID=FlockInsight";
    expect(readEnvKey(text, "TERMII_SENDER_ID")).toBe("FlockInsight");
  });

  it("strips double and single quotes", () => {
    expect(readEnvKey('TERMII_SENDER_ID="FlockInsight"', "TERMII_SENDER_ID")).toBe(
      "FlockInsight",
    );
    expect(readEnvKey("TERMII_SENDER_ID='FlockInsight'", "TERMII_SENDER_ID")).toBe(
      "FlockInsight",
    );
  });

  it("drops a trailing comment but keeps an inner hash", () => {
    expect(
      readEnvKey("TERMII_SENDER_ID=FlockInsight # approved", "TERMII_SENDER_ID"),
    ).toBe("FlockInsight");
    expect(readEnvKey('TERMII_SENDER_ID="Grace#1"', "TERMII_SENDER_ID")).toBe(
      "Grace#1",
    );
  });

  it("accepts an exported assignment", () => {
    expect(
      readEnvKey("export TERMII_SENDER_ID=FlockInsight", "TERMII_SENDER_ID"),
    ).toBe("FlockInsight");
  });

  it("skips a commented-out line", () => {
    const text = "# TERMII_SENDER_ID=TEDxYola\nTERMII_SENDER_ID=FlockInsight";
    expect(readEnvKey(text, "TERMII_SENDER_ID")).toBe("FlockInsight");
  });

  it("treats an empty value as unset rather than as an empty sender", () => {
    expect(readEnvKey("TERMII_SENDER_ID=", "TERMII_SENDER_ID")).toBeNull();
    expect(readEnvKey('TERMII_SENDER_ID=""', "TERMII_SENDER_ID")).toBeNull();
  });

  it("returns null when the key is absent", () => {
    expect(readEnvKey("TERMII_API_KEY=abc", "TERMII_SENDER_ID")).toBeNull();
  });

  it("copes with CRLF line endings", () => {
    expect(
      readEnvKey("TERMII_API_KEY=abc\r\nTERMII_SENDER_ID=FlockInsight\r\n", "TERMII_SENDER_ID"),
    ).toBe("FlockInsight");
  });
});

describe("countEnvKey", () => {
  it("counts a single assignment", () => {
    expect(countEnvKey("TERMII_SENDER_ID=A", "TERMII_SENDER_ID")).toBe(1);
  });

  it("notices a duplicate, which is how the old value survives an edit", () => {
    expect(
      countEnvKey("TERMII_SENDER_ID=A\nOTHER=1\nTERMII_SENDER_ID=B", "TERMII_SENDER_ID"),
    ).toBe(2);
  });

  it("does not count a commented-out line", () => {
    expect(
      countEnvKey("# TERMII_SENDER_ID=A\nTERMII_SENDER_ID=B", "TERMII_SENDER_ID"),
    ).toBe(1);
  });

  it("does not count a similarly named key", () => {
    expect(
      countEnvKey("TERMII_SENDER_ID_OLD=A\nTERMII_SENDER_ID=B", "TERMII_SENDER_ID"),
    ).toBe(1);
  });
});

describe("senderIdDiagnostics", () => {
  const cwd = process.cwd();
  const before = process.env.TERMII_SENDER_ID;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fi-sender-"));
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(cwd);
    if (before === undefined) delete process.env.TERMII_SENDER_ID;
    else process.env.TERMII_SENDER_ID = before;
  });

  function envFile(text: string) {
    writeFileSync(join(dir, ".env"), text, "utf8");
  }

  it("is quiet when the process and the file agree", () => {
    envFile("TERMII_SENDER_ID=FlockInsight");
    process.env.TERMII_SENDER_ID = "FlockInsight";
    const d = senderIdDiagnostics();
    expect(d.effective).toBe("FlockInsight");
    expect(d.inFile).toBe("FlockInsight");
    expect(d.drifted).toBe(false);
    expect(d.duplicated).toBe(false);
  });

  it("catches the case that started this: file edited, process still stale", () => {
    envFile("TERMII_SENDER_ID=FlockInsight");
    process.env.TERMII_SENDER_ID = "TEDxYola";
    const d = senderIdDiagnostics();
    expect(d.drifted).toBe(true);
    expect(d.inFile).toBe("FlockInsight");
    expect(d.effective).toBe("TEDxYola");
  });

  it("flags a duplicated key even when the value matches", () => {
    envFile("TERMII_SENDER_ID=TEDxYola\nTERMII_SENDER_ID=FlockInsight");
    process.env.TERMII_SENDER_ID = "FlockInsight";
    const d = senderIdDiagnostics();
    expect(d.drifted).toBe(false);
    expect(d.duplicated).toBe(true);
  });

  it("claims no drift when there is no readable .env to compare against", () => {
    process.env.TERMII_SENDER_ID = "FlockInsight";
    const d = senderIdDiagnostics();
    expect(d.inFile).toBeNull();
    expect(d.drifted).toBe(false);
  });

  it("does not call it drift when the process simply has nothing set", () => {
    // Unset is a different problem with a different fix; saying "drift" here
    // would send someone to --update-env when the value was never there.
    envFile("TERMII_SENDER_ID=FlockInsight");
    delete process.env.TERMII_SENDER_ID;
    const d = senderIdDiagnostics();
    expect(d.effective).toBeNull();
    expect(d.drifted).toBe(false);
  });

  it("treats a whitespace-only process value as unset", () => {
    process.env.TERMII_SENDER_ID = "   ";
    expect(platformSenderId()).toBeNull();
  });
});
