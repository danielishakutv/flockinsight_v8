import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Database-backed checks, kept out of `pnpm test` on purpose.
 *
 * These need a live Postgres with at least one church in it, which a fresh
 * clone and CI do not have. Run them with `pnpm test:db` after `pnpm db:migrate`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.db-check.ts"],
    setupFiles: ["./src/test/db-env.ts"],
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
