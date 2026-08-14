# Frontend — Decision Log (Tradeoffs)

> Study material for the technical interview. Each entry captures a real tradeoff
> discussed during development: the question, the options, what we chose, why,
> and what to say when defending it.
> New entries get appended as decisions are made.

---

## 1. Micro-frontends via webpack Module Federation vs single React app
- **Tradeoff**: the assignment explicitly asks for micro front-ends with webpack; a single app is simpler but doesn't demonstrate the pattern.
- **Decision**: Host app + 2 remotes (solicitante, aprobador) with webpack Module Federation.
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
