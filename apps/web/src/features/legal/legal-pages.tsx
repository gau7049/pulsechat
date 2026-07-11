import { Link } from 'react-router-dom';

/**
 * Legal pages (Requirement Scope §19). PLACEHOLDER COPY — clearly marked; the
 * project owner supplies and legally reviews the real text before launch
 * (Build Instructions §4).
 */
function LegalShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Link to="/" className="text-sm font-medium text-accent hover:text-accent-strong">
        ← PulseChat
      </Link>
      <h1 className="mt-4 text-2xl font-bold text-fg">{title}</h1>
      <div className="mt-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-fg">
        <strong>Placeholder document.</strong> This text is a scaffold only and has not been legally
        reviewed. Replace before public launch.
      </div>
      <div className="prose-sm mt-6 flex flex-col gap-4 text-sm leading-6 text-fg-muted">
        {children}
      </div>
    </main>
  );
}

export function TermsPage() {
  return (
    <LegalShell title="Terms of Service">
      <p>
        By creating a PulseChat account you agree to use the service lawfully and respectfully. You
        are responsible for the content you share. Accounts that abuse others or the platform may be
        warned, suspended, or removed following moderation review.
      </p>
      <p>
        PulseChat is a portfolio project provided as-is, without warranties or guarantees of
        availability. Content you post remains yours; you grant PulseChat the right to store and
        transmit it solely to operate the service.
      </p>
    </LegalShell>
  );
}

export function PrivacyPolicyPage() {
  return (
    <LegalShell title="Privacy Policy">
      <p>
        We collect the minimum needed to run the service: your account details, content you post,
        and technical logs. Private messages are encrypted at rest with keys derived on your devices
        — neither PulseChat operators nor administrators can read them.
      </p>
      <p>
        Losing your password with no recovery email means your encrypted message history cannot be
        recovered — this is a deliberate consequence of the encryption design.
      </p>
      <p>
        Analytics are aggregate-only and self-hosted. We never sell data. You can export your data
        or delete your account from Settings at any time.
      </p>
    </LegalShell>
  );
}
