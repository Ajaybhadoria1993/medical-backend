# CLAUDE.md — Backend (`InfinityMedisetu_BE`)

Node.js/Express/TypeScript backend API for Medisetu Clinic Management Software.
Stack: Drizzle ORM + PostgreSQL, Redis, Socket.io, Zod, JWT.

> This is one of two repos under `imsCore/`. The FE (`../InfinityMedisetuWeb_FE`)
> proxies `/api` and `/socket.io` to this server on `localhost:5000` in dev.
> The repo-root `../CLAUDE.md` has the cross-repo / deploy overview, and
> `../WORKFLOW.md` defines how a task is run (scope, gates, definition of done).

## Commands

- `npm run dev` — kills port 5000, starts Redis via `docker/docker-compose.dev.yml` (skips silently if Docker isn't running), then runs the server with nodemon (`NODE_ENV=development`)
- `npm run dev:instance` — same as `dev` but skips the Docker Compose step (use when infra is already running)
- `npm run start:dev` — run once via `tsx` without nodemon
- `npm run build` — `tsc -p tsconfig.json`
- `npm test` — Jest (`--forceExit --detectOpenHandles`); `npm run test:watch`; `npm run test:coverage`
  - Single file: `npx jest path/to/file.test.ts` — by name: `npx jest -t "test name"`
- `npm run lint` / `npm run lint:fix`, `npm run format` (Prettier)
- Database (Drizzle ORM, three isolated migration paths keyed off `NODE_ENV`):
  - `npm run db:migrations:dev` / `:staging` / `:prod` — generate migrations (`dev` → `src/drizzle/migrations/dev`, gitignored/local-only; `staging` and `prod` → tracked, deployed via CI)
  - `npm run db:migrate:dev` / `:staging` / `:prod` — apply migrations
  - `npm run db:seed:dev` / `:staging` / `:prod` — seed data
- `npm run docker:up:dev` / `docker:down:dev` — full local dev stack (`docker/docker-compose.dev.yml`, builds app image locally)
- Swagger UI at `http://localhost:5000/api/api-docs` (note the `/api` prefix — `app.ts:94` mounts it there). `/api/docs/json` is the registry's own `{updatedAt, endpoints[]}` dump, **not** OpenAPI.

## Deploy (dev / staging / prod)

Three fully isolated environments — separate compose files, container names/volumes, host ports, DB creds, and migration folders (`docker/docker-compose.{dev,staging,prod}.yml`; all Docker files live under `docker/`, but `.env`/`.dockerignore` stay at repo root since the build context is the repo root). Env resolution: `src/utils/envConfig.ts` (`DEV_DB_*` / `STAGING_DB_*` / `PROD_DB_*`, selected by `NODE_ENV`).

| | dev | staging | prod |
|---|---|---|---|
| Branch/trigger | local only | push to `staging` branch | `git tag vX.Y.Z` on `main` |
| Host ports (redis/app) | 6380/5000 | 6379/5000 | 6379/5000 |
| Migrations | `src/drizzle/migrations/dev/` (gitignored) | `.../staging/` (tracked) | `.../prod/` (tracked) |

**`npm run dev` runs the server on the host, so `.env` must name the *published* dev port** — `REDIS_PORT=6380`, not the 6379 default. The `REDIS_HOST=redis` value inside `docker-compose.dev.yml` is service-name DNS for the containerized `app` service only; a host-run server pointed at 6379 gets `ECONNREFUSED`.

**Redis is not optional.** It backs the Socket.io adapter, the BullMQ queues and notification delivery, and an outage takes the process down rather than degrading — ioredis exhausts `maxRetriesPerRequest` and a worker throws. A `.env` pointing at a Redis that is not running is the most common local failure; check `ss -ltn | grep 6380` before debugging anything else.

CI/CD: `.github/workflows/main.yml` — `build-and-test` on every push to `main`/`staging` + PRs into `main`; `deploy-staging` on push to `staging`; prod `deploy` only on `vX.Y.Z` tags reachable from `main`. Healthchecks use `wget --spider`, **not** `curl` (the runtime image never installs `curl`).

Test a compose file locally: `docker/docker-compose.{staging,prod}.yml` only have `image:`, so they pull the published image. To build local code as staging (from repo root): `docker compose -f docker/docker-compose.staging.yml -f docker/docker-compose.staging.override.yml up -d --build app`.

## Architecture

**Feature-module layout under `src/main/`.** Each domain feature (`appointments`, `clinic`, `doctor`, `pharmacy`, `lab`, `medicine`, `patient`, `subscription`, `users`, `mfa`, `notifications`, `reports`, …) is self-contained: `controllers/`, `models/` (Drizzle schema + queries), `routes/`, `schemas/` (Zod), `services/`. Follow the nearest sibling module rather than inventing a new structure.

**Routes are auto-discovered, not manually registered.** `src/utils/loadRoutes.ts` scans `src/main/{feature}/routes/{version}/*.ts` at startup and mounts each default-exported router at `/api/{version}/{kebab-case-feature}` (or `/api/{version}/{feature}/{kebab-case-filename}` if the file isn't named after the feature). Adding a route file in the right place is enough — there's no central router. Modules may also export an `apiDocs` array, auto-registered into the Swagger/OpenAPI `docsRegistry`.

**Request/response conventions:**
- Zod schemas per feature in `schemas/`, validated via `middlewear/validateZod.ts` / `validation.middleware.ts`.
- Standard envelopes from `utils/response.utils.ts` — success: `sendOk` / `sendCreated` / `sendNoContent` (all `{ success, message, data }`); errors: `throw new HttpError(status, message)` (caught by `asyncHandler`), flowing through `middlewear/errorHandler.ts`. **Every new controller/route must return success via these helpers — never hand-roll `res.status(200).json({ success: true, result })` (or `{ success: false, ... }`) directly.** A few older controllers predate this convention and still hand-roll `{ success, result }`; don't copy that pattern into new code, and prefer fixing it forward when you touch one.
- Auth: JWT (`middlewear/auth.middleware.ts`) attaches `req.user`, `req.clinicId`, `req.labId` (roles in `AuthUser`: Admin, User, Super_Admin, Doctor, Receptionist, Pharmacist). MFA: `mfaAuth.middleware.ts`. Plan gating: `subscriptionAccess.middleware.ts` + `limitation.middleware.ts`.
- `express.json()` is global in `app.ts` with a `verify` hook stashing `req.rawBody` (for Razorpay webhook HMAC); a few prescription-scan routes get larger body limits registered *before* the global JSON parser.

**Cross-cutting infra** (wired in `app.ts`/`server.ts`):
- Socket.io (`src/socket/socketManager.ts`) — every emit fans out across nodes through the **Redis adapter**. Kafka was removed 2026-08-30: seven of its eight publish sites duplicated an emit the adapter already delivered, and the eighth (chat) had no direct emit at all, so chat silently failed whenever the broker was down.
- Redis (`src/configurations/redisConfig.ts`) — caching/session + Socket.io Redis adapter.
- Cron jobs: `src/cron/jobs/`, registered from `src/cron/index.ts` (auto no-show, subscription renewal, …).
- HTML/email templates: `src/htmltamplates/` (the folder-name typo is existing/intentional — do not "fix").

**Path alias**: `@/*` → `src/*` (`tsconfig.json`; mirrored in `jest.config.js` `moduleNameMapper`).

**Feature docs**: `docs/` has per-feature write-ups (`APPOINTMENT_ENGINE_ARCHITECTURE.md`, `SUBSCRIPTION_SYSTEM.md`, `RAZORPAY_PAYMENT_FLOW.md`, `PATIENT_FLOW_API_REFERENCE.md`, …) — check there before re-deriving a subsystem.

## Backend Standards

**`docs/playbook/BACKEND_STANDARDS.md` is the single rule set for all backend work** — module
structure, naming, routes/controllers/services, validation, response envelopes, Drizzle and
transactions, caching, auth and tenancy, realtime, logging, tests, and build workflow. Check every
BE change against it, and finish with its §15 review checklist.

Three rules worth repeating here, because they bite immediately:
- **Every tenant-scoped query filters by `req.clinicId`/`req.labId` taken from the token** — a
  missing filter leaks one clinic's patient data to another (§9).
- **Migrations are generated and applied by the repo owner**, never by an agent — write the model
  change and stop (§7).
- **Never run the full Jest suite locally** — it hangs the machine. Run one file (§12).
