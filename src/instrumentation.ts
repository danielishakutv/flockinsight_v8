/**
 * Next's server start-up hook.
 *
 * Runs once per worker process, before the first request. The only thing here
 * is the in-app scheduler, which does nothing unless `IN_APP_CRON=true`.
 */
export async function register() {
  // Node only. The edge runtime has no database and no timers worth the name.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { startScheduler } = await import("@/lib/scheduler");
  startScheduler();
}
