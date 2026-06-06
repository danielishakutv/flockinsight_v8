// PM2 process config for FlockInsight (production).
// Edit `cwd` to the path where you cloned the repo on the VPS,
// and `PORT` to a free port (must match the Apache reverse proxy).
module.exports = {
  apps: [
    {
      name: "flockinsight",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3001",
      cwd: "/home/REPLACE_ME/apps/flockinsight",
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "600M",
      env: {
        NODE_ENV: "production",
        PORT: "3001",
      },
    },
  ],
};
