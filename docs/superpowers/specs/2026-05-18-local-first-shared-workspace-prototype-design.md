# Local-First Shared-Workspace Prototype Design

Date: 2026-05-18
Status: Draft validated in chat, ready for written review
Scope: `portal-app/` first vertical slice

## Summary

The prototype should behave like an app, not a scene projector. The live source of truth moves from per-screen scene recreation to a shared local workspace persisted in `localStorage`. The first vertical slice is Agreement-first:

1. Create or resume an `Agreement draft`
2. Complete the wizard with auto-save
3. Submit into a real `Agreement`
4. See the new `Agreement` in Inbox, Agreements, and Agreement detail
5. Reload and keep continuity
6. Use `Reset workspace` to restore demo fixtures

`SCENE_SEEDS` remains in the codebase, but only as a bootstrap adapter and demo-seeding library. It is no longer the live source of truth for normal app usage.

## Decisions Already Made

- Use a shared workspace, not isolated per-user stores
- Start with the Agreement-first loop
- Persist created records across reloads
- Restore demo fixtures only through an explicit `Reset workspace` action
- Keep prototype controls, but demote them into a small `Demo tools` drawer

## Goals

- Make the prototype feel like a local-first app with continuity across screens and reloads
- Keep `Draft` separate from `Agreement`, matching the domain glossary
- Concentrate reads and writes behind one deep module so screens stop mutating the DOM ad hoc
- Preserve fast demo setup through a `Demo tools` drawer without letting demo controls define normal app behavior
- Land the first believable end-to-end loop without rewriting the whole prototype at once

## Non-Goals

- No full replacement of every existing scene, state-switcher, or Message flow in the first cut
- No server API, sync engine, or multi-browser collaboration
- No full schema normalization for every legacy prototype concept
- No attempt to make every Agreement detail state editable through normal product UI in this slice
- No full Message-composer runtime yet; Message work follows after the Agreement-first slice proves the seam

## Approaches Considered

### Option 1 — Local-first app runtime over fixture bootstrap

Add a workspace module backed by `localStorage`, convert fixtures into bootstrap data, and make screens read and write through the workspace.

Why chosen:

- Highest leverage for the smallest interface
- Best match for "behaves like an app"
- Lets the current UI survive while changing the seam underneath it

### Option 2 — Hybrid runtime

Make only Drafts and Agreements real, while keeping most other screens scene-driven.

Why rejected:

- The seam stays shallow because callers still need to know which screens are "real" and which are recreated
- Easy to accumulate more mixed ownership and harder to reason about later

### Option 3 — Full rewrite to app-state first

Replace the scene projector and imperative detail/message mutators in one pass.

Why rejected:

- Higher risk than the first slice needs
- Slower path to the first convincing workflow

## Chosen Architecture

The new deep module is the workspace runtime. Its interface owns loading, querying, mutating, seeding, and resetting the prototype state.

The live seam becomes:

- `loadWorkspace()`
- `saveWorkspace(workspace)`
- `resetWorkspace()`
- `createAgreementDraft(context)`
- `updateAgreementDraft(draftId, patch)`
- `submitAgreementDraft(draftId)`
- `getInboxView(context)`
- `getAgreementsView(context)`
- `getAgreementDetail(agreementId, context)`
- `applyDemoSeed(seedId, opts)`

Callers cross this seam. They do not mutate screen DOM directly to "fake" state changes.

### Module Shape

Keep the implementation small and file-based so it fits the current no-build architecture:

- `portal-app/scripts/workspace-storage.js`
  - `localStorage` read/write
  - schema versioning
  - corruption fallback
  - reset/import
- `portal-app/scripts/workspace-bootstrap.js`
  - converts fixtures into a fresh workspace
  - adapts `SCENE_SEEDS`, `INBOX_BY_DEX`, and any static list fixtures into records
- `portal-app/scripts/workspace.js`
  - in-memory workspace cache
  - query helpers
  - mutation actions
- Existing UI modules become adapters:
  - `wizard.js` reads and writes `Agreement draft`
  - `theme.js` and `app.js` read workspace queries instead of scene fixtures for normal app screens
  - `applyScene()` becomes a demo adapter that writes through the workspace instead of repainting the DOM as the primary path

### Why This Module Is Deep

Today the prototype leaks complexity across many callers:

