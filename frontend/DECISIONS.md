# Frontend — Decision Log (Tradeoffs)

> Study material for the technical interview. Each entry captures a real tradeoff
> discussed during development: the question, the options, what we chose, why,
> and what to say when defending it.
> New entries get appended as decisions are made.

---

## 1. Micro-frontends via webpack Module Federation vs single React app
- **Tradeoff**: the assignment explicitly asks for micro front-ends with webpack; a single app is simpler but doesn't demonstrate the pattern.
- **Decision**: Host app + 2 remotes (requester, approver) with webpack Module Federation.
- **Why**: the domain splits naturally by user role / bounded context — the requester world (create/list/detail/PDF) and the approver world (OTP + decide) have different lifecycles. Each remote has its own build, tests (>=60%), and deploy.
- **Costs**: 3 builds instead of 1, more local-dev complexity, more config surface — overkill for the app size, justified by the requirement and by demonstrating the pattern.
- **Key mechanic**: `shared: { react: { singleton: true } }` — guarantees ONE React instance on the page (two Reacts would break the DOM).
- **Interview line**: "I split by bounded context (requester vs approver), not by technical layer. The shared state lives in the backend/DynamoDB — micro-apps never talk to each other directly; the magic link is the only cross-app contract."

## 2. React 18 vs 17
- **Tradeoff**: the assignment says "React v17+" — 17 or anything newer qualifies.
- **Decision**: React 18 (satisfies v17+).
- **Why**: current tooling support; no meaningful scope difference for this app; modern default.

## 3. webpack 5 (required) vs Vite
- **Tradeoff**: Vite is the modern DX winner, but the assignment explicitly requires webpack for the micro-front-end concept.
- **Decision**: webpack 5 + Module Federation.
- **Why**: spec compliance — Module Federation is a webpack feature; Vite has no equivalent first-class runtime composition story.
- **Interview line**: "webpack was non-negotiable here: Module Federation is the mechanism behind the micro-front-end requirement."

## 4. axios vs fetch
- **Tradeoff**: fetch is native; axios adds interceptors and cleaner error handling.
- **Decision**: axios (allowed by the assignment: "axios or fetch").
- **Why**: consistent error handling and interceptors (e.g., attaching the API base URL) with minimal cost.

## 5. Deploy: S3 + CloudFront vs Vercel/Netlify
- **Tradeoff**: AWS-native static hosting (S3 bucket + CloudFront CDN) vs a managed static host.
- **Decision**: S3 + CloudFront.
- **Why**: keeps the whole solution on AWS for a coherent story; still just static files. Vercel/Netlify would work identically for the frontend — the backend cannot go there (it must be AWS Lambda + API Gateway + DynamoDB).

