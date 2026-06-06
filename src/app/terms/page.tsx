import { LegalPage } from "@/components/legal-page";

export const metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="June 2026">
      <p>
        These Terms govern your use of FlockInsight (the &ldquo;Service&rdquo;),
        operated by Toko Technologies. By creating an account or using the
        Service, you agree to these Terms. Please review and customize this
        document with your legal counsel before public launch.
      </p>

      <h2>1. Accounts</h2>
      <p>
        You are responsible for your church account, the accuracy of the
        information you provide, and for keeping your login credentials secure.
        You are responsible for all activity under your account.
      </p>

      <h2>2. Acceptable use</h2>
      <ul>
        <li>Do not use the Service for unlawful purposes.</li>
        <li>Do not attempt to access other churches&rsquo; data.</li>
        <li>Do not disrupt or abuse the Service or its infrastructure.</li>
      </ul>

      <h2>3. Your data</h2>
      <p>
        You retain ownership of the data you enter (members, attendance, etc.).
        We process it to provide the Service. See our Privacy Policy for
        details. You can request export or deletion of your church&rsquo;s data.
      </p>

      <h2>4. Availability</h2>
      <p>
        We aim for high availability and maintain regular backups, but the
        Service is provided &ldquo;as is&rdquo; without warranties. We are not
        liable for indirect or consequential damages to the extent permitted by
        law.
      </p>

      <h2>5. Subscriptions</h2>
      <p>
        Paid plans, trials, and billing terms (where applicable) will be
        described at sign-up. You can cancel at any time.
      </p>

      <h2>6. Changes</h2>
      <p>
        We may update these Terms; material changes will be communicated. Continued
        use after changes constitutes acceptance.
      </p>
    </LegalPage>
  );
}
