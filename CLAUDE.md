# Invoicio — AI Invoice & Receipt Processing Platform

## Project Overview

Invoicio is a web-based platform that lets businesses submit invoices or receipts (PDF or image, any layout/quality) and get back structured, validated, categorized data — extracted by a multi-agent AI pipeline rather than a single prompt call.

This is a **portfolio project** built to demonstrate production-grade agentic AI engineering: multi-step agent orchestration, tool use, confidence-aware extraction, and human-in-the-loop review — wrapped in a real business workflow (approvals, audit trail, multi-tenancy). The invoicing domain is the proof case; the pipeline architecture is the actual point.

Positioning: this is an AI document-processing pipeline demonstrated on invoices/receipts — not a competitor to Expensify/Ramp/Dext. Don't over-invest in commercial-feature-parity; invest in the parts that show engineering judgment (agent design, failure handling, confidence scoring, review UX).

## Tech Stack

**Frontend**
- Next.js (App Router) + TypeScript
- Tailwind CSS
- shadcn/ui for all components (buttons, forms, dialogs, tables, etc.)
- Design language: **minimal and objective** — no decorative gradients/flourishes. Let data and states (confidence scores, approval status) carry the visual weight. Set up theme tokens (spacing, type scale, neutral palette) early in Phase 1 so every later screen stays consistent.
- Charting: Recharts or Tremor for the dashboard, styled to match the minimal system — legibility over decoration.

**Backend**
- NestJS (Node.js/TypeScript)
- PostgreSQL + Prisma ORM
- BullMQ + Redis for async job processing (extraction runs off the request/response cycle)
- JWT auth, role-based access (submitter / approver / admin), multi-tenant scoping on all queries (business/org level)

**Storage & Infra**
- **Local for now:** original files are stored on the local filesystem (`STORAGE_DIR`) and the database is a local PostgreSQL instance. Access files only through a storage service interface (save / read stream / delete by key) so S3 can be swapped in later without touching callers — never pass raw filesystem paths around or store them in the DB, store the storage key.
- Uploads go through the API (multipart) rather than presigned URLs while storage is local; validate type/size server-side before writing.
- Implemented as `StorageService` (abstract, inject this) → `LocalStorageService` in `apps/api/src/storage`. Keys look like `{businessId}/{uuid}.{ext}` and are validated against path traversal. Files land in `apps/api/storage/` (gitignored).
- Upload flow: browser XHR → Next route handler `app/api/documents/route.ts` (streams the body through, adds the bearer token; `/api/*` is excluded from `proxy.ts` because proxy buffers bodies) → `POST /documents`, one file per request. The API identifies file type from magic bytes (`detect-file-type.ts`), never the client Content-Type or extension; limit 10 MB; types PDF/JPG/PNG/HEIC. Upload rules are duplicated in `apps/api/src/documents/upload-rules.ts` and `apps/web/src/lib/upload-rules.ts` — change both.
- Exact re-uploads (same SHA-256 within a business) return the existing document with `duplicate: true` instead of storing a second copy. Virus scanning is not implemented; the hook point is marked in `DocumentsService.upload`.
- Deployment: frontend on Vercel, backend on Railway/Render/AWS (decide at Phase 6)

**AI**
- Claude API — vision + tool use, forced structured JSON output
- OCR pre-pass for scanned/low-quality images: Tesseract (free) or AWS Textract, fed as extra context into the extraction prompt

### UI system (apps/web)

- shadcn/ui on **Base UI** primitives (style `base-nova`), not Radix — compose triggers with the `render` prop (`<DialogTrigger render={<Button />}>`), not `asChild`. Add components with `npx shadcn@latest add <name>`.
- Tokens live in `src/app/globals.css`. Use the semantic type scale (`text-display` / `text-title` / `text-heading` / `text-body` / `text-caption`) rather than raw `text-sm` etc., `max-w-content` / `max-w-form` for widths, and `tabular` for amounts, dates and scores.
- Status colors: `success` / `warning` / `info` / `destructive` (Badge and Alert have matching variants). Confidence colors map onto them via `lib/confidence.ts`, which also holds the review thresholds.
- Shared app components: `ConfidenceBadge`, `StatusBadge`, `PageHeader`, `EmptyState` in `src/components/`. `/design-system` renders every token and component — check new UI there in both themes.

## Architecture: The Agent Pipeline

