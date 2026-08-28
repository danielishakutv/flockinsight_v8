/**
 * Stand-in for the `server-only` package under Vitest.
 *
 * The real package has no plain-Node entry point — it exists to make a client
 * bundle fail loudly — so importing a server module in a test throws before a
 * single assertion runs. Aliased in `vitest.config.mts`.
 */
export {};
