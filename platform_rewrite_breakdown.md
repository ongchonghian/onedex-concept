# Platform Rewrite Initiative — Epics & Stories Breakdown

**Source doc:** [Platform rewrite Initiative](https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/1942290443/Platform+rewrite+Initiative) (Confluence page 1942290443, CDIT space, May 2026)
**Target Jira parent epic (existing):** [CTD-8313 — Data Exchange phase 3](https://afa-cdi.atlassian.net/browse/CTD-8313) — "Rewrite of whole platform to microservice architecture in golang" (status: To Do, project CTD — Dex Tech Development)
**Original idea ticket:** [DEX-15 — Platform Rewrite](https://afa-cdi.atlassian.net/browse/DEX-15) (Dex Features Planning, status: Done — i.e. the discovery phase that approved this work)

This document is a draft. Nothing is pushed to Jira/Confluence yet. Each Story below is sized to be a 1–3-day unit of work; combine if your team prefers larger Stories.

---

## 1. Problem Statements → Outcomes → Success Metrics

| # | Problem (current state) | Target outcome | Success metric |
|---|---|---|---|
| P1 | **Transaction-layer overloading.** `pitstop-core` runs both high-throughput message processing (MessageStore) and business/feature logic on the same critical path. New features mean new validations/joins inside the transaction path, inflating end-to-end latency. MessageStore + AuditTrail are append-heavy and CPU-sensitive; any ALTER or sync trigger risks DB saturation. | Business/feature logic lives in the v2 Go service against the new platform DB. Pitstop transaction layer reads frozen tables only. New fields go to new tables in platform DB. | Median push/pull latency unchanged or improved post-cutover; zero ALTERs on MessageStore/AuditTrail; CPU on Pitstop RDS within pre-cutover baseline ±10%. Validates the recent prod RDS storage incident root cause ([DXT-47](https://afa-cdi.atlassian.net/browse/DXT-47), page [1945665540](https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/1945665540)). |
| P2 | **Monorepo entanglement.** Features in `dex-monorepo` are tightly coupled — ETR flows and per-DEX features can't be cleanly toggled off; bugs in unused features still ship with every deploy. | Feature-flagged modules per DEX, with clear ownership and per-DEX toggles via DexContext + feature-flag service. | Each DEX can disable a feature in <1 hour via config; deployment of an unused feature does not require code changes for non-applicable DEXes. |
| P3 | **Domain model fragmentation.** Four representations for consent/sharing (Subscription v1, SubscriptionV2, DER, SPR) plus dual-DB shadow tables for Organization/DataElement/User causing fragile cross-service sync, eventual consistency drift, and added latency. | One `consent_agreement` table (+ `consent_invite`); single canonical `organization`, `user`, `data_element`, `org_endpoint` in platform DB. Pitstop reads via FK only. | Zero cross-service sync jobs after Phase 4 cutover; consent CRUD goes through one service layer; no admin/pitstop shadow records out of sync >5s. |
| P4 | **Cross-boundary latency.** admin-corev2 (Central account, Node/Lambda) ↔ pitstop-core (Pitstop account, Node/ECS) require cross-account HTTPS for joined data → network latency + IAM complexity. | Single AWS account (or consolidated VPC); in-process DB lookups replace cross-account HTTPS where possible. References the in-flight Central→Pitstop migration ([AWS_Central_to_Pitstop_Migration_Plan_v3](https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/1873805342)). | p95 latency on cross-domain endpoints drops by ≥30% post-Phase 6; cross-account HTTPS calls eliminated from hot paths. |
| P5 | **Fragmented client experiences.** Separate admin-ui + pitstop-ui means dual implementations, dual CI/CD, duplicate components for every feature spanning both personas. | One portal at `dex-monorepo/ui/apps/portal` — role-aware, dex-aware, single URL. Aligns with the existing [Centralised Log-In requirements](https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/972881949). | One CI pipeline for portal; shared component library reused across admin+participant flows; new feature spanning both personas ships from one PR. |
| P6 | **Cross-DEX sharing not feasible.** Separate admin/pitstop DB pairs per DEX make cross-DEX data sharing architecturally impossible. | Consolidated platform DB with `org_dex_membership` join + `dex_id` columns enabling orgs to span multiple DEXes; consent flows generalised. | A single org record can carry memberships in ≥2 DEXes; a consent agreement can be created across DEXes via API. |

**Identified via concept-design grilling (not in source platform-rewrite doc):**

| # | Problem (current state) | Target outcome | Success metric |
|---|---|---|---|
| P7 | **Data exchange UX is opaque.** Legacy split between `shared-data` (PUSH/STORE/PROVIDE) and `received-data` (PULL/RECEIVE) forces operators to mentally translate "did Maersk get my B/L?" into "is it under shared or received?". Failed-message retry lives on a separate page; reconciliation, retry semantics, and lifecycle stages are inconsistent across the surface. | Unified Messages surface with flow-agnostic 4-status taxonomy (In flight / Delivered / Acknowledged / Failed), flow-specific timelines for PUSH/PULL/STORE, owner badge for Failed, Edit & resend, Watch toggle for time-sensitive Agreements. | Operators answer "what needs my action today?" in ≤3 clicks; one canonical lifecycle vocabulary; ADRs 0020–0023 cover the structural decisions. P7 brainstorm rubric R7 grades the recommendation 89/100. |
| P8 | **Manual Message initiation is bifurcated and role-confused.** Legacy EForm + ETR modules are separate surfaces with overlapping concerns; access control is inconsistent (UI permissive, backend ad-hoc); the "Provider" term overloads data-owner and Service-Provider roles; drafts have no auto-save; no fallback when SP pitstop is unreachable. | One Agreement-anchored Message composer with three flow-type variants (Send / Request / Stage), complexity-driven shape (single-page for routine elements / wizard for high-stakes), Acting-as workflow for SPs composing on data-owner's behalf, draft persistence with decay-with-pin lifecycle, idempotency contract threaded through Compose → Submit → Retry. | One composer replaces EForm + ETR; access predicate is uniform (`data-owner role`); ADRs 0024–0026 cover the structural decisions. P8 brainstorm rubric R8 grades the recommendation 92/100. |

---

## 2. Epics (one per phase) + Stories

### EPIC 0 — Phase 0: Discovery & Alignment
- **Goal:** Lock down decisions, close unknowns, prevent mid-build surprises.
- **Duration:** 2–3 weeks (Weeks 1–3)
- **Dependencies:** None
- **Deliverables:** Domain glossary, table classification spreadsheet, API surface map, team RACI, NFR document.
- **Suggested Jira labels:** `platform-rewrite`, `phase-0`, `discovery`

#### Stories
| ID | Story | Acceptance criteria |
|---|---|---|
| PR-0.1 | Domain model workshop with engineering, product, business | Output: domain glossary doc covering DEX flexibility, multi-pitstop per org, new consent model. Signed off by Eng + Product + Business leads. |
| PR-0.2 | Data audit — enumerate every Admin DB + Pitstop DB table | Spreadsheet classifying each table as shared / admin-only / pitstop-only / to-be-merged / to-be-retired. Must cover DataExchangeRelationship, ServiceProviderRelationship, DeSpRelationshipBinding, Enrolment, Subscription (v1+v2), Organization, EnterpriseSystem, MessageStore, AuditTrail, AttachmentStore, all event/config tables. |
| PR-0.3 | API surface audit — map every `/api/v1/` route to its consumers | Table of all admin-corev2 + pitstop-core v1 routes, each annotated with: consuming client (admin-ui, pitstop-ui, external integrator, Lambda job). Drives Phase 4 batch ordering. |
| PR-0.4 | Dependency map — cross-account calls, Cognito, DynamoDB, Lambda crons | Diagram + list documenting every cross-account HTTPS call, Cognito pool dependency, DynamoDB config table, and scheduled Lambda touching each service. |
| PR-0.5 | Team ownership / RACI for portal modules and API domains | Decision doc selecting Phase 1 portal ownership option (A/B/C) with module ownership assignments. |
| PR-0.6 | Non-functional requirements doc | Agreed NFRs: SLAs per domain, data-residency constraints, rollback SLA per phase. |
| PR-0.7 | Resolve open decision: DB migration option (A vs B vs C) | Documented decision with cost/risk/effort comparison; sign-off from infra + eng leads. **Recommendation in doc: B for prod, evolve to C.** |
| PR-0.8 | Resolve open decision: Portal sub-module ownership (A vs B vs C) | Documented decision. **Recommendation in doc: Option A (domain modules in monorepo).** |
| PR-0.9 | Resolve open decision: AuditTrail merge strategy | Decide: one unified `shared_audit_log` with source discriminator, OR keep separate + unified view. |
| PR-0.10 | Resolve open decision: DynamoDB vs RDS for runtime config | Decide whether to keep Dynamo for pitstop-config or fold into consolidated Postgres. |
| PR-0.11 | Resolve open decision: Cognito pool consolidation | Decide one pool per env (all dexes) vs one per dex; evaluate migration risk per dex. |
| PR-0.12 | Resolve open decision: v1 EOL date | Communicate with external partners and lock 12-month EOL clock. |
| PR-0.13 | Resolve open decision: Go producer/consumer scope | Define when producer/consumer/aggregator microservices get updated to call v2 APIs (post-Phase 4 default). |

---

### EPIC 1 — Phase 1: Unified Portal & API Scaffold
- **Goal:** Stand up the new portal app and Go API service skeletons inside dex-monorepo without breaking production.
- **Duration:** 3–4 weeks (Weeks 3–6)
- **Dependencies:** Epic 0 complete (esp. PR-0.5 + PR-0.8 ownership decisions)
- **Related Confluence:** [Detailed Requirements for Centralised Log-In](https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/972881949), [Modules to refactor for separation of concerns](https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/526090270/Modules+to+refactor+for+separation+of+concerns)
- **Suggested labels:** `platform-rewrite`, `phase-1`, `portal-scaffold`

#### Stories
| ID | Story | Acceptance criteria |
|---|---|---|
| PR-1.1 | Scaffold `ui/apps/portal` via Nx | `npx nx g @nx/react:app portal` inside `dex-monorepo/ui`; folder structure matches §1a (app/auth/dex/layout/modules); local-dev `docker-compose.yaml` runs portal on port 3010. |
| PR-1.2 | Implement unified `LoginPage` + `TfaPage` | Posts to `/api/v2/identity/auth/login`; handles TFA flow; on success seeds AuthContext with `{ token, user: { type, isAdmin, role[], orgId, dexId } }`. |
| PR-1.3 | Implement `AuthContext`, `DexContext`, `ThemeLoader` | AuthContext exposes token + user. DexContext loads dex config + features post-login. ThemeLoader dynamically injects per-dex CSS. |
| PR-1.4 | Implement `PortalLayout` with role-aware `Sidebar` | Sidebar renders admin nav vs participant nav based on `user.isAdmin`; verified with stub pages for at least one admin route and one participant route. |
| PR-1.5 | Implement route guards (AuthGuard, RoleGuard, DexGuard) | Guards prevent unauthenticated access, gate admin-only routes, and enforce dex-level access. Unit tests cover positive + negative paths. |
| PR-1.6 | Stub all feature pages as "Coming Soon" placeholders | All routes from `modules/admin/*` (participants, approval-requests, user-management, onboarding) and `modules/participant/*` (shared-data, received-data, configuration, dashboards, etr) render placeholders behind correct guards. |
| PR-1.7 | Add `be/admin-core` v2 + v1 route groups | `router.go` mounts `/api/v2` group and `/api/v1` shim group skeletons (empty, return 501). |
| PR-1.8 | Set up CI/CD pipelines for portal + admin-core | Pipelines build, test, and deploy portal to dev S3+CloudFront and admin-core to dev environment. Existing v1 services (admin-corev2, pitstop-core) remain unchanged. |
| PR-1.9 | Document portal architecture & local-dev setup | README in `ui/apps/portal/` covering directory layout, auth flow, how to add a module, theme loading. |

---

### EPIC 2 — Phase 2: Database Consolidation (DMS)
- **Goal:** Consolidate Admin DB + Pitstop DB into single platform DB via AWS DMS, with MessageStore + Pitstop AuditTrail permanently frozen in place.
- **Duration:** 6–10 weeks (Weeks 4–14)
- **Dependencies:** Epic 0 PR-0.2 (table audit), PR-0.7 (migration option chosen).
- **Related Confluence:** [Database Migration Approach](https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/1489731587), [AWS_Central_to_Pitstop_Migration_Plan_v3](https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/1873805342), [Migration Plan - Updated](https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/1501691909), [RDS prod-database storage exhaustion incident](https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/1945665540)
- **Suggested labels:** `platform-rewrite`, `phase-2`, `db-consolidation`, `dms`

#### Stories
| ID | Story | Acceptance criteria |
|---|---|---|
| PR-2.1 | **Hard rule story:** Document & enforce MessageStore/AuditTrail freeze | DDL guard: CI lint blocks any migration script touching MessageStore, MessageStoreChangeHistory, MessageCache, or pitstop AuditTrail. Doc updated in `be/admin-core/migrations/README.md`. |
| PR-2.2 | Create target schema DDL scripts in `be/admin-core/migrations/` | Timestamped reversible SQL files defining all platform DB tables from §2e classification + §3e summary map. `dex_id` columns + indices on all consolidated tables. |
| PR-2.3 | Provision platform DB per chosen option (A/B/C) | If Option B/C: new RDS instance provisioned via `infra-terragrunt`. If Option A: new database on existing Pitstop RDS. Logical replication enabled on source RDS(es). |
| PR-2.4 | Configure DMS replication instance + endpoints | DMS replication instance in target VPC. Source endpoint(s) for Admin RDS (+ Pitstop RDS for Options B/C). Target endpoint for platform DB. Tracked in `infra-terragrunt`. |
| PR-2.5 | DMS full-load — Admin DB core tables | Full-load tasks for Organization, User, Role, Permission, EnterpriseSystem, Enrolment, Subscription, SubscriptionV2, DataElement, UseCase, AuditTrail (admin), LicenseKey, Network, Stack. Row counts + spot-checks validated. |
| PR-2.6 | DMS full-load — DER/SPR tables (deferred until §3 design ready) | Full-load DataExchangeRelationship, ServiceProviderRelationship, DeSpRelationshipBinding, invites only after Epic 3 PR-3.x design signed off. |
| PR-2.7 | DMS full-load — Pitstop non-frozen tables (Options B/C only) | AttachmentStore + selected pitstop config tables migrated to `platform.ps_*`. Frozen tables explicitly excluded. |
| PR-2.8 | Enable DMS CDC on all source tables | Logical replication slots created; CDC tasks keep platform DB in sync while v1 services remain live. Lag dashboards in CloudWatch. |
| PR-2.9 | Shadow-read validation per table group (≥2 weeks each) | v2 service reads from platform DB; compare against v1 reads from source DB. Diff reports automated; zero diffs >1s old for ≥2 weeks before write-cutover for that group. |
| PR-2.10 | Write-cutover — per table group | New writes go via v2 service to platform DB only. v1 shim invokes v2 services. v1 services no longer write to source for migrated table. Toggle via feature flag. |
| PR-2.11 | Source decommission per group | Once write-cutover stable for 1 week, stop CDC for that group; archive source table with `_archived_` prefix. Hold for 90 days then drop. |
| PR-2.12 | Update GORM model definitions in `be/admin-core/internal/model/` | One GORM struct per consolidated table; canonical model definitions per project convention (`CLAUDE.md`). |
| PR-2.13 | DMS runbook — failure & rollback procedures | Runbook covers: replication slot full, FATAL_ERROR after 9 retries (per [Database Migration Approach](https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/1489731587)), ` ` unicode escape failure, lag >5min, cutover rollback. Reviewed by infra lead. |

---

### EPIC 3 — Phase 3: Domain Model Evolution (consent + multi-dex)
- **Goal:** Extend DEX/Pitstop hierarchy for multi-dex orgs and multi-pitstop subscriptions; collapse four consent representations into one `consent_agreement`.
- **Duration:** 4–6 weeks (Weeks 4–10, parallel with Phase 2)
- **Dependencies:** Epic 0 PR-0.1 (domain workshop)
- **Related Confluence:** [Dex Participant Onboarding & Relationship Consent Setup Improvement](https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/1302167573)
- **Suggested labels:** `platform-rewrite`, `phase-3`, `domain-model`, `consent`

#### Stories
| ID | Story | Acceptance criteria |
|---|---|---|
| PR-3.1 | Design + create `org_dex_membership` table | DDL per §3a; FK to organization; status enum (ACTIVE/SUSPENDED/TERMINATED); migration script populates one row per existing org/dex pair from `EnterpriseSystem.dexId`. |
| PR-3.2 | Rename `EnterpriseSystem` → `org_endpoint` with `dex_id` FK | DDL renames table, adds `dex_id`; pitstop-side EnterpriseSystem mirror consolidated. v2 API exposes `/v2/orgs/:id/endpoints`. |
| PR-3.3 | Design `consent_agreement` table — schema + state machine | DDL per §3c with `agreement_type` discriminator (DIRECT / SERVICE_PROVIDER / PRINCIPAL / SUBSCRIPTION); status enum; flow field; tripartite SP support via `contributor_org_id`. State machine doc reviewed by Product. |
| PR-3.4 | Design `consent_invite` table | Merges DataExchangeRelationshipInvites + ServiceProviderRelationshipInvites; same `agreement_type` discriminator. |
| PR-3.5 | Build migration logic Subscription v1 + V2 → consent_agreement | One-time backfill script + ongoing CDC translator. Field map: subscriber→initiator, prosumer→counterparty; status enum mapped. |
| PR-3.6 | Build migration logic DER + SPR + DeSpRelationshipBinding → consent_agreement | Backfill script preserves tripartite SP linkages (contributor_org_id). Old tables kept read-only post-migration. |
| PR-3.7 | Build v1 shim query translators in Go | `internal/dto/shim/consent_v1.go` translates consent_agreement rows back to v1 Subscription / DER / SPR response shapes. Existing admin-corev2 E2E suite passes against shim. |
| PR-3.8 | Schema-analysis follow-ups: merge `Activity` + `DataExchangeActivityLog` into `audit_log` | DDL + backfill; `category` column preserved; admin-corev2 calls re-routed via v2 audit service. |
| PR-3.9 | Schema-analysis follow-ups: collapse `Organization`/`User`/`DataElement` admin+pitstop mirrors | DDL drops pitstop shadow columns; pitstop services read via FK. Update pitstop-core read paths to query platform DB. |
| PR-3.10 | Fold one-to-one tables into `Organization` | `OrganizationAutoApproval`, `OrgPackageSetting`, `OrganizationNotifyErrorSetting` become columns on organization. |
| PR-3.11 | Evaluate retire `Version` + `WhatsNew` + `Stack` + `BillingDetail` | Decision doc + retirement plan per table. |
| PR-3.12 | Merge `SourceSystemConfiguration` + `ParticipantSourceSystemConfiguration` | One table with nullable orgId; pitstop reads updated. |

---

### EPIC 4 — Phase 4: v2 API Layer in Go
- **Goal:** Build all v2 domains inside `be/admin-core`; retire Node.js `admin-corev2`. v1 becomes a shim in same Go binary.
- **Duration:** 6–8 weeks (Weeks 6–14)
- **Dependencies:** Epic 1 scaffold (PR-1.7), Epic 3 (for Batch 4)
- **Existing in-flight Stories to link** (already in Jira, project CTD):
  - [CTD-10245 — Refactor /api/v1/login](https://afa-cdi.atlassian.net/browse/CTD-10245) → Batch 1
  - [CTD-10251 — Refactor api/v1/dex](https://afa-cdi.atlassian.net/browse/CTD-10251) → Batch 5
  - [CTD-10252 — Refactor api/v1/org](https://afa-cdi.atlassian.net/browse/CTD-10252) → Batch 2
  - [CTD-10397 — [ADMINCORE-Go] /org file handling](https://afa-cdi.atlassian.net/browse/CTD-10397) → Batch 2
- **Strategy decision:** Option A (domain-batch migration). Stories below are organised by batch.
- **Suggested labels:** `platform-rewrite`, `phase-4`, `v2-api`, `golang`, plus batch label `batch-1` … `batch-7`

#### Batch 1 — Auth & Identity (Risk: Low)
Routes: login, logout, renew-token, validate-token, forgot-password, reset-password, user/*, role/*, permissions/*, tfa/*

| ID | Story | Acceptance criteria |
|---|---|---|
| PR-4.1.1 | Port `/v2/identity/users` CRUD + status + maker-checker role | Service + store + DTOs + GORM model; unit + E2E tests; v1 shim returns identical response shapes. |
| PR-4.1.2 | Port `/v2/identity/roles` CRUD + permission assignment | As above. |
| PR-4.1.3 | Port `/v2/identity/permissions` list + assign | As above. |
| PR-4.1.4 | Port `/v2/identity/tfa` setup + verify | As above. |
| PR-4.1.5 | OpenAPI spec for `/v2/identity/*` in `dex-api-specs` | Spec drafted, reviewed, merged before implementation completes. |
| PR-4.1.6 | Cutover identity routes to be/admin-core | Traffic from new portal flips to `/v2/identity/auth/*`; legacy admin-corev2 routes still live for 1 week then deleted. |

#### Batch 2 — Organisation & Enrolment (Risk: Medium)
Routes: org/*, enrolments/*, admin-requests/*, orgPersona/*, my-info/*, org-de-auto-approval/*, groups/*

| ID | Story | Acceptance criteria |
|---|---|---|
| PR-4.2.1 | Port `/v2/orgs` CRUD + status + file upload + maker-checker | (Track via CTD-10252 + CTD-10397.) |
| PR-4.2.2 | Port `/v2/enrolments` create/approve/reject | Email triggers parity with v1; v1 shim for `/org/enroll`, `/org/enroll/:adminRequestId`. |
| PR-4.2.3 | Port `/v2/admin-requests` external org join requests | CRUD + state transitions. |
| PR-4.2.4 | Port `/v2/orgs/:id/personas` (orgPersona) | CRUD. |
| PR-4.2.5 | Port `/v2/admin/my-info` SingPass MyInfo passthrough | GET/POST; SSM secret rotation parity. |
| PR-4.2.6 | Port `/v2/orgs/auto-approval` (org-de-auto-approval) | CRUD. |
| PR-4.2.7 | Port `/v2/orgs/groups` | CRUD. |
| PR-4.2.8 | Port `/v2/orgs/tradetrust-keys` (org/ttKeys) | POST/DELETE. |
| PR-4.2.9 | One-time: run `/org/migrate-ttkey-to-kms`, then remove | Migration executed; route deleted; no v2 equivalent. |
| PR-4.2.10 | OpenAPI spec + cutover for Batch 2 | Spec merged; traffic flipped; legacy code removed after 1 week. |

#### Batch 3 — Data Elements & Schema Versioning (Risk: Low–Medium)
Routes: data-elements/*, data-element-versions/*, data-element-tracking/*, use-cases/*, personas/*, source-type-config/*, source-system-configuration/*

| ID | Story | Acceptance criteria |
|---|---|---|
| PR-4.3.1 | Port `/v2/data-elements` CRUD | Service+store; DSV feature-flag respected. |
| PR-4.3.2 | Port `/v2/data-elements/:id/versions` CRUD + promote + impact + sync | Restructured paths from `/data-element-versions/:id/:version/...`. |
| PR-4.3.3 | Port `/v2/data-elements/:id/versions/:v/comments` | CRUD. |
| PR-4.3.4 | Port `/v2/data-elements/tracking` | CRUD. |
| PR-4.3.5 | Port `/v2/use-cases` + personas + usecasepersonas | CRUD. |
| PR-4.3.6 | Port `/v2/identity/personas` | CRUD. |
| PR-4.3.7 | Port `/v2/config/source-type` + `/v2/config/pitstop/source-config` | CRUD. |
| PR-4.3.8 | OpenAPI spec + cutover for Batch 3 | Spec merged; cutover. |

#### Batch 4 — Consent & Relationships (Risk: HIGH — Phase 3 prerequisite)
Routes: subscriptions/*, data-exchange-relation/*, service-provider-relation/*, verificationFlow/*, orgUseCase/*, principal/*, thirdpartylookup/*, refreshSubscription/*

| ID | Story | Acceptance criteria |
|---|---|---|
| PR-4.4.1 | Port `/v2/consent/agreements` CRUD with type discriminator | Backed by `consent_agreement` table from Epic 3. |
| PR-4.4.2 | Port `/v2/consent/invites` CRUD | Backed by `consent_invite`. |
| PR-4.4.3 | Port `/v2/consent/verification` | VerificationFlow. |
| PR-4.4.4 | Port `/v2/consent/principals` (principal, SubscriptionPrincipal) | CRUD. |
| PR-4.4.5 | Port `/v2/consent/refresh` background trigger | Replaces `/refreshSubscription` and `/subscriptions/:id/refresh`. |
| PR-4.4.6 | Build v1 shims: `/subscriptions`, `/data-exchange-relation`, `/service-provider-relation`, `/verificationFlow`, `/principal` | Response translators in `internal/dto/shim/`; full E2E regression of admin-corev2 test suite against shim. |
| PR-4.4.7 | Port `/v2/orgs/:id/use-cases` (orgUseCase) | CRUD. |
| PR-4.4.8 | Port `/v2/admin/third-party` (thirdpartylookup) | CRUD; evaluate merge with pitstop `ThirdParty`. |
| PR-4.4.9 | OpenAPI spec + cutover for Batch 4 | Critical batch — extended shadow read; phased traffic shift; 30-day advance notice to integrators. |

#### Batch 5 — Pitstop / System Config (Risk: Medium)
Routes: sys/*, system/*, orgsys/*, config/*, licenseKey/*, status/*, network/*, feature/*, settings/*, notification-groups/*

| ID | Story | Acceptance criteria |
|---|---|---|
| PR-4.5.1 | Port `/v2/orgs/:id/endpoints` (sys, orgsys) | Rename EnterpriseSystem → endpoint complete per Epic 3 PR-3.2. |
| PR-4.5.2 | Port `/v2/config/pitstop` (system) | GET/POST. |
| PR-4.5.3 | Port `/v2/config/dex` (config + dex) | GET/PUT — note: existing CTD-10251 covers this. |
| PR-4.5.4 | Port `/v2/config/license-keys` | CRUD. |
| PR-4.5.5 | Port `/v2/config/network` | CRUD. |
| PR-4.5.6 | Port `/v2/config/feature-flags` (feature) | GET/PUT. |
| PR-4.5.7 | Port `/v2/config/settings` | GET/PUT. |
| PR-4.5.8 | Port `/v2/admin/status` | GET. |
| PR-4.5.9 | Port `/v2/notifications/groups` (notification-groups) | CRUD. |
| PR-4.5.10 | OpenAPI spec + cutover for Batch 5 | Spec merged; cutover. |

#### Batch 6 — ETR & TradeTrust (Risk: Medium)
Routes: saved-address/*, tradetrustKey/*, termClause/*, termTemplate/*, smart-contract/*, eclip-template/*

| ID | Story | Acceptance criteria |
|---|---|---|
| PR-4.6.1 | Port `/v2/etr/saved-address` | CRUD. |
| PR-4.6.2 | Port `/v2/etr/tradetrust-keys` | CRUD. |
| PR-4.6.3 | Port `/v2/etr/term-clauses` + `/term-templates` | CRUD. |
| PR-4.6.4 | Port `/v2/etr/smart-contracts` | POST. |
| PR-4.6.5 | Port `/v2/etr/eclip-templates` | CRUD. |
| PR-4.6.6 | OpenAPI spec + cutover for Batch 6 | Spec merged; cutover. |

#### Batch 7 — Notifications, Audit, Metering, Misc (Risk: Low)
Routes: notifications/*, audit/*, meter/*, master-data/*, email/*, version/*, whats-new/*, tandc/*

| ID | Story | Acceptance criteria |
|---|---|---|
| PR-4.7.1 | Port `/v2/notifications` list + read + action | CRUD. |
| PR-4.7.2 | Port `/v2/notifications/pitstop-activity` (machine-to-machine) | POST. |
| PR-4.7.3 | Port `/v2/notifications/user-settings` + email + groups | CRUD. |
| PR-4.7.4 | Port `/v2/audit` query | GET (reads consolidated `audit_log` from Epic 3 PR-3.8). |
| PR-4.7.5 | Port `/v2/metering` + master-data | GET/POST. |
| PR-4.7.6 | Port `/v2/admin/tandc` | GET/POST. |
| PR-4.7.7 | Retire `/version` route | Replace with deployment metadata; remove route. |
| PR-4.7.8 | Evaluate `/whats-new` — keep or move to CMS | Decision doc + implementation. |
| PR-4.7.9 | OpenAPI spec + cutover for Batch 7 | Spec merged; cutover. |

#### Cross-cutting (applies to every batch)
| ID | Story | Acceptance criteria |
|---|---|---|
| PR-4.X.1 | Author OpenAPI specs in `dex-api-specs` before each batch | No implementation begins without spec merged. |
| PR-4.X.2 | Publish v1 EOL date (12 months post-v2 GA) | Communicated to external integrators before Batch 1 deploy (see Epic 0 PR-0.12). |
| PR-4.X.3 | 30-day breaking-change notice process for v2 | Process documented; mailing list set up. |
| PR-4.X.4 | CODEOWNERS + module boundaries enforced | `.github/CODEOWNERS` covers `internal/service/<domain>/`, `internal/store/`, `internal/model/`. |

---

### EPIC 5 — Phase 5: Frontend Feature Migration
- **Goal:** Migrate all pages from admin-ui and pitstop-ui into `ui/apps/portal`, consuming v2 APIs.
- **Duration:** 4–6 weeks (Weeks 12–18)
- **Dependencies:** Phase 4 v2 API stable for the relevant domain.
- **Related Confluence:** [Migration strategies for core and ui repositories](https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/969768990)
- **Suggested labels:** `platform-rewrite`, `phase-5`, `portal-migration`

#### Stories (grouped by source UI)
| ID | Story | Acceptance criteria |
|---|---|---|
| PR-5.1 | Migrate admin-ui → `portal/src/modules/admin/participants/` | All v1 API calls replaced with v2; TypeScript; hooks (no class components); Zustand or Context (no Redux); Playwright E2E added. |
| PR-5.2 | Migrate admin-ui → `modules/admin/approval-requests/` | As above. |
| PR-5.3 | Migrate admin-ui → `modules/admin/user-management/` | As above. |
| PR-5.4 | Migrate admin-ui → `modules/admin/onboarding/` | As above. |
| **PR-5.5** | **Build unified Messages surface (concept-redesign per P7)** — replaces the originally-planned shared-data + received-data migration | One `/portal/<dex>/messages` route at `modules/participant/messages/` with stats strip, filter chips (4 flow-agnostic statuses), live pulse, time-series feed, owner badge on Failed, Message detail with flow-aware timeline (PUSH 4-stage / PULL 6-stage / STORE 4-stage), View delivery trace panel, Retry (with stale-retry confirm + bulk Retry), Close (with strong-confirm for Failed · your action + bulk Close + auto-close on Expired). v2 API: `/v2/messages` per [ADR 0020](./docs/adr/0020-unified-messages-surface.md), [ADR 0021](./docs/adr/0021-message-lifecycle-two-layer-model.md). |
| **PR-5.6** | **Build Agreement-anchored Message composer (concept-redesign per P8)** — absorbs both the originally-planned EForm and ETR migrations | One composer surface launched from Agreement detail with three flow-type variants (Send / Request / Stage), complexity-driven shape (single-page for `simple` elements / 3-step wizard for `high-stakes`), Acting-as banner for SP composing on data-owner's behalf, draft auto-save into `consent_message_draft` with decay-with-pin lifecycle, idempotency key generated at draft-open and threaded to Submit/Retry, fast-fail Submit with pre-emptive pitstop-availability detection and cross-Agreement fallback for SP outages, Edit & resend on Failed · your action Messages reusing the same draft + key. v2 API: `/v2/messages/compose` and `/v2/messages/drafts` per [ADR 0024](./docs/adr/0024-agreement-anchored-message-composer.md), [ADR 0025](./docs/adr/0025-data-element-compose-complexity-attribute.md), [ADR 0026](./docs/adr/0026-agreement-snapshot-immutability-schema-upgrade.md). |
| PR-5.7 | Migrate pitstop-ui → `modules/participant/configuration/` | All v1 API calls replaced with v2; TypeScript; hooks; Zustand or Context; Playwright E2E. |
| PR-5.8 | Migrate pitstop-ui → `modules/participant/dashboards/` | As above. |
| **PR-5.9** | **ETR-specific operations beyond compose** — restructured from the originally-planned full ETR module migration | ETR *issuance* and *amendment* are now in PR-5.6 (composer with `compose_complexity=high-stakes`). This Story covers the remaining ETR operations: transfer (handover to next holder), surrender (return to issuer), shred (destroy / cancel), endorsement chain visualisation, ETR list views. State transitions on existing ETR-class Messages — not creation. Lives at `modules/participant/etr/` for the non-compose flows. |
| PR-5.10 | Extract reusable components → `ui/libs/src/components/` (@dex/core-components) | Catalogue of shared components; existing per-dex apps refactored to use the library where overlap exists. |
| PR-5.11 | Implement portal session management | Token refresh, session timeout, multi-tab sync. |
| PR-5.12 | Implement TFA flow end-to-end in portal | Matches existing admin-ui flow. |
| PR-5.13 | Implement maker-checker UX in portal | All maker-checker flows from admin-ui ported. |
| PR-5.14 | Implement real-time notifications in portal | WebSocket or SSE; per-user filtering. |
| PR-5.15 | Update qa-playwright E2E tests for portal flows | Existing suite re-pointed at portal; coverage ≥ admin-ui + pitstop-ui combined. |
| PR-5.16 | Cutover plan: per-DEX feature-flag switch from old UI to portal | Per-DEX rollout; instant rollback via flag flip. |
| **PR-5.17** | **Notification cadence & Watch (per ADR 0023)** | Settings page with twice-daily Message digest toggles (default on; 8am + 1pm local), Watched-Agreement email toggle (default on), and per-channel opt-outs. Watch toggle on Agreement detail header (pill-shaped chip; per-user-per-Agreement state). Failed · your action Messages auto-route to inbox + count toward sidebar badge. v2 API: `/v2/notifications/preferences`, `/v2/agreements/:id/watch`. Lifecycle-reminder pattern (ADR 0010) explicitly scoped *out* for Message failures — Watch is the alternative mechanism. |
| **PR-5.18** | **Drafts surface — Agreements + Messages tabs** | Extend the existing Drafts screen with a Messages tab listing `consent_message_draft` rows for the current user. Per-draft actions: resume (opens composer prefilled with same idempotency key), pin/unpin (resets 30-day inactivity timer), discard. Auto-purge on Agreement end surfaces as a one-time toast or inbox card. Encryption AES-256-GCM with the Agreement key per ADR 0024. |
| **PR-5.19** | **Reconciliation affordance suppressed in v1 (per ADR 0022)** | Remove the `Reconcile with counterparty` CTA entirely from both the Messages list and Agreement detail. No disabled placeholder. Model is captured for Phase 8 implementation. Tracked here so QA doesn't flag the absence as a regression. |
| **PR-5.20** | **Agreement packs — multi-counterparty pack grouping (per ADR 0027)** | UI-layer grouping that lets N Agreements created together from a Data element pack share a parent `agreement_pack` record. Six deliverables: (a) wizard fork after Data element pack selection — *"same counterparty or split across counterparties?"* with element-to-counterparty mapping screen on split; (b) `agreement_pack` table + `consent_agreement.pack_id` FK column; (c) *Group by pack* toggle on the Agreements list with parent/child rendering; (d) new Pack detail page at `/portal/<dex>/packs/<id>` with derived status, member list, pack-level actions (Send pack, Revoke pack, Export); (e) Pack drafts tab on the Drafts screen; (f) Composer pack mode dispatching N Messages across pack members with N idempotency keys. The 1:1 cardinality rule (one Agreement, one counterparty) is preserved — each pack member is still its own Agreement. v2 API: `/v2/agreement-packs` + extension of `/v2/agreements/:id` response with `pack_id`. |

---

### EPIC 6 — Phase 6: Infrastructure Consolidation
- **Goal:** Eliminate the Central/Pitstop AWS account split.
- **Duration:** 4–6 weeks (Weeks 14–20)
- **Dependencies:** Phase 4 (v2 API) and Phase 2 (DB) stable.
- **Related Confluence:** [AWS_Central_to_Pitstop_Migration_Plan_v3](https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/1873805342), [Migration of admin portal to pitstop AWS account](https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/1340047383), [PROD migration of admin portal to pitstop AWS](https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/1878949890)
- **Suggested labels:** `platform-rewrite`, `phase-6`, `infra-consolidation`

#### Stories
| ID | Story | Acceptance criteria |
|---|---|---|
| PR-6.1 | Decision: VPC peering vs full account merger | Decision doc with security, compliance, and IAM blast-radius analysis. Single-account preferred. |
| PR-6.2 | Move admin ECS tasks into pitstop (or new consolidated) account | Cutover plan + execution; cross-account HTTPS calls eliminated from hot paths. |
| PR-6.3 | Cognito pool consolidation (per Epic 0 PR-0.11 decision) | Migration runbook; users migrated without password reset where possible. |
| PR-6.4 | Consolidate CloudFront distributions | One distribution per environment with path-based routing to portal + API. |
| PR-6.5 | Update `infra-terragrunt` to reflect new account/VPC topology | All TF state migrated; review by infra lead. |
| PR-6.6 | Update Secrets Manager references + IAM roles | Old cross-account roles removed; new roles least-privileged. |
| PR-6.7 | DNS cutover plan + execution | Route53 records updated; TTLs lowered ahead of cutover, restored after. |

---

### EPIC 7 — Phase 7: v1 Retirement & Cleanup
- **Goal:** Remove the v1 shim, decommission legacy services, archive old repos and tables.
- **Duration:** 2–4 weeks (Weeks 20–24)
- **Dependencies:** v2 GA in prod for all batches; external partners migrated.
- **Suggested labels:** `platform-rewrite`, `phase-7`, `cleanup`

#### Stories
| ID | Story | Acceptance criteria |
|---|---|---|
| PR-7.1 | Verify all portal + external clients on v2 | Traffic dashboards show zero requests on `/api/v1/` paths for 30 consecutive days. |
| PR-7.2 | Remove v1 shim route group from `be/admin-core/router.go` | Code deleted; tests removed; binary size reduced. |
| PR-7.3 | Archive old DB tables (`_archived_` prefix, 90-day retention, then drop) | Runbook + execution; DBA sign-off. |
| PR-7.4 | Decommission `admin-corev2` and `pitstop-core` as standalone services | ECS services scaled to zero; Lambda functions deleted; alarms removed; IaC repo archived. |
| PR-7.5 | Archive `admin-ui` and `pitstop-ui` repos (read-only) | GitHub repos set read-only; deploy keys revoked; CodePipelines deleted. |

---

### EPIC 8 — Post-Rewrite Extensions (concept-design follow-ons)
- **Goal:** Ship the v1-deferred extensions surfaced by the P7 + P8 concept-design grilling. Each Story here has an upstream platform dependency that doesn't exist in production today.
- **Duration:** TBD per Story; sequenced after Phase 7 v1 retirement so the new platform is stable first.
- **Dependencies:** All of Phases 0–7 complete. Cross-pitstop protocol work (DSV Phase 3 or successor) — currently tracked as **DEX-104** (idea, Ready for delivery).
- **Naming note:** the ADRs reference this as "Phase 6+" generically — meaning *post-core-rewrite*. This Epic 8 is the home for that work; the literal Phase 6 in the breakdown remains infrastructure consolidation.
- **Suggested labels:** `platform-rewrite`, `phase-8`, `post-rewrite`, `concept-extension`

#### Stories
| ID | Story | Acceptance criteria |
|---|---|---|
| PR-8.1 | **Cross-pitstop schema negotiation protocol** (depends on DSV Phase 3 / DEX-104) | Sender pitstop, receiver pitstop, and any SP agree on schema version at Agreement creation and exchange a compatibility matrix. Receiving pitstop accepts/rejects payload against the agreed version. Resolves the gap surfaced by CTD-10307 (post-hoc schema mismatch QA discovery). Confluence pages 915407031 (DSV scope) and 891453466 (cross-pitstop question). |
| PR-8.2 | **Schema-upgrade amendment workflow** (depends on PR-8.1) per ADR 0026 | Operator can request a schema upgrade on an active Agreement. All-parties handshake + re-consent capture + atomic snapshot replacement + backward-compat fallback. Audit trail records the schema progression. v1 escape (revoke-and-recreate) is deprecated when this ships. |
| PR-8.3 | **Bulk Compose & Send** (depends on PR-8.1 schema-aware infrastructure) per P8 brainstorm §10 round 8 | Multi-Agreement selector in Composer filtering to schema-identical Agreements (floor). Fan-out to N Messages sharing a bulk-action correlation ID, each with its own idempotency key. Partial-success result page. Stretch: per-Agreement form review for heterogeneity. |
| PR-8.4 | **Test-mode protocol** (depends on PR-8.1) per P8 brainstorm §10 round 7 | Cross-pitstop honoured `test_mode` flag. Test sends flow end-to-end without triggering counterparty downstream automation. Counterparty portal exposes a separate test inbox view. Audit trail records test sends with the flag. |
| PR-8.5 | **Cross-Agreement payload transfer for SP-outage fallback** (depends on PR-8.1) per ADR 0024 § Submit & failure handling | One-click switch from current Composer to alternative Agreement covering the same data element + counterparty. Schema-compatibility check; field mapping where snapshots match; clear error when they don't. |
| PR-8.6 | **Reconciliation diff view** (depends on PR-8.1 + per-Agreement counterparty-comparison API) per [ADR 0022](./docs/adr/0022-reconciliation-model.md) | Per-Agreement reconciliation UI surfacing three diff buckets (Match / Drift / Missing) with named drift sub-types. "Pull counterparty's status" one-way resolution affordance. CTA lives on Agreement detail page. Operator-initiated (not passive). |
| PR-8.7 | **Per-data-element criticality flag for selective escalation** per ADR 0023 § Phase 5+ enhancements | DEX-admin-level criticality flag on `data_element`. Failed · your action Messages where the element is criticality-tagged escalate per the lifecycle-reminder pattern (ADR 0010): inbox → +banner after 4h → +email after 8h. Auto-Watch derivation on Agreements involving criticality-tagged elements. |
| PR-8.8 | **Aggregate Failed-Message banner threshold** per ADR 0023 § Phase 5+ enhancements | When unresolved-Failed-Message count crosses a configurable threshold for an operator, a persistent banner appears across every portal page until the count drops. Threshold is per-org configurable; default values established after production observation. |
| PR-8.9 | **Mobile push for Watch** per ADR 0023 § Phase 5+ enhancements | Once a portal mobile shell exists, Watched-Agreement notifications can fire as push notifications in addition to inbox + email. Per-user opt-in. |

---

## 3. Open Decisions (cross-references Epic 0 PR-0.7 through PR-0.13)

| # | Decision | Recommendation (per source doc) | Owner | Resolve by |
|---|---|---|---|---|
| D1 | Portal sub-module ownership: A / B / C | **A — domain modules in monorepo** | Frontend lead + Eng lead | End of Phase 0 |
| D2 | DB migration option: A / B / C | **B for prod, evolve to C** | Infra lead + Eng lead | End of Phase 0 |
| D3 | AuditTrail merge strategy: unified table vs separate + view | TBD | Backend lead + DBA | End of Phase 0 |
| D4 | DynamoDB vs RDS for runtime config | Keep Dynamo unless consolidation simplifies ops | Infra lead | End of Phase 0 |
| D5 | Cognito pool consolidation: per-env vs per-dex | TBD — evaluate migration risk per dex | Auth/IAM lead | End of Phase 0 |
| D6 | v1 EOL date | 12 months post v2 GA — confirm with external partners | Product | Before Batch 1 deploy |
| D7 | Go producer/consumer scope | Unchanged in Phases 1–4; define update window for Phase 5+ | Backend lead | End of Phase 0 |

---

## 4. Risks & Mitigations (verbatim from source + extra context)

| Risk | Likelihood | Impact | Mitigation | Source evidence |
|---|---|---|---|---|
| Data loss during DMS migration | Medium | Critical | DMS full-load + CDC; ≥2-week shadow-read validation before write-cutover (PR-2.9) | [Database Migration Approach](https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/1489731587) documents FATAL_ERROR + ` ` failures from prior attempts |
| v1 shim in Go misses an edge case | High | High | Full E2E regression suite (admin-corev2 + qa-playwright) before each client migration (PR-4.X.4) | — |
| External integrators don't migrate in time | Medium | High | Publish v1 EOL 12 months in advance; offer migration tooling (PR-0.12, PR-4.X.2) | — |
| CPU spike from DB migration on Pitstop RDS | Low | High | MessageStore + pitstop AuditTrail frozen (PR-2.1); DMS off-peak windows | [DXT-47 RDS storage exhaustion](https://afa-cdi.atlassian.net/browse/DXT-47) — exact scenario that validates the freeze rule |
| Go producer/consumer interface changes | Medium | High | v2 API wraps Go services via internal calls; microservices untouched in Phases 1–4 (PR-0.13) | — |
| Team boundary conflicts | Low | Medium | CODEOWNERS + module boundaries + PR review policy (PR-4.X.4) | — |
| Consent model change breaks existing DER/SPR approvals | Medium | Critical | Keep old tables read-only (PR-3.6); consent_agreement created fresh; migrate after validation | [Dex Participant Onboarding & Relationship Consent Setup Improvement](https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/1302167573) |
| DynamoDB config tables not consolidated | Low | Medium | Keep DynamoDB as-is for runtime config; fold into RDS only if it simplifies operations (PR-0.10) | — |

---

## 5. Stakeholder Coordination (RACI)

| Workstream | Owner | Involved teams | Maps to Epic |
|---|---|---|---|
| Domain model & consent redesign | Product + Engineering lead | Business, UX, Engineering | Epic 0, Epic 3 |
| Portal scaffold + Nx setup | Frontend team | UI/UX, QA | Epic 1, Epic 5 |
| Go API expansion (be/admin-core) | Backend team | API team, integration partners | Epic 1, Epic 4 |
| DB migration scripts | DB-owning team | Both engineering teams | Epic 2 |
| v2 API design (OpenAPI first) | API team | Product, integration partners | Epic 4 (PR-4.X.1) |
| Infra consolidation | DevOps / Cloud team | Security, Compliance | Epic 6 |
| External partner communication | Product | BD, Partner success | Epic 0 PR-0.12 + Epic 4 PR-4.X.2 |

---

## 6. Indicative Timeline

| Phase | Weeks | Key dependency |
|---|---|---|
| 0 — Discovery | 1–3 | — |
| 1 — Portal & API scaffold | 3–6 | Phase 0 |
| 2 — DB consolidation | 4–14 | Phase 0 table audit |
| 3 — Domain model | 4–10 | Phase 0 domain workshop |
| 4 — v2 API (Go) | 6–14 | Phase 1 scaffold |
| 5 — Frontend feature migration | 12–18 | Phase 4 v2 API stable; **P7+P8 ADRs (0020–0026) signed off before PR-5.5/5.6 start** |
| 6 — Infra consolidation | 14–20 | Phase 4 API, Phase 2 DB |
| 7 — v1 retirement | 20–24 | All phases stable |
| 8 — Post-rewrite extensions | post-Phase-7 | All Phases 0–7 complete; **DSV Phase 3 / DEX-104** cross-pitstop protocol work (separate initiative) |

**Phase 0–7 total:** ~6 months. Strangler-fig means prod is never broken; each phase delivers independent value.

**Phase 8** is a separate post-rewrite initiative with its own sequencing — Stories ship as their upstream dependencies (cross-pitstop protocol work) become available.

---

## 7. Linked existing Atlassian artefacts

### Parent / discovery
- [CTD-8313 — Data Exchange phase 3 (Epic)](https://afa-cdi.atlassian.net/browse/CTD-8313) — natural parent for everything below; description already reads "Rewrite of whole platform to microservice architecture in golang"
- [DEX-15 — Platform Rewrite (Idea, Done)](https://afa-cdi.atlassian.net/browse/DEX-15) — original discovery item

### In-flight Phase 4 Stories (link as children of Epic 4 batches)
- [CTD-10245 — Refactor /api/v1/login](https://afa-cdi.atlassian.net/browse/CTD-10245) → Batch 1
- [CTD-10251 — Refactor api/v1/dex](https://afa-cdi.atlassian.net/browse/CTD-10251) → Batch 5
- [CTD-10252 — Refactor api/v1/org](https://afa-cdi.atlassian.net/browse/CTD-10252) → Batch 2
- [CTD-10397 — [ADMINCORE-Go] /org file handling](https://afa-cdi.atlassian.net/browse/CTD-10397) → Batch 2

### Related in-flight infra migration (Phase 6 evidence + risk learnings)
- [CTD-10366 — Pre-prod admin migration: Immediate next steps](https://afa-cdi.atlassian.net/browse/CTD-10366)
- [CTD-10184 — Batch 10: Pre-Prod Validation & Soak](https://afa-cdi.atlassian.net/browse/CTD-10184)
- [CTD-10180 — Batch 7B: Additional RDS Databases](https://afa-cdi.atlassian.net/browse/CTD-10180)

### Incidents that validate Phase 2's MessageStore / AuditTrail freeze rule
- [DXT-47 — RDS prod-database Storage Exhaustion (AAR)](https://afa-cdi.atlassian.net/browse/DXT-47)
- [Confluence page 1945665540 — RDS prod-database Storage Exhaustion: Incident Report & Recommendations](https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/1945665540)

### Concept-design grilling outputs (in this repo)
- [`portal_concept_brainstorm.md`](./portal_concept_brainstorm.md) — P3 / P5 / P6 brainstorm (Agreements + portal + cross-DEX)
- [`p7_data_exchange_brainstorm.md`](./p7_data_exchange_brainstorm.md) — Data exchange UX (rubric R7, 89/100)
- [`p8_manual_message_initiation_brainstorm.md`](./p8_manual_message_initiation_brainstorm.md) — Manual Message initiation (rubric R8, 92/100)
- [`portal_grilling_summary.md`](./portal_grilling_summary.md) — Cross-cutting handoff doc
- [`CONTEXT.md`](./CONTEXT.md) — Canonical vocabulary

### ADRs (in this repo, `docs/adr/`)
- [ADR 0007 — Agreement lifecycle state machine](./docs/adr/0007-agreement-lifecycle-state-machine.md)
- [ADR 0009 — Extend by action with business-continuity notification](./docs/adr/0009-extend-by-action-with-business-continuity-notification.md)
- [ADR 0010 — Lifecycle-reminder pattern (not framework)](./docs/adr/0010-lifecycle-reminder-pattern-not-framework.md) — scoped to deadline-driven events only; Messages explicitly out (see ADR 0023)
- [ADR 0013 — Data element picker browse with groups](./docs/adr/0013-data-element-picker-browse-with-groups.md) — snapshot semantics on Agreement creation
- [ADR 0020 — Unified Messages surface](./docs/adr/0020-unified-messages-surface.md) — drives PR-5.5
- [ADR 0021 — Message lifecycle two-layer model](./docs/adr/0021-message-lifecycle-two-layer-model.md) — drives PR-5.5
- [ADR 0022 — Reconciliation model](./docs/adr/0022-reconciliation-model.md) — drives PR-5.19 (suppress in v1) + PR-8.6 (Phase 8 build)
- [ADR 0023 — Message notification cadence](./docs/adr/0023-message-notification-cadence.md) — drives PR-5.17
- [ADR 0024 — Agreement-anchored Message composer](./docs/adr/0024-agreement-anchored-message-composer.md) — drives PR-5.6
- [ADR 0025 — Data element compose-complexity attribute](./docs/adr/0025-data-element-compose-complexity-attribute.md) — drives PR-5.6 (form-shape selection)
- [ADR 0026 — Agreement snapshot immutability; schema upgrades require revoke-and-recreate in v1](./docs/adr/0026-agreement-snapshot-immutability-schema-upgrade.md) — drives PR-5.6 (snapshot-only render) + PR-8.2 (amendment workflow)
- [ADR 0027 — Agreement pack: UI grouping for multi-counterparty pack scenarios](./docs/adr/0027-agreement-pack-multi-counterparty-grouping.md) — drives PR-5.20 (Agreement packs); preserves the 1:1 cardinality rule at the model level

### Background design context (Confluence)
- [Platform rewrite Initiative (source)](https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/1942290443)
- [Platform architecture — 22 Apr 2026](https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/1927381004)
- [Dex Technologies (Platform) overview](https://afa-cdi.atlassian.net/wiki/spaces/PKG/pages/1933115474)
- [Detailed Requirements for Centralised Log-In](https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/972881949)
- [Dex Participant Onboarding & Relationship Consent Setup Improvement](https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/1302167573)
- [Modules to refactor for separation of concerns](https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/526090270)
- [Migration strategies for core and ui repositories](https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/969768990)
- [Database Migration Approach](https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/1489731587)
- [AWS_Central_to_Pitstop_Migration_Plan_v3](https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/1873805342)
- [Migration of admin portal to pitstop AWS account](https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/1340047383)
- [PROD migration of admin portal to pitstop AWS](https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/1878949890)
- [Migration Plan — Updated](https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/1501691909)
- [DEX Message Store Storage Architecture Options Analysis](https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/1844445241)

---

## 8. Next steps to push to Atlassian (when you're ready)

1. Create 8 Epics in project **CTD** (or whichever project you choose) — link each to **CTD-8313** as parent.
2. Create Stories under each Epic using the IDs above as the local reference key (Jira will assign its own).
3. Link existing in-flight Stories (CTD-10245, CTD-10251, CTD-10252, CTD-10397) to **Epic 4 — Phase 4 v2 API** with the appropriate `batch-N` label.
4. For each Open Decision (D1–D7), create a Decision-type ticket (or Story with `decision` label) in Epic 0 — link to Confluence design doc once written.
5. Optional: publish a Confluence summary page in CDIT space, child of [Platform rewrite Initiative (1942290443)](https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/1942290443), linking back to every Epic.

When you give the word, I can push these to Jira/Confluence in one go using the Atlassian connector.

---

**Sources:**
- [Platform rewrite Initiative](https://afa-cdi.atlassian.net/wiki/spaces/CDIT/pages/1942290443/Platform+rewrite+Initiative) (uploaded source doc)
- [CTD-8313 — Data Exchange phase 3](https://afa-cdi.atlassian.net/browse/CTD-8313)
- [DEX-15 — Platform Rewrite](https://afa-cdi.atlassian.net/browse/DEX-15)
- All Confluence + Jira links referenced inline above.
