/**
 * Loads .env for the database-backed checks.
 *
 * Vitest does not read .env the way Next does, and the app's db client needs
 * DATABASE_URL to be a real string before it opens a pool — without this the
 * connection fails with an opaque SASL error rather than a useful one.
 */
import "dotenv/config";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. These checks need a local Postgres — see DEPLOY.md.",
  );
}
