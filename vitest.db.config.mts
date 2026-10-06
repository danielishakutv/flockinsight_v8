import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Database-backed checks, kept out of `pnpm test` on purpose.
 *
 * These need a live Postgres with at least one church in it, which a fresh
 * clone and CI do not have. Run them with `pnpm test:db` after `pnpm db:migrate`.
 */

/*
 * The same version next.config.ts inlines into the app. `src/lib/version.ts`
 * refuses to load without it, deliberately — a version that can be absent is
 * how it came to be three releases stale in the first place.
 */
const APP_VERSION: string = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
).version;

export default defineConfig({
  test: {
    env: { NEXT_PUBLIC_APP_VERSION: APP_VERSION },
    environment: "node",
    include: ["src/**/*.db-check.ts"],
    setupFiles: ["./src/test/db-env.ts"],
    // One database, shared by every file here — running them at the same time
    // means one file's fixtures land in another file's counts.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "server-only": path.resolve(
        import.meta.dirname,
        "./src/test/server-only-stub.ts",
      ),
    },
  },
});
