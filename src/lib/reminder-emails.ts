import "server-only";
import { emailLayout } from "@/lib/mailer";

const BASE_URL = process.env.BETTER_AUTH_URL || "https://flockinsight.com";

function firstName(name: string) {
  return (name || "there").split(" ")[0];
}

/** 1) Owner hasn't logged in for a few days. */
export function reLoginEmail(name: string, churchName: string) {
  return {
    subject: `We miss you at ${churchName} 👋`,
    html: emailLayout(
      "It's been a few days",
      `<p>Hi ${firstName(name)},</p>
       <p>We noticed you haven't logged in to FlockInsight for a little while. Your dashboard for <strong>${churchName}</strong> is ready whenever you are — attendance, giving and member insights at a glance.</p>`,
      { label: "Open your dashboard", url: `${BASE_URL}/dashboard` },
    ),
    text: `Hi ${firstName(name)}, it's been a few days since you logged in to FlockInsight for ${churchName}. Open your dashboard: ${BASE_URL}/dashboard`,
  };
}

/** 2) No attendance recorded after the weekend. */
export function weekendRecordEmail(name: string, churchName: string) {
  return {
    subject: `Record this weekend's service for ${churchName}`,
    html: emailLayout(
      "Don't forget to record attendance",
      `<p>Hi ${firstName(name)},</p>
       <p>It looks like <strong>${churchName}</strong> hasn't recorded attendance for this past weekend yet. Capture it now while it's fresh — it only takes a few taps.</p>`,
      { label: "Record attendance", url: `${BASE_URL}/attendance/record` },
    ),
    text: `Hi ${firstName(name)}, ${churchName} hasn't recorded this weekend's attendance yet. Record it: ${BASE_URL}/attendance/record`,
  };
}

/** 3) No activity at all for about a week. */
export function inactiveWeekEmail(name: string, churchName: string) {
  return {
    subject: `${churchName} has been quiet this week`,
    html: emailLayout(
      "Let's pick things back up",
      `<p>Hi ${firstName(name)},</p>
       <p>There hasn't been any activity for <strong>${churchName}</strong> in about a week — no attendance, giving or new members recorded. Keeping your records current helps you see your church's growth clearly.</p>
       <p>Jump back in whenever you're ready.</p>`,
      { label: "Go to FlockInsight", url: `${BASE_URL}/dashboard` },
    ),
    text: `Hi ${firstName(name)}, there's been no activity for ${churchName} in about a week. Jump back in: ${BASE_URL}/dashboard`,
  };
}
