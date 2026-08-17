import { Link } from 'react-router-dom';

/**
 * Demo hub (landing `/`) — the entry point of the local demo. Two big cards
 * route to the requester panel and the approver console; a tips strip keeps
 * the demo's moving parts (seed cast, inbox, ports) one glance away.
 */
const DEMO_TIPS = [
  {
    label: 'Demo cast',
    detail: 'Seed 4 demo employees with: pnpm -C backend run db:seed',
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

/**
 * Ready-made demo states created by `pnpm -C backend run db:seed-scenarios`
 * (drives the real API; every run adds a new set). Each row tells the user how
 * to explore one state from the hub.
 */
const DEMO_SCENARIOS = [
  {
    scenario: 'Full flow',
    howTo:
      'Seed, create a request, open its approval link from /mock-mail, enter the OTP, ' +
      'approve ×3, then Download PDF.',
  },
  {
    scenario: 'Rejected',
    howTo:
      'Open any approval link of the "Rejected demo" request — the gate shows the ' +
      'terminal screen.',
  },
  {
    scenario: 'Regenerated OTP',
    howTo:
      'In "Pending demo (OTP regenerated)" Ana has 2 OTP mails — use the LATEST code (only ' +
      'the newest is stored; an older one returns 401). The OTP expires after 180s: once ' +
      'expired, open the link and choose "Generate new OTP".',
  },
  {
    scenario: 'Completed + PDF',
    howTo:
      'The "Completed demo" request shows COMPLETED + Download PDF on its detail page.',
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
          Demo scenarios
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Seed ready-made demo states through the real backend API:
          <code className="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs">
            pnpm -C backend run db:seed-scenarios
          </code>
        </p>
        <table className="mt-3 w-full text-left text-sm">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="w-44 pb-2 pr-4 font-medium">Scenario</th>
              <th className="pb-2 font-medium">How to explore</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {DEMO_SCENARIOS.map((entry) => (
              <tr key={entry.scenario}>
                <td className="py-2 pr-4 align-top font-medium">{entry.scenario}</td>
                <td className="py-2 text-muted-foreground">{entry.howTo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border bg-card p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Demo tips
        </h2>
        <ul className="mt-3 divide-y">
          {DEMO_TIPS.map((tip) => (
            <li key={tip.label} className="flex gap-4 py-2 text-sm">
              <span className="w-28 shrink-0 font-medium">{tip.label}</span>
              <span className="text-muted-foreground">{tip.detail}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
