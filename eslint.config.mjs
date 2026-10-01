import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  /*
   * Type-aware linting, for one rule.
   *
   * `no-floating-promises` cannot be done by reading syntax — it has to know
   * whether an expression is a Promise — so this builds a TypeScript program.
   * Measured on this repo: lint goes from 1m42s to 2m13s. Thirty seconds on top
   * of a baseline that was already slow, which is a cheaper trade than it
   * sounds, and it buys the one bug class nobody catches by eye: work started
   * and never waited for.
   *
   * It paid for itself on the run that introduced it. Nine findings: six were
   * deliberate fire-and-forget and now say so with `void`, and three were real
   * — a clipboard write followed by an unconditional "Copied" toast, twice on a
   * temporary password being handed to a person. Nobody had caught those in
   * review, and no test would have.
   *
   * `await`, `void`, `.catch()` and `.then(ok, fail)` all satisfy it. `void` is
   * how to say "deliberately not waiting", and it should carry a comment saying
   * why nothing is left to handle — usually that the callee catches internally.
   *
   * Scoped to src/ because that is the only hand-written TypeScript here. A
   * separate narrower tsconfig for linting, and a `lint:fast` that skipped this
   * rule, were both tried and both removed: the tsconfig made no measurable
   * difference, and skipping the rule saved 30s of a 2m run, which is not worth
   * a second config that can drift from this one.
   */
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
    },
  },

  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