## 6. Requester-panel UI stack: Tailwind v3 + shadcn copy, RHF+zod, zustand scope, English copy
- **Tradeoff (a) — Tailwind version with webpack 5 Module Federation**: v4 (CSS-first) vs v3.4 (classic config).
  - **Decision**: **Tailwind v3.4 + postcss-loader** (`tailwind.config.js` + `postcss.config.js`, style-loader/css-loader/postcss-loader chain in each app's webpack).
  - **Why**: v4's CSS-first `@tailwindcss/postcss` plugin changes the config surface and risks the green build we already have with webpack 5 + Module Federation + jest; v3.4 integrates cleanly with the existing rule chain and `identity-obj-proxy` jest mapping. Safe default, zero build churn.
  - **Interview line**: "I chose Tailwind v3.4 because v4's CSS-first plugin is a bigger integration risk with this webpack-5 MF + jest setup; v3.4 drops into the existing postcss-loader chain with zero churn."
- **Tradeoff (b) — shadcn/ui in a webpack monorepo**: run the shadcn CLI (Vite/Next-oriented) vs copy components manually per-remote.
  - **Decision**: **Manual copy per-remote**. `components.json` documents the setup; each remote copies the small set of needed components (Button, Input, Label, Card, Table, Select, Badge) into `src/components/ui/` over Tailwind + Radix primitives. No shadcn runtime dependency — it's source components.
  - **Why**: the CLI assumes Vite/Next paths and a single-app layout; this is a webpack monorepo where each remote owns its bundle. Copying keeps each remote self-contained and its build/test green.
  - **Costs/risks**: copied components can drift from upstream shadcn; mitigated by keeping the set small and pinned to the copied source. JSX ports (`.jsx`) of the TSX originals use relative `@/` alias (webpack + jest moduleNameMapper both resolve it).
- **Tradeoff (c) — form validation layer**: validate in the domain/backend only vs also at the UX boundary.
  - **Decision**: **React Hook Form + @hookform/resolvers/zod**, zod schema at the UX boundary (title/description/amount/requester/3 approvers) with English messages; `zodResolver` drives per-field errors; the requester != approvers and distinct-approvers constraints are enforced both in the form (options excluded/cleared + superRefine) and in the backend (source of truth, 400).
  - **Why**: fail-fast UX with the SAME constraints the backend enforces; server validation errors (400/404) are still surfaced via `toErrorView` (R5) — the API remains authoritative.
- **Tradeoff (d) — client state management**: zustand store vs lifting state / URL-only.
  - **Decision**: **zustand scoped to LOCAL UI state only** — a single `listRefreshSignal` counter bumped after a successful create so the list refetches (e.g., if it stayed mounted). NO business state (requests, users, detail) is duplicated from the API into the store; the backend is the source of truth and screens fetch on mount. Where the URL param already carries state (selected request id in `/requester/:id`), no store entry was added — the store holds only what the router can't express.
  - **Interview line**: "zustand here is one counter, not a state container — the router carries the selected id, the API is the source of truth, and the store just signals 'list data changed' across screens."
- **Tradeoff (e) — UI copy language**: any language vs English.
  - **Decision**: **English UI copy only** (labels, buttons, empty states, validation messages) — per the PR contract. No Spanish terms in host/requester source.
- **Tradeoff (f) — MF shared modules**: what crosses the host↔remote boundary.
  - **Decision**: share **react, react-dom, react-router-dom as singletons** in both host and requester webpack configs. `react-router-dom` MUST be shared so the requester's `<Routes>` render inside the host's `<BrowserRouter>` context (a second bundled copy would lose the router context). zod/zustand/axios/Radix are NOT shared — each remote bundles its own; sharing them would couple the remotes' versions for no runtime benefit (the host never imports them).
  - **Interview line**: "The router instance must be a singleton across the boundary — that's the one sharing decision that's load-bearing; everything else (zod, zustand, axios) is per-remote to avoid version coupling."

## 7. Folder architecture per remote (same convention for host, requester, approver)
- **Tradeoff**: every micro-front-end was organizing `src/` differently (host flat, requester `screens/`, approver bare), so finding a file and knowing where new code goes required per-app tribal knowledge.
- **Decision**: **one convention, applied identically to every remote**, and only the folders an app actually uses exist:
  - `app/` — wiring: `index.js`, `bootstrap.js`, `App.jsx` (router), `globals.css`, `setupTests.js`, `App.*` tests.
  - `api/` — service layer (`client.js`, `<domain>.js`, `mappers.js`), tests colocated.
  - `components/` — FEATURE (domain-aware) components like `StatusBadge`; tests colocated.
  - `components/ui/` — shadcn design-system primitives (button, input, card, table, select, badge); agnostic, NO dedicated tests (covered via feature tests).
  - `hooks/` — custom hooks, tests colocated (populated from PR #7 for the approver).
  - `lib/` — pure utils (`cn`, formatters), tests colocated.
  - `pages/` — route-level views (`*Page.jsx`); replaces the old `screens/` naming; tests colocated.
  - `routes/` — path constants + link builders (`paths.js`), tests colocated if logic.
  - `store/` — zustand stores (scoped UI state), tests colocated.
- **Why**: consistent mental model across remotes; tests ALWAYS live next to the file they test (nothing loose at `src/` root); the `components/` vs `components/ui/` split keeps the feature layer clearly separated from the agnostic design system so the two never blur.
- **Costs/risks**: a folder-structure PR is pure MOVES + import-path/config updates — reviewer signal is in the renames (git `-M` stat), not in rewritten logic; webpack Module Federation wiring (entry + exposes) and jest `collectCoverageFrom`/`setupFilesAfterEnv` paths had to be updated in lockstep so builds, coverage thresholds, and the composed remote graph keep working.
- **Interview line**: "I standardized the folder layout per remote — app wiring, api, feature components vs agnostic ui primitives, hooks, lib, pages, routes, store — with colocated tests everywhere, so a new remote (the approver) follows the exact same map its sibling already proves."

## 8. Approver flow: HTTP-code-driven state machine + zustand flow store, folder convention applied

> **Numbering note (PR #8 reconciliation)**: the frontend entries are numbered
> in file sequence, not by PR number — #6 = requester panel (PR #6), #7 = folder
> convention (the pre-#7 refactor PR), #8 = approver flow (PR #7). This is
> deliberate: the folder-convention refactor landed between the two PRs and took
> #7, so the approver entry reads #8. No duplicate numbers exist.

- **Tradeoff (a) — what drives the flow**: client-side route per step (`/approve/otp`, `/approve/decision`, ...) vs a single `/approve` entry + in-app state machine.
  - **Decision**: **one `/approve` entry** (design-api link form `https://<host>/approve?request_id=<id>&approver_token=<uuid>`) that reads the query params and renders the flow step from a zustand flow store. The state machine is **driven by the backend's error→HTTP policy** (design-api): gate 410→completed/already-rejected, 403→lockout, 404→invalid link, 409→already signed/rejected, 401→wrong-OTP countdown, plus a `410 ExpiredOtpError` name check that means "generate a new OTP" (R2) instead of terminal.
  - **Why**: the URL must stay the mailed link (query params are the only contract), so sub-routes would need to re-carry or rewrite the params; a store keeps the params + phase in one place and the terminal gate truly dominates every transition (a reload of the same link lands on the same terminal screen, R4). The single classifier `terminalVariantFromError(status, error, message)` lives in `lib/flow.js` (pure, unit-tested) and every hook/page uses it — one mapping, no drift.
  - **Costs**: the terminal-variant classifier reads the backend's stable English `message` to distinguish already-signed vs already-rejected (409) and COMPLETED vs REJECTED (410); acceptable because those strings are the domain errors' constants, and the alternative (a dedicated status field) would be a backend contract change.
- **Tradeoff (b) — what lives in the zustand store**: duplicate the request detail / flow data vs scoped UI state only.
  - **Decision**: the store holds ONLY `requestId` + `approverToken` (from the URL, carried for API calls), the `phase` (gate/otp/decision/terminal), `terminalVariant`, `attemptsRemaining` and `expiresInSeconds`. The request detail is fetched by the decision page and kept in its local state (same as the requester detail screen).
  - **Why**: consistent with DECISIONS #6(d) — the backend is the source of truth; the store is the flow machine, not a data cache. `attemptsRemaining`/`expiresInSeconds` are pure R2 UI signals.
- **Tradeoff (c) — approve-without-name**: ask for a typed name on approve vs use the registered snapshot.
  - **Decision**: **no name input anywhere** (spec R3). The signature use case records the registered snapshot name (backend PR #4). The decision card says "Approving records the name registered for your account" so the demo reviewer understands the choice.
  - **Why**: the spec is explicit and the backend contract (#10 has no request body) makes a name field dead UI. The regression lives in tests (`queryByLabelText(/name/i)` absent + the approve call has no body).
- **Tradeoff (d) — reject confirmation UX**: modal vs inline confirm.
  - **Decision**: inline confirmation panel (role="alertdialog") inside `DecisionButtons` — "Reject" reveals "Yes, reject" / "Cancel"; the `{ confirm: true }` POST fires only after confirm.
  - **Why**: endpoint #11 requires the flag, so the UI must gate it; inline avoids a Radix-dialog dependency (keeps the copied ui set small) and is trivially testable.
- **Tradeoff (e) — standalone vs composed routing**: the remote must serve its own dev server (`:3002/approve?request_id=..`) AND the host's `/approve/*` mount.
  - **Decision**: `routes/paths.js` declares BOTH `/approve` and `/` → the same landing page; bootstrap mounts BrowserRouter (needed for useSearchParams standalone) and webpack shares react-router-dom as a singleton (DECISIONS #6(f) — the router instance is load-bearing); devServer gains `historyApiFallback: true` so the deep link works on :3002.
  - **Why**: under the host splat `/approve/*`, react-router strips the prefix and the nested `/` matches; standalone the literal `/approve` matches. Same code path, both modes.
- **Tradeoff (f) — terminal screens as one component**: a TerminalPage per variant vs one page + copy map.
  - **Decision**: one `TerminalPage` with a variant→copy map (`TERMINAL_COPY`) + a dedicated `OtpLockedOutPage` (the lockout has its own visual identity). No actions render on any terminal screen (R4 asserted in tests).
  - **Why**: the six terminal variants (completed, already-signed, already-rejected, invalid-link, approved, rejected) share structure; a copy map keeps them declarative.
- **Folder convention**: PR #7 populated the approver remote exactly per DECISIONS #7 — `api/` (client + approvals + mappers), `components/` (OtpInput, DecisionButtons), `components/ui/` (shadcn copy: button, input, card, badge, label), `hooks/` (useResolveApproval, useValidateOtp, useApprove, useReject), `lib/` (utils cn + flow classifier), `pages/` (ApprovalLandingPage, OtpEntryPage, OtpLockedOutPage, ApprovalDecisionPage, TerminalPage), `routes/` (paths + link builder), `store/` (useApprovalFlowStore), all tests colocated; the CSS-ships-through-exposed-graph invariant (App.cssGraph.test) is enforced for the approver too.
- **Interview line**: "The approver flow is one gate-driven state machine: every screen transition comes from an HTTP code or error name, mapped by a single pure classifier, and the zustand store holds only flow state — the URL carries the link, the API carries the data, the UI just renders the current step."

