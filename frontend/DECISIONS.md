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