- `SCENE_SEEDS` decides what a screen is
- `renderScreenFromSeed()` rebuilds DOM from fixtures
- `setDetailState()` and `setMessageFlow()` mutate live screens in place
- buttons often act by injecting markup or swapping text directly

After this change, callers learn one interface: query current records, dispatch an action, re-render from stored state. The implementation can stay internally composed, but the interface becomes much smaller and more stable.

That increases:

- **Leverage**: one mutation path updates every screen that depends on the record
- **Locality**: storage, bootstrap, reset, and mutation bugs live in one place

## Workspace Data Model

Persist one JSON document under `localStorage["dex-portal-workspace"]`.

```json
{
  "schemaVersion": 1,
  "seededAt": "2026-05-18T00:00:00.000Z",
  "meta": {
    "activeUserId": "marcus",
    "activeDexId": "tx",
    "darkMode": false,
    "demoToolsOpen": false
  },
  "agreementDrafts": {},
  "agreements": {},
  "inboxItems": {},
  "indexes": {}
}
```

### `Agreement draft`

`Agreement draft` remains separate from `Agreement`.

Proposed record shape:

```json
{
  "draftId": "draft-agr-0001",
  "operatorId": "marcus",
  "orgId": "cosco",
  "dexId": "tx",
  "type": "DIRECT",
  "direction": "send",
  "dataElement": {
    "name": "Vessel arrival pack",
    "detail": "Data element pack · 4 elements: ETA, Vessel particulars, Crew list, Cargo manifest"
  },
  "counterparty": {
    "name": "Maersk Logistics Pte Ltd",
    "detail": "Carrier · UEN 200512345R · TradeX · Ready for B/L sharing"
  },
  "terms": {
    "durationMonths": 12,
    "residency": "standard",
    "crossDex": false
  },
  "status": "draft",
  "createdAt": "2026-05-18T10:00:00.000Z",
  "updatedAt": "2026-05-18T10:05:00.000Z"
}
```

Rules:

- Operator-private
- Shown in the Drafts screen only for the owning operator
- Auto-saved during wizard progress
- Deleted from `agreementDrafts` immediately after successful submit

### `Agreement`

Shared workspace record created from a submitted `Agreement draft`.

Proposed record shape:

```json
{
  "agreementId": "AGR-2026-5801",
  "sourceDraftId": "draft-agr-0001",
  "dexId": "tx",
  "state": "pending",
  "type": "DIRECT",
  "direction": "send",
  "operatorOrgId": "cosco",
  "counterpartyOrgName": "Maersk Logistics Pte Ltd",
  "title": "Vessel arrival pack with Maersk Logistics",
  "dataElementSummary": {
    "name": "Vessel arrival pack",
    "detail": "Data element pack · 4 elements"
  },
  "terms": {
    "effectiveFrom": "18 May 2026",
    "durationMonths": 12,
    "residency": "standard"
  },
  "activity": [
    {
      "kind": "agreement-created",
      "actorUserId": "marcus",
      "ts": "2026-05-18T10:06:00.000Z"
    }
  ],
  "createdAt": "2026-05-18T10:06:00.000Z",
  "updatedAt": "2026-05-18T10:06:00.000Z"
}
```

Rules:

- Shared across the workspace
- Visible on relevant list/detail screens after creation
- First slice supports real persisted `pending` records only for newly created Agreements
- Existing richer lifecycle variants can still be reached through Demo tools

### `Inbox item`

For the first slice, persist inbox items rather than deriving every Inbox state on the fly.

Reason:

- Lower implementation cost in the current prototype
- Keeps the app feeling believable immediately
- Allows future actions like claim/dismiss without re-deriving a larger obligation model yet

Proposed record shape:

```json
{
  "inboxItemId": "inbox-agr-AGR-2026-5801-mine",
  "agreementId": "AGR-2026-5801",
  "ownerUserId": "marcus",
  "dexId": "tx",
  "bucket": "mine",
  "title": "Your Agreement with Maersk Logistics is awaiting review",
  "meta": "Sent just now · pending counterparty action",
  "status": "open",
  "createdAt": "2026-05-18T10:06:00.000Z"
}
```

### `meta`

`meta` stores shared workspace UI/session state:

- `activeUserId`
- `activeDexId`
- `darkMode`
- `demoToolsOpen`

Migration note:

- On first runtime migration, if legacy `dex-portal-dark` exists, import it into `meta.darkMode`

## Bootstrap, Reset, and Fixtures

Fixtures still matter, but only as adapters behind the seam.

