# Agreement snapshot immutability; schema upgrades require revoke-and-recreate in v1

The data-element schema snapshot captured on `consent_agreement` at Agreement-creation time (per [ADR 0013](./0013-data-element-picker-browse-with-groups.md)) is **immutable for the life of the Agreement in v1**. The **Message composer** ([ADR 0024](./0024-agreement-anchored-message-composer.md)) renders strictly against that snapshot. There is **no in-place upgrade affordance** in v1; the only operator escape for working with a newer schema is to **revoke the Agreement and create a new one** with the latest data element version.

An amendment-and-renegotiation workflow that would allow live schema upgrade on an existing Agreement is captured as **Phase-6 work, dependent on cross-pitstop schema negotiation infrastructure that does not exist in production today.**

## The constraint we discovered

During P8 grilling round 2, we proposed an "Upgrade schema" affordance in the Composer — a banner that would let operators bump an Agreement to a newer data element version on demand, with explicit counterparty re-consent. Then we fact-checked against Atlassian and found:

- **CTD-10307** ("Done") — a DexConnect bug where extraction schema fields appeared in the wrong payload structure. Discovered in *QA*, not prevented by design contract. Payloads are not validated against an agreed schema version up front at the wire layer.
- **DSV Phase 2** (CTD-10228, CTD-10227, CTD-10242, CTD-10354 — Done / QA Done) — semantic versioning infrastructure is being built, but explicitly scoped to *internal admin* per Confluence page **915407031**. No cross-pitstop alignment.
- **Confluence page 891453466** — the team has raised the cross-pitstop-coordination question ("Single Pitstop for BCA users → that means there must be a way t[o]…") but the design is unspecified.
- **No formal ADR or RFC** for a cross-org schema negotiation protocol exists.

The implication: if our portal lets an operator compose a v2.4 payload but the receiver's pitstop (still on v2.1) cannot accept it, we ship a UI affordance that produces broken downstream Messages. The breakage is silent or post-hoc (the receiver's pipeline crashes, an automation downstream malfunctions, etc.). This is worse than not building the affordance at all.

## Considered Options

- **Option A — Compose-against-latest** — Composer always renders the current data element version. **Rejected**: violates ADR 0013's snapshot principle; counterparties' downstream automation breaks when fields they didn't consent to suddenly appear.
- **Option B — Snapshot-with-upgrade-affordance in v1** — Composer defaults to snapshot but offers an "Upgrade to v2.4" CTA that re-renders the form and (in spec) triggers counterparty re-consent. **Rejected**: cross-pitstop negotiation infrastructure to make this safe doesn't exist; the UI affordance would produce broken Messages.
- **Option C — Pure snapshot in v1, no upgrade affordance; revoke-and-recreate as escape (chosen)** — keeps the v1 portal honest about what the platform can do. The amendment-and-renegotiation flow ships in Phase-6 once the supporting infrastructure exists.

## What v1 ships

- **Composer renders strictly against `consent_agreement.element_schema_snapshot`** (or the equivalently-named column in the Phase-2 consolidated schema). This is exactly what [ADR 0013](./0013-data-element-picker-browse-with-groups.md) said the snapshot is *for*; this ADR adds the explicit Composer-rendering binding.
- **No "Upgrade schema" affordance** in the Composer. No banner, no upgrade CTA, no version picker.
- **Edit & resend** on a Failed · your action Message detail renders against the **same Agreement snapshot** as the original Compose. The Agreement snapshot does not change between the failed send and the re-send.
- **The v1 escape for an operator who needs a newer schema:** navigate to the Agreement, **Revoke**, then **Create a new Agreement** with the latest data element version. The new Agreement requires counterparty re-acceptance (a Pending → Active transition). Slow but legally clean and matches the snapshot principle.

## Phase-6 future work

A new Story in `platform_rewrite_breakdown.md`: **"Schema-upgrade amendment workflow"**. Scoped to ship only after the prerequisite cross-pitstop schema negotiation protocol exists (likely **DSV Phase 3** or successor).

The amendment workflow needs:

- **All-parties handshake protocol** — sender's pitstop, receiver's pitstop, and any SP confirm support for the new schema version before any data flows. Compatibility matrix lives somewhere accessible to all parties.
- **Re-consent capture from all parties** — a kind of Agreement amendment; audit-logged. Both data owner and counterparty must explicitly accept the new snapshot before it takes effect.
- **Snapshot replacement only after handshake + re-consent both succeed** — atomic update to `consent_agreement.element_schema_snapshot`. Failed handshake leaves the snapshot at the old version.
- **Backward-compatibility fallback** — if one party cannot support the new version, the Agreement falls back to the old snapshot (with a banner explaining why), or the amendment is rejected.
- **Audit linkage** — the new snapshot record references the previous one; auditors can trace the schema progression of an Agreement over its life.

Until that lands, the v1 escape (revoke-and-recreate) is the only path.

## Consequences

- **Operators on stale Agreements** compose with the snapshot schema — they don't see newer optional or required fields. If a regulation introduces a new required field, the existing Agreement is unaffected, but new Agreements created against the latest element version will include it. Operators with active Agreements that need the new field must revoke + recreate.
- **`consent_agreement.element_schema_snapshot` becomes a first-class read in the compose flow** — not just a record-keeping field. This may have indexing / read-performance implications during Phase 5 schema design.
- **Migration from `pitstop-ui` introduces a behaviour change** — the legacy EForm renders against the *current* data element version (`EFormRenderer` loads the latest schema at render time). After migration, the new portal renders against the snapshot. Customer-facing migration note: *"Forms that used to silently track schema changes will now be frozen at the version captured when the Agreement was created. To use a newer schema, recreate the Agreement."*
- **The cross-pitstop dependency is now explicit** — `platform_rewrite_breakdown.md` tracks DEX-104 / DSV Phase 3 as an upstream blocker on the schema-upgrade amendment Story.

## Risk for the §6 register

**DX-R7** (refined from the P8 brainstorm) — schema drift between an Agreement's snapshot and the current data element version. v1 mitigations: clear copy that explains the snapshot, prominent revoke-and-recreate workflow, link from the Agreement detail page to the latest version of the data element so operators can compare. Phase-6 mitigation: the amendment-and-renegotiation workflow.