This is the core of the project — do not collapse it into a single prompt call. Four distinct steps with explicit state handoff:

1. **Classifier agent** — determines document type (receipt / invoice / other) and vendor category. Runs first; downstream agents use its output.
2. **Extraction agent** — pulls structured fields (vendor, date, line items, tax, total, currency) via tool calls. Uses tools for things like currency conversion or tax-rate lookup, not just raw JSON generation.
3. **Validation agent** — checks line-item math against the total, flags duplicate submissions, flags anomalies (e.g. unusually high amount for that vendor).
4. **Categorization agent** — maps to expense categories using business rules plus (later, Phase 5) learned patterns from past user corrections.

Design requirements for the pipeline:
- Every extracted field carries a **confidence score**, not just a value. This drives which fields get flagged for human review.
- Malformed/invalid model output triggers retry logic, not a silent failure.
- Partial failure is a first-class case: e.g. extraction succeeds but validation errors out — the system needs to represent that state, not just crash the job.
- Extraction is async (BullMQ) with visible job status (processing → review → done) in the UI.

## Human-in-the-Loop Review

Low-confidence fields are surfaced in an editable review UI, original document shown side-by-side with the extracted fields. Corrections are stored (not discarded) — this is what eventually powers the vendor-level learned-patterns feedback loop (Phase 5, stretch). This human-review layer is one of the strongest signals in the whole project: it shows the system was designed around the fact that AI extraction isn't 100% reliable, rather than assuming it is.

## Data Model (Prisma — core entities)

- `Business` — tenant root
- `User` — role: submitter / approver / admin, scoped to a Business
- `Document` — uploaded file metadata, storage key, status
- `Extraction` — pipeline run output, linked to a Document
- `ExtractionField` — individual field + value + confidence score, linked to an Extraction
- `Correction` — user edit to a field, linked to an ExtractionField, preserves original AI value
- `Approval` — workflow state (submitted / approved / rejected), linked to a Document
- `AuditLog` — who did what, when, on which entity
- `Vendor` — normalized vendor record, used for duplicate/anomaly detection and (later) learned patterns

Keep tenant scoping (`businessId`) on every query from day one — retrofitting multi-tenancy later is painful.

Schema: `apps/api/prisma/schema.prisma`. Design decisions worth knowing before changing it:
- `businessId` is denormalized onto child tables too (ExtractionField, Correction) so scoping never needs a join.
- Line items are flattened into `ExtractionField` rows with paths like `lineItems.0.amount`, so every value is scored/reviewed/corrected the same way. Values are canonical strings (ISO date, plain decimal); `valueType` says how to parse.
- Fields are never overwritten — corrections are separate rows and the latest wins. Re-processing a document creates a new `Extraction`.
- Approval holds current state only; transitions go to `AuditLog`.
- The init migration adds a CHECK constraint (confidence in 0–1) by hand — keep hand edits like this when regenerating migrations.

### Auth & tenancy

