// PM2 process config for FlockInsight (production).
//
// This file is meant to live at $APP_ROOT/shared/ecosystem.config.cjs on the
// server — deploy/setup-releases.sh puts it there. Paths are derived from its
// own location, so there is nothing to edit by hand.
//
// Cluster mode with two workers is what makes `pm2 reload` seamless: PM2 waits
// for a replacement worker to be listening before it retires the old one, so
// there is never a moment with no process on the port. In fork mode `reload`
// is just a restart, and Apache answers 502 for the few seconds Next takes to
// boot.
const path = require("node:path");
const fs = require("node:fs");

// shared/ecosystem.config.cjs → the app root is its parent.
const APP_ROOT = path.resolve(__dirname, "..");
const CURRENT = path.join(APP_ROOT, "current");

if (!fs.existsSync(CURRENT)) {
  throw new Error(
    `No release is linked at ${CURRENT}. Run deploy/setup-releases.sh first, ` +
      `and keep this file at $APP_ROOT/shared/ecosystem.config.cjs.`,
  );
}

const PORT = process.env.FLOCKINSIGHT_PORT || "3001";

module.exports = {
  apps: [
    {
      name: "flockinsight",
      // Left as the symlink on purpose: PM2 resolves it when it spawns a
      // worker, so a reload after the swap picks up the new release.
      cwd: CURRENT,
      script: "node_modules/next/dist/bin/next",
      args: `start -p ${PORT}`,
      interpreter: "node",
      exec_mode: "cluster",
      instances: 2,
      autorestart: true,
      max_memory_restart: "800M",
      // Next finishes in-flight requests and pending after() callbacks on
      // SIGTERM; the docs ask for a 10-30s drain, and PM2's default is 1.6s.
      kill_timeout: 30000,
      // A cold Next boot on a busy box can take a while — don't give up and
      // kill the old worker before the new one is listening.
      listen_timeout: 60000,
      env: {
        NODE_ENV: "production",
        PORT,
      },
    },
  ],
};
