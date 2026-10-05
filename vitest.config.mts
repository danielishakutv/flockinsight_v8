import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    /*
     * 20 seconds, not vitest's default 5.
     *
     * Several tests here do real work rather than mocking it — the report
     * catalog builds every one of its 31 datasets, and the QR sweep encodes
     * and analyses several hundred symbols. Alone they take two or three
     * seconds; run in parallel with each other on a loaded machine they went
     * past 5s and failed as timeouts, which reads as a broken assertion and
     * sends you looking in the wrong place.
     *
     * Still far short of a hang, so a genuinely stuck test is still caught.
     */
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      // `server-only` has no Node entry point — it is designed to blow up a
      // client bundle. Stubbing it lets a server module be unit-tested.
      "server-only": path.resolve(
        import.meta.dirname,
        "./src/test/server-only-stub.ts",
      ),
    },
  },
});
