# Demo persona resolution via persona pill × URL DEX

The prototype rail (introduced 2026-05-17 by `2026-05-17-app-like-rbac-company-rail-cleanup.md`) exposes scene-switching to a demo controller via persona pills and scenario pills. After [ADR 0029](./0029-user-org-affiliation-as-n-to-m-with-embedded-dex-roles.md) restructures identity into a richer model (6 users, 3 operator-side affiliations, 3 DEXes, 6 scenarios), the rail has more dimensions to expose than it has surface area to host.

This ADR pins the rail's shape: **three persona pills (category-level) with DEX-aware user resolution.** The active human is *derived* from `(persona category, URL DEX)` rather than picked from a roster — the rail stays at 3 pills, the URL stays load-bearing for DEX context per ADR 0001, and the chrome's workspace pill carries the resolved user as a sub-label. To make this work cleanly, **Marcus is stripped to TX-only**: Bea handles BX, David handles HX, and each demo persona-on-DEX has exactly one coherent operator identity.

## Considered Options

- **Option 1 — Three persona pills, DEX-aware user resolution (chosen).** Rail stays at 3 pills (`participant` / `platform-admin` / `sp-operator`). The active user is derived: `(persona category, URL DEX) → user`. Switching DEX while the participant pill is active flips the chrome's user from Marcus → Bea → David transparently. A 200ms avatar cross-fade signals the switch to stakeholders.
- **Option 2 — Six user pills, DEX independent (rejected).** Replace persona pills with 6 user pills, one per seeded operator. Explicit, no surprise person-switching. Rejected because (a) Marcus/Bea/David are conceptually "the same persona across DEXes," and flattening them into peers in the rail loses that hierarchy, (b) 6 pills crowds the rail, (c) the URL would no longer carry the user dimension, decoupling rail state from URL state and breaking the shareability of links per ADR 0001.
- **Option 3 — Three persona pills with sub-selector dropdowns (rejected).** Persona pills expand into sub-selectors when clicked. Rejected because the sub-selector competes visually with the DEX switcher (also rail-adjacent), risking stakeholder conflation between "switch DEX" and "switch user." More rail chrome to maintain for marginal expressive gain.

## What "DEX-aware user resolution" means

| Persona pill | URL = `/portal/tx` | URL = `/portal/bx` | URL = `/portal/hx` | URL = `/portal/all` |
|---|---|---|---|---|
| Participant operator | **Marcus** (Cosco · TX Admin) | **Bea** (Cosco · BX Operation) | **David** (Cosco · HX Super) | Marcus (primary) |
| SP operator | **Pat** (CrimsonLogic · TX Admin) | n/a (Pat has no BX seat → router redirects) | n/a (Pat has no HX seat → router redirects) | Pat |
| Platform operator | **Sarah** (SGTradex platform) | Sarah | Sarah | Sarah |