- **API** (`apps/api/src/auth`): stateless JWT bearer tokens, 1-day TTL, payload is only `sub`. `JwtAuthGuard` is global — every route needs a token unless marked `@Public()` — and it reloads the user from the DB on each request, so role changes and deletions apply immediately. `RolesGuard` (also global) enforces `@Roles(UserRole.ADMIN, …)`.
- **Tenant scoping is explicit:** controllers take `@CurrentUser() user` and pass `user.businessId` into every service method; services put it in every `where`. Never read a businessId from the request body or params.
- Never select `passwordHash` into a response — use `authUserSelect`. Registration creates a Business plus its first user as ADMIN; admins add further users via `/users`.
- **Web** (`apps/web`): the browser never calls the API. Server actions call it and keep the token in the httpOnly `invoicio_session` cookie; server code calls the API through `apiFetch` (`lib/api.ts`), which attaches the token. `src/proxy.ts` (Next 16's middleware) only does an optimistic cookie-exists redirect; the real check is `requireUser()` / `getCurrentUser()` in `lib/dal.ts`. Pages under `(app)/` are protected by that layout.
- Logout only deletes the cookie; tokens aren't revocable server-side until expiry (no refresh tokens or denylist yet).
- e2e tests (`npm run test:e2e` in apps/api) run against the local DB and delete what they create.

### Database (Prisma 7, local Postgres)

- Run from `apps/api`: `npm run db:migrate` (create/apply migrations), `npm run db:generate`, `npm run db:seed` (Demo Co + admin/approver/submitter `@demo.test`, password `password123`), `npm run db:studio`.
- Prisma 7 specifics: config is in `prisma.config.ts` (not the schema); `migrate dev` does **not** run generate; the client is generated to `src/generated/prisma` (gitignored — regenerate after pulling) and imported from `../generated/prisma/client.js`; it connects through `@prisma/adapter-pg`.
- Inject `PrismaService` (global `PrismaModule`); don't construct `PrismaClient` elsewhere in the app.
- Local `DATABASE_URL` uses the unix socket with peer auth: `postgresql://<user>@localhost/invoicio?host=/var/run/postgresql`.

## Build Phases (see Notion board "Invoicio — Build Plan" for the full task breakdown)

1. **Foundation** — repo setup, Prisma schema, local file storage, auth, upload UI, shadcn/ui design system
2. **Extraction Core** — OCR pre-pass, single extraction call with confidence scoring, retry logic, async queue
3. **Agentic Pipeline** — split into classify → extract → validate → categorize, with explicit orchestration and failure handling
4. **Business Features** — dashboard, approval workflow, CSV/QuickBooks export, duplicate detection, audit trail
5. **Human-in-the-Loop** — review UI, correction storage, (stretch) learned patterns feedback loop
6. **Test Data & Deploy** — real receipts + SROIE/CORD labeled samples + synthetic edge cases, measure and document extraction accuracy, deploy, write portfolio README

Build in this order. Get Phase 1–2 working end-to-end with a single extraction call before splitting into the multi-agent pipeline in Phase 3 — don't build the orchestration layer against an extraction step that doesn't work yet.

Deliberate exceptions to the phase order (reflected on the Notion board):
- The prompt eval framework and gathering own test data happen in **Phase 2**, since the extraction prompt and confidence thresholds need labelled data to tune against.
- The review UI and correction storage (Phase 5 must-haves) are built **right after Phase 2**, before Phase 3/4, so the upload → extract → review path is demoable early.

### Evals

- Scorer and dataset loader in `apps/api/src/evals/`; datasets in `apps/api/evals/datasets/<name>/labels.json` (format in the README there). `own/` holds personal receipts and is gitignored.
- Labels use the same flattened `path` / `valueType` / canonical `value` shape as `ExtractionField`.
- Besides accuracy, the summary reports accuracy per confidence level and **silent errors** (wrong values scored at or above the high threshold, which the review UI wouldn't flag). Use these to set the thresholds in `apps/web/src/lib/confidence.ts`.

## Test Data Sources

- Own real receipts/invoices (Uber/Careem, SaaS subscription emails, freelance client invoices) — best for realistic messiness
- SROIE and CORD datasets — labeled receipts, use to measure field-level extraction accuracy against ground truth
- Synthetic edge cases generated deliberately: blurry, rotated, torn, handwritten, multi-currency — used to stress-test confidence scoring and the review fallback path

Target: a concrete accuracy metric for the portfolio writeup (e.g. "X% field-level accuracy on a N-receipt test set"), not just a working demo.

## Coding Conventions

- TypeScript everywhere, with proper typing — this is portfolio code, treat type safety as a demonstrated skill, not a formality
- Functional React components, proper hooks usage, sensible component composition (avoid prop-drilling past 2–3 levels — lift state or use context)
- NestJS: keep modules feature-scoped (documents, extractions, agents, approvals, auth) rather than one giant service
- Comment complex logic (agent orchestration, confidence thresholds, validation rules); don't comment obvious code
- Mobile responsiveness matters even though this is a dashboard-heavy app — at minimum the upload flow should work well on a phone, since "submit a receipt from your phone" is a real use case, not just a demo nicety
- Write code you can defend line-by-line in a technical interview — prefer clarity over cleverness

## Environment Variables (expected)

```
DATABASE_URL=
REDIS_URL=
STORAGE_DIR=./storage
ANTHROPIC_API_KEY=
JWT_SECRET=
```

## What "Done" Looks Like for the Portfolio Version

- End-to-end flow works: upload → async pipeline → review/correction → approval → dashboard
- At least one documented accuracy metric against labeled test data
- README with architecture diagram and a clear explanation of *why* the pipeline is split into agents, not just how
- Short demo video walking through the full flow, including a deliberately messy/low-confidence document going through the review path
- Deployed and reachable via a live link, not just a local repo