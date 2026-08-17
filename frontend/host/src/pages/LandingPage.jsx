import { Link } from 'react-router-dom';

/**
 * Demo hub (landing `/`) — the entry point of the local demo. Two big cards
 * route to the requester panel and the approver console; a tips strip keeps
 * the demo's moving parts (seed cast, inbox, ports) one glance away.
 */
const DEMO_TIPS = [
  {
    label: 'How to run the demo',
    detail:
      'Seed the 4 users (pnpm -C backend run db:seed), then create a request in the ' +
      '/requester panel, open its approval link from /mock-mail, enter the OTP, approve ×3, ' +
      'and Download PDF from the completed request.',
  },
  {
    label: 'Demo inbox',
    detail: 'Approval links + OTP codes: http://localhost:4000/dev/mock-mail',
  },
  {
    label: 'Ports',
    detail: 'Host :3000 · Requester :3001 · Approver :3002 · Backend :4000',
  },
];

const CARD_BASE =
  'group rounded-lg border bg-card p-6 shadow-sm transition hover:border-primary/40 hover:shadow-md';

export default function Landing() {
  return (
    <div className="mx-auto max-w-3xl space-y-10 py-4">
      <section className="text-center">
        <h1 className="text-3xl font-semibold">Purchase Approvals — Demo Hub</h1>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
          Consent-signature MVP: a requester creates a purchase request, each
          approver signs through a unique OTP-gated link, and the completed
          request ships an evidence PDF.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Link to="/requester" className={CARD_BASE}>
          <h2 className="text-xl font-semibold">Requester panel</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Create purchase requests, track status, and download the evidence
            PDF once all three approvers sign.
          </p>
          <span className="mt-4 inline-block text-sm font-medium text-primary group-hover:underline">
            Open requester panel →
          </span>
        </Link>

        <Link to="/demo" className={CARD_BASE}>
          <h2 className="text-xl font-semibold">Approver console</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            See every request, drill into its approvers, and jump straight into
            each approver's real OTP approval flow.
          </p>
          <span className="mt-4 inline-block text-sm font-medium text-primary group-hover:underline">
            Open approver console →
          </span>
        </Link>
      </section>

      <section className="rounded-lg border bg-card p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Demo tips
        </h2>
        <ul className="mt-3 divide-y">
          {DEMO_TIPS.map((tip) => (
            <li key={tip.label} className="flex gap-4 py-2 text-sm">
              <span className="w-44 shrink-0 font-medium">{tip.label}</span>
              <span className="text-muted-foreground">{tip.detail}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
