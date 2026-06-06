import { LegalPage } from "@/components/legal-page";

export const metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="June 2026">
      <p>
        This Policy explains how FlockInsight, operated by Toko Technologies,
        handles data. Please review and customize with your legal counsel before
        public launch.
      </p>

      <h2>1. Information we collect</h2>
      <ul>
        <li>Account info: your name, email, and church details.</li>
        <li>
          Church data you enter: congregation members, services, and attendance
          records.
        </li>
        <li>Technical data: log/usage data needed to operate the Service.</li>
      </ul>

      <h2>2. How we use it</h2>
      <p>
        To provide and improve the Service, secure accounts, and provide support.
        We do not sell your data.
      </p>

      <h2>3. Data isolation</h2>
      <p>
        Each church&rsquo;s data is logically isolated. Staff only access their
        own church&rsquo;s data. Platform administrators may access data as needed
        to operate the Service and provide support.
      </p>

      <h2>4. Storage &amp; backups</h2>
      <p>
        Data is stored on our server infrastructure and backed up regularly,
        including encrypted off-site copies, to enable recovery.
      </p>

      <h2>5. Your rights</h2>
      <p>
        You may request access, correction, export, or deletion of your
        church&rsquo;s data by contacting us.
      </p>

      <h2>6. Retention</h2>
      <p>
        We retain data while your account is active and for a reasonable period
        afterward, unless you request deletion earlier.
      </p>
    </LegalPage>
  );
}