The resolver consults `USER_ORG_AFFILIATIONS` for the given `personaType` (filtered by the affiliation's tier) and picks the user whose affiliation grants a seat on the URL DEX. When more than one matches (Sarah and Wei Lin both platform-tier on every DEX), the user's `primaryOrgId` plus the rail's last-chosen-user memory disambiguate.

## Marcus stripped to TX-only

The original prototype seeded Marcus with three roles — `tx: 'Admin User', bx: 'Operation User', hx: 'Super Admin'` — across all three DEXes. With DEX-aware resolution this is no longer needed and is actively harmful: a single human with three different role chips across DEXes produces the kind of display contradiction that erodes stakeholder confidence.

Phase 4 of the implementation plan removes Marcus's BX and HX entries. The corresponding demo personas are:

- **Bea Ho** (Cosco) — `dexRoles: { bx: 'Operation User' }`. Reuses the name "Bea" that already appears in the existing TX team inbox seed line ("Bea approved CrimsonLogic appointment for ABC Logistics") — that seed line is reattributed to the same Bea once she exists as a fixture.
- **David Kim** (Cosco) — `dexRoles: { hx: 'Super Admin' }`. New fixture for SGHealthdex.

The existing BX team inbox seed line "Wei Lin approved subcontractor onboarding" — which previously named someone who also appears in the platform inbox — is reattributed to Bea in the same pass. Wei Lin is anchored to her single canonical home: platform-tier SGTradex teammate.

## Chrome impact

Each persona-aware chrome component changes its behaviour. Decisions ratified during the grilling session:

| Component | Change | Rationale |
|---|---|---|
| **Workspace pill** | Always shows the resolved user as a sub-label ("Cosco Shipping" + "Marcus"), with a colleague chevron next to the avatar | Predictable chrome — sub-label is part of the "where am I" answer, not decoration |
| **Avatar** | 200ms cross-fade on user change | Small enough not to be theatre; large enough that the audience registers the change |
| **Profile menu** | Adds "Switch active org" row (gated by `affiliations.length ≥ 2`) and "Switch colleague" row (parallel to the workspace-pill chevron) | Two discovery paths for the same action; pill chevron is in-flow, menu row is via avatar |
| **Role chip** | Hides when `resolveSeat() === null` | Cleaner than rendering a "No access" chip on a screen the user shouldn't be on |
| **Capability gates** | Read role from `resolveSeat()` instead of `PERSONAS[currentPersona].role` | Wiring change only; semantics unchanged |
| **Sidebar** | On off-DEX navigation: auto-redirect for accidental landings, "switch colleague" CTA for cross-link entry | Honest display of the new model's answer ("you need a different person for this DEX") |
| **Rail caption** | Suffixes with the resolved user — e.g., *"Scenario C · Marcus (Cosco · SGTradex)"* | Surfaces the dispatch chain so demo controllers and audience never wonder who's on stage |

## Scenario pills gain a `dexes:` validity field

Existing scenario-pill validity gates on `(screen, persona)`. With DEX-aware user resolution, clicking a scenario pill while on the wrong DEX is silently a no-op (the persona resolves to the wrong user, scenario seed misses). To prevent this, every scenario entry in `MP_SCENARIOS` gains a `dexes:` field listing the DEXes the scenario can run on, and clicking a scenario pill while on an out-of-scope DEX **auto-navigates** to the first valid DEX.

Auto-navigation is preferred over disabling because the scenario's *point* is to land on a specific frame — the user clicked it to *see that scenario*, not to be told it isn't reachable from where they currently are. The user-name change is communicated via the avatar's 200ms cross-fade, the workspace pill sub-label update, and the rail caption update — three coordinated signals.

## Implementation phasing

Per Phase 4 of `2026-05-17-app-like-rbac-company-rail-cleanup.md` (extended at the end of the grilling session):

1. **Phase 4 (visible cut).** Strip Marcus's BX/HX roles; reattribute Wei Lin's BX seed line to Bea. Add bare-minimum auto-redirect for off-DEX navigation so a logged-in Marcus on `/portal/bx` doesn't render a broken "no access" state during the gap before Phase 5.
2. **Phase 5 (chrome polish).** Workspace pill sub-label, avatar cross-fade, profile menu colleague-switch row, role chip hide-on-empty, sidebar "switch colleague" CTA copy, rail caption suffix.
3. **Phase 6 (`SCENE_SEEDS` migration).** Rename keys to `<affiliationId>-<dexId>-<scenarioId>` per the affiliation-keyed shape. Add seeds for Bea (BX scenarios) and David (HX scenarios).

## Consequences

- **Marcus loses observable access to BX and HX.** Stakeholders who saw earlier demos with Marcus across all DEXes will see a different operator on BX/HX after Phase 4. The rail caption explicitly names the new operator ("Scenario A · Bea (Cosco · SGBuildex)") to head off the "what happened to Marcus" question.
- **`primaryOrgId` on `USERS`** becomes the resolver tiebreaker for users with multiple matching affiliations on the same DEX. Sparse today; future-proof.
- **Off-DEX-route handling** is now a real code path. Previously masked by Marcus's universal access; now exercised by every "wrong persona on this DEX" navigation. The Phase 4 auto-redirect is the minimum-viable gate; Phase 5 adds the CTA polish.
- **`ROLE_CAPABILITIES` lookup** moves to `resolveSeat().role`. No new capability strings; the lookup just goes through one more layer.

## Relationship to existing ADRs

- **ADR 0001** (URL-anchored DEX context) — strengthened. The URL was already load-bearing for DEX; it now also drives user resolution within a persona category.
- **ADR 0002** (Permission-scoped routes) — exercised. Off-DEX navigation now produces a meaningful redirect, not a wildcard-masked no-op.
- **ADR 0006** (Sidebar platform-defined with pin/hide) — unchanged. Sidebar items continue to gate on capability; the source of the capability shifts to `resolveSeat()`.
- **ADR 0029** (User–Org affiliation as N:M with embedded DEX roles) — required dependency. This ADR's resolver chain only works on the model that ADR 0029 introduces.