### First load

On first load, or when the stored workspace is absent, bootstrap from fixtures into the shared workspace document.

### Reset

`Reset workspace` deletes the live workspace document and rebuilds it from bootstrap fixtures.

### `SCENE_SEEDS`

`SCENE_SEEDS` remains for two purposes only:

- seed library for the reset/bootstrap path
- demo seeding for special cases

It is not the normal read path for Agreements, Drafts, Inbox, or Agreement detail after the first slice lands.

## First Vertical Slice

### Normal user path

1. Operator opens `+ New Agreement` or resumes a `Draft`
2. The app creates or loads an `Agreement draft`
3. Wizard steps write into that draft record
4. Draft is auto-saved as the operator moves through the flow
5. Submit transforms the draft into a new `Agreement`
6. Submit also creates the matching inbox item
7. App navigates to the new Agreement detail screen
8. Agreements list and Inbox reflect the created record
9. Reload preserves the record because the workspace is persisted

### Scope boundary for the slice

Newly created Agreements behave as real stored `pending` records.

They do not yet support every historical prototype state through the normal UI. That behavior stays in Demo tools until later slices deepen the Agreement runtime further.

## Screen Ownership After the Slice

### Drafts

Reads `agreementDrafts` for the active operator only.

### Wizard

Reads and writes the current `Agreement draft`. The in-memory `wiz` object becomes a transient UI adapter, not the source of truth.

### Agreements list

Reads workspace `agreements`, filtered by active user context and DEX.

### Inbox

Reads persisted `inboxItems` filtered by active user context and DEX.

### Agreement detail

Reads one stored `Agreement` by `agreementId`. The primary normal-state render comes from the record, not from `setDetailState()`.

## Demo Tools Drawer

The current prototype controls stay, but behind a compact `Demo tools` drawer.

### Drawer responsibilities

- `Reset workspace`
- `Seed scenario`
- `Switch active user`
- `Switch active DEX`
- `Open inspectors / state variants`

### Rules

- Demo tools write through the workspace seam
- Demo tools do not directly mutate visible screen DOM as a special path
- In-screen state-switchers and rail controls are hidden from normal use
- State forcing remains available only inside Demo tools mode

### Result

The app feels real during normal navigation, but demo setup is still fast for review sessions.

## Error Handling

### Corrupt or invalid storage

If `dex-portal-workspace` cannot be parsed, or `schemaVersion` is unsupported:

1. Copy the raw payload to `dex-portal-workspace-corrupt-<timestamp>`
2. Rebuild a fresh workspace from bootstrap fixtures
3. Show a toast explaining that the local workspace was reset

### Missing records

If a route points to a missing `Agreement draft` or `Agreement`:

- redirect to the relevant list page
- show a small toast, not a blank broken screen

### Save discipline

Every workspace mutation writes through one save path. No action should update the DOM and skip persistence.

## Testing Strategy

The interface is the test surface.

### Tests to add in the first slice

- bootstrap creates a valid workspace when storage is empty
- `createAgreementDraft()` creates an operator-private draft
- `updateAgreementDraft()` persists wizard changes
- `submitAgreementDraft()` creates one `Agreement`, deletes the submitted draft, and creates inbox/list records
- reload uses persisted workspace instead of reseeding fixtures
- `resetWorkspace()` restores the fixture baseline

### UI verification targets

- `Drafts` screen shows live draft records
- `Agreements` screen shows newly created `pending` Agreement after submit
- `Inbox` shows the new item after submit
- `Agreement detail` opens the stored `Agreement`

## Implementation Constraints

- Keep the no-build, file-loaded architecture
- Prefer additive modules over another large `app.js` expansion
- Preserve the existing visual language and screen structure
- Avoid rewriting Message flows in the first slice
- Keep legacy fixture utilities (`seed-doctor`, coverage helpers, scene scaffolds) focused on demo/bootstrap use

## Exit Criteria

This design is complete when the first slice can truthfully demonstrate:

- A shared workspace persisted in `localStorage`
- Real `Agreement draft` creation and resume
- Real `Agreement` creation from the wizard
- Real Agreement visibility in Drafts, Inbox, Agreements, and Agreement detail
- Reload continuity
- An explicit `Reset workspace`
- Demo controls demoted behind a `Demo tools` drawer

At that point, the prototype is no longer pretending to be an app. It is a local-first app prototype with demo adapters.
