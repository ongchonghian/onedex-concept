# Prezi Import Guide — Portal Rewrite Pitch

How to author the management-approval Prezi using the content I've already built in this repo. Pair this with `portal-rewrite-keynotes.md` (the 28-minute speaker script).

**The plan:** sign in to Prezi.com → New presentation → blank canvas → drop in each of the 11 slide compositions below → source imagery via Prezi's library, Unsplash, or AI generation using the prompts in each build sheet → wire the camera path in the order at the bottom. Total authoring time: ~90–120 minutes.

---

## The metaphor: The Port

The pitch is structured around a maritime port. The reasons are direct, not decorative:

- **Singapore is a port nation.** Every leader in the room has the visual vocabulary.
- **TraDex is literally a maritime data exchange.** Buildex, Healthdex, future DEXes all follow the same "regulated data flowing between counterparties" shape — the port is a port whether the cargo is containers, building materials, or patient records.
- **The cast already matches.** Harbormasters, dock workers, customs officers, shipping agents, captains, pilots. They map cleanly onto operators, DEX admins, service providers, platform admins.
- **The artefacts already match.** Bills of lading = Agreements. Manifests = Messages. Berths = inboxes. Stamps = approvals. Beacons = decisions.

Every slide below is a different location in the port. Reuse postal-style colour cues (deep navy + warm sodium light + signal red + brass) and maritime motifs (containers, gantry cranes, lighthouse, navigation charts, ship silhouettes) throughout.

## Spatial map (Prezi's canvas)

Prezi uses a free-positioning canvas — drop each slide anywhere in 2D space, then the camera flies between them. Use this layout:

```
                         ┌────────────────────────────────┐
                         │  06  THE PORT AUTHORITY HQ      │
                         │  Three departments              │
                         │  (Work · Exchange · Directory)  │
                         └────────────────────────────────┘
                                       ▲
                                       │
       WEST QUAY                       │                  EAST QUAY
   (customer journey,                  │             (rollout journey,
    top → bottom)                      │              top → bottom)
                                       │
   ┌───────────────────┐               │              ┌───────────────────┐
   │ 02  MANIFEST      │               │              │ 07  DEPARTURE     │
   │     OFFICE        │               │              │     SCHEDULE      │
   │ 5 forms → 1       │               │              │ v1 vs deferred    │
   └───────────────────┘               │              └───────────────────┘
   ┌───────────────────┐ ┌─────────────────────────┐  ┌───────────────────┐
   │ 03  BILL OF       │ │  01  THE HARBOR          │  │ 08  PILOT BOAT    │
   │     LADING DESK   │ │  Ten kinds of cargo      │  │     CHANNEL       │
   │ Consent ≠ action  │ │  backed up at ten berths │  │ Soft landing for  │
   └───────────────────┘ │  (THE OPENING SLIDE)     │  │ incumbent ships   │
                         └─────────────────────────┘  └───────────────────┘
   ┌───────────────────┐               ▲              ┌───────────────────┐
   │ 04  PIER CROSSING │               │              │ 09  WELCOME PIER  │
   │ Operator 7→5      │               │              │ Empty → ready     │
   └───────────────────┘               │              └───────────────────┘
   ┌───────────────────┐               │              ┌───────────────────┐
   │ 05  HARBOURMASTER │               │              │                   │
   │     OFFICE        │               │              │  (East quay ends  │
   │ Admin 9→5         │               │              │   one slot short  │
   └───────────────────┘               │              │   on purpose —    │
                                       │              │   visual asymmetry│
                                       │              │   funnels the eye │
                                       │              │   toward the      │
                                       │              │   Council Room.)  │
                                       │              └───────────────────┘
                              ┌────────────────────────────────┐
                              │  11  THE CAPTAIN'S COUNCIL      │
                              │  Three approval stamps          │
                              │  A · B · C                      │
                              └────────────────────────────────┘
```

**Camera order:** 0 (aerial overview · wide shot of the harbor) → 1 (The Harbor) → 2–5 (West Quay, top→bottom) → 6 (Port Authority HQ, big swing up to centre) → 7 (East Quay top) → 8 → 9 → 10 (the bridge between East Quay and the Council) → 11 (The Captain's Council, tight dive-in).

---

## Slide-by-slide build sheet

Each slide gives you: **title** (large on the slide) · **eyebrow** (small label above) · **body** (the actual content) · **suggested visual** (with an AI-image prompt) · **time on slide** (matches the keynote).

### Slide 0 · The Port — aerial overview (the opening dive-in)

- **Title (centred, large):** Portal Rewrite
- **Subtitle:** Ten frictions backed up at the harbour. Eleven berths to clear them.
- **Audience caption (small):** Dex Technologies leadership · May 2026
- **Suggested visual:** A bird's-eye view of a stylised modern port at golden hour. Container ships at multiple berths, gantry cranes silhouetted against a warm sky, a lighthouse on the breakwater, navigation lights blinking on a channel that opens to a sea. Thumbnail tiles of the 11 slides arranged around the central view in the map shape above. Small icons floating at the periphery: a container ship (TradEx), a tower crane (Buildex), a hospital cross (Healthdex).
- **AI prompt to generate the aerial:**
  > "Cinematic isometric illustration of a stylised modern maritime port at golden hour, seen from above. Container ships docked at eleven numbered berths radiating from a central control tower, gantry cranes silhouetted, a lighthouse on the breakwater, navigation lights along a channel opening to the sea. Warm sodium light + deep navy water + signal red accents. Container ship + tower crane + medical cross icons floating at the periphery. Clean editorial style, no readable text in the image, 16:9 aspect ratio."
- **Time on slide:** ~60 sec (the opener line from `portal-rewrite-keynotes.md`)

### Slide 1 · The Harbor — Section 00 — Ten frictions

- **Eyebrow:** 00 · The Harbor · Why this needs leadership attention
- **Title (large):** Ten kinds of cargo. Ten berths backed up.
- **Subhead:** Five paid by the ships that arrive · Five paid by the staff that work the dock.
- **Body (two rows of five cargo-stacks each):**

  | West Quay · ships at the customer berths | East Quay · cargo at the staff berths |
  |---|---|
  | Operator · *retention risk* | BD · *pipeline velocity* |
  | Service Provider · *audit exposure* | Product · *roadmap drag* |
  | DEX admin · *time-to-market* | Engineering · *catalogue relay* |
  | Platform admin · *activation drop-off* | UIUX · *surface-area sprawl* |
  | Pack dispatcher · *top-account ceiling* | Ops · *ticket & change load* |

- **Closing pull-quote:** *"The ships pay the demurrage. We pay the dockhands."*
- **Suggested visual:** Wide hero illustration of a busy container yard with two parallel quays. West quay: five container ships waiting at five berths, manifests stacking up uncleared. East quay: five staff berths with sorting stations, paperwork piling up at each. Containers stacked in queues, idle cranes.
- **AI prompt:** "Wide cinematic illustration of a busy maritime container terminal seen from a low angle. Two parallel quays. Left quay: five container ships waiting at numbered berths, customs paperwork visibly stacked at each gangway, no movement. Right quay: five staff sorting stations behind the customs warehouse, paperwork piling on each desk. Containers stacked into queues, idle gantry cranes. Warm sodium dockside light + deep navy water + signal red containers. Editorial illustration, no readable text, 16:9."
- **Time on slide:** ~8 min — *this is the core pitch. Let the slide breathe.*

### Slide 2 · The Manifest Office — Section 01 — 5 → 1

- **Eyebrow:** 01 · West Quay · Upstream of compose
- **Title:** Five paperwork types collapse into one.
- **Body (funnel diagram):**
  - Left side (five stacked document labels): Subscription · DER · SPR · Tripartite · Direct
  - Funnel arrow
  - Right side (one large document label): **AGREEMENT**
- **Pull-quote:** *"One bill of lading. One filing. One lifecycle."*
- **Suggested visual:** A vintage-modern manifest office. Five different paperwork types (bill of lading, commercial invoice, packing list, certificate of origin, customs declaration) being fed into a single processing window. A single standardised digital manifest emerging on the other side.
- **AI prompt:** "Maritime manifest office interior. A wooden counter with five different paperwork types stacked in five labelled trays on the left. A processing window in the centre. A single standardised digital tablet manifest emerging on the right side. Customs officer mid-action. Warm brass + cream walls + signal red trim. Editorial illustration style, no readable text, 16:9."
- **Time:** ~2 min

### Slide 3 · The Bill of Lading Desk — Section 02 — Consent ≠ Action

- **Eyebrow:** 02 · West Quay · The shift, downstream
- **Title:** The bill of lading is signed once. The cargo moves every day.
- **Body (paired blocks):**
  - **Consent** (signed once) — at Agreement creation, the BoL is stamped with terms · who can send · what · under what residency
  - ≠
  - **Action** (cargo moves) — for every Message, operator just declares the contents · system enforces the BoL's terms
- **Pull-quote:** *"The structural shift. Not a UI re-skin."*
- **Suggested visual:** Two-panel composition. Left: a wax-sealed bill of lading on a wooden desk, signature drying, lamp lit (the contract decided). Right: a stream of containers being craned onto a ship — each container distinct, but all moving under the same stamped authority.
- **AI prompt:** "Diptych editorial illustration. Left panel: a vintage bill of lading on a wood desk, fresh wax seal and signature, brass desk lamp warm light. Right panel: same harbour at dawn, containers being craned onto a ship under the same stamped authority — multiple containers, single contract. Warm wood + signal red wax + deep navy water. No readable text, 16:9."
- **Time:** ~2 min

### Slide 4 · The Pier Crossing — Section 03 — 7 → 5 operator

- **Eyebrow:** 03 · West Quay · One task, two journeys
- **Title:** Send a cargo manifest to Maersk.
- **Body (before/after pair):**
  - **Today** — 7 steps · refresh-to-verify · EForm-vs-ETR vocabulary · *(7 stamping stations)*
  - → arrow →
  - **New portal** — 5 steps · live timeline · 1 vocabulary · *(5 stamping stations)*
- **Pull-quote:** *"Same task. Two fewer translation steps."*
- **Suggested visual:** A pier crossing scene, two angles side by side. Left: cluttered customs hut, the operator presents paperwork at seven different windows, frustrated. Right: a clean modern customs counter, five neat windows, operator calm, manifest scanned once and moving through.
- **AI prompt:** "Two-panel maritime customs scene. Left panel: cluttered 1970s pier customs hut, operator presenting paperwork at seven different stamping windows, frustrated. Right panel: clean modern pier customs counter, same operator, five neat windows, paperwork moving smoothly. Same person, two experiences. Warm sodium dockside lighting, kraft + signal red palette. Editorial illustration, no readable text, 16:9."
- **Time:** ~2 min

### Slide 5 · The Harbourmaster's Office — Section 04 — 9 → 5 admin

- **Eyebrow:** 04 · West Quay · Same story, for the admins
- **Title:** Register a new declaration template.
- **Body (versus block):**
  - **9 steps** · 4 actor types · *days → weeks*
  - → arrow →
  - **5 steps** · 1 harbourmaster · *minutes*
- **Pull-quote:** *"Smart Start drafts. Test-as-operator verifies. The catalogue relay is gone."*
- **Sarah's line (read aloud, source: `portal-rewrite-keynotes.md`):** *"Every quarter I open three tabs — the Confluence requirements page, the BD spec sheet, the IMDA standard — and hand-translate them into a schema."*
- **Suggested visual:** A harbourmaster's office. Left: chaotic — four uniformed staff in a relay around a paperwork-strewn desk passing files (customs clerk → developer → tech lead → operations), calendar showing days/weeks crossed off. Right: one harbourmaster at a single modern screen, schema authored in minutes, calendar showing one day.
- **AI prompt:** "Two-panel harbourmaster's office. Left: chaotic four-person uniformed staff relay around a paperwork-strewn wood desk, calendar wall showing days and weeks crossed off, dim warm light. Right: single calm harbourmaster at a clean modern workstation with a glass-fronted port view, calendar showing minutes. Brass + navy uniform + warm wood + signal red accents. Editorial illustration, no readable text, 16:9."
- **Time:** ~2 min · *most important storytelling slide for the BD audience — invest visual care here.*

### Slide 6 · The Port Authority HQ — Section 05 — Three departments

- **Eyebrow:** 05 · The Port Authority HQ · The new mental model
- **Title:** Three questions. Three departments.
- **Body (three pillars):**
  - **WORK** · *"What needs my attention?"* · Inbox · Drafts
  - **EXCHANGE** · *"What's the business state?"* · Agreements · Messages
  - **DIRECTORY** · *"What are the building blocks?"* · Data elements · Participants
- **Suggested visual:** Three large brass-handled wooden doors in a marble-floored Port Authority foyer, each with a polished brass nameplate. Each door slightly ajar, revealing a hint of what's inside (a wall of inboxes for Work, a wall of shipping ledgers for Exchange, a wall of indexed drawers for Directory).
- **AI prompt:** "Three large mahogany doors in a row in a marble-floored Port Authority HQ foyer. Each door has a polished brass nameplate at eye level (leave the plates blank — I will overlay the labels). Each door slightly ajar, golden light spilling out, hint of activity behind. Warm brass + cream marble + deep navy carpet runner. Editorial illustration, no readable text, 16:9."
- **Time:** ~1 min

### Slide 7 · The Watchtower & Beacons — Section 06 — Ten decisions

- **Eyebrow:** 06 · The Watchtower · Ten decisions that shape the experience
- **Title:** Ten beacons. Each cancels a tax from the harbour.
- **Body (list of ten as numbered beacons):**
  01. Inbox is the home berth
  02. One page for sent and received
  03. One status vocabulary
  04. Composing happens under an Agreement
  05. Agreement terms frozen at acceptance
  06. Notifications match the stakes
  07. Multi-counterparty distributions are one gesture
  08. Operators describe their own side
  09. Admins author elements themselves
  10. Brand-new orgs land on pre-staged work
- **Caption:** *"Read each as: because the ships pay X today, we lit beacon Y."*
- **Suggested visual:** A lookout point on the breakwater at dusk. Ten lit beacons / navigation lights arranged in a constellation across the harbour mouth, each labelled with a number on a small brass plate at its base. Lighthouse rotating in the background. Warm vs. cool palette: warm beacons against deep navy dusk.
- **AI prompt:** "A lookout point on a maritime breakwater at dusk. Ten lit beacons / navigation lights arranged in a loose constellation across the harbour mouth — each beacon distinct, on a low stone pillar with a small brass numbered plate at its base (leave numbers blank). A lighthouse rotating in the background. Warm signal red + amber beacon glow against deep navy dusk sky and water. Editorial illustration, no readable text, 16:9."
- **Time:** ~3 min

### Slide 8 · The Departure Schedule — Section 07 — v1 vs deferred

- **Eyebrow:** 07 · East Quay · What launches first vs what's deferred
- **Title:** Honest scoping.
- **Body (two boards):**
  - **Leaving on the tide (v1 · 6 months):** One portal · Inbox home · One Messages page · Live timeline · One Composer + auto-review · Watch toggle · Cross-network warnings · Settings → Pitstops
  - **Waiting in the holding bay (deferred · needs platform):** Schema-negotiation handshake · In-place Agreement amendments · Bulk send · Test mode · Org-wide failure banner · Mobile push
- **Pull-quote:** *"The deferred items all wait on one shared coordination layer."*
- **Suggested visual:** A large departure board on the wall of a port operations centre. Two columns of paper schedule cards. Left column under "DEPARTING THIS TIDE": green flag stickers. Right column under "HOLDING BAY": grey flag stickers. A dispatcher in the foreground reviewing the board with a clipboard.
- **AI prompt:** "Port operations centre. A large wooden departure board on the wall with two vertical columns of paper schedule cards. Left column labelled with a green flag header, eight cards. Right column labelled with a grey flag header, six cards. A dispatcher in the foreground reviewing the board with a clipboard. Warm sodium overhead light, deep navy walls, brass fittings. Editorial illustration, no readable text, 16:9."
- **Time:** ~2 min

### Slide 9 · The Pilot Boat Channel — Section 08 — Soft landing for incumbents

- **Eyebrow:** 08 · East Quay · Rollout day, for users already on the network
- **Title:** Migration is a pilot's job. Not a flag-day.
- **Body (three guarantee cards):**
  - 🧭 **Old routes still resolve** — Legacy URLs redirect to their new home automatically
  - ⚓ **Cargo in transit carries over** — In-progress Agreements + Messages appear at the same stage
  - 📜 **One pilot's briefing** — Dismissible, audit-logged, gone after first acknowledgement
- **Suggested visual:** A pilot boat alongside a large incoming container ship at dusk, guiding it through the harbour entrance. The new harbour entrance visible in the background — wider, better lit. A pilot at the helm of the smaller boat handing over routing instructions to the captain on the larger ship.
- **AI prompt:** "A pilot boat alongside a large container ship at dusk, guiding it through a redesigned harbour entrance. Pilot at the helm of the smaller boat. Wider harbour mouth and brighter beacons visible ahead. Calm sea, warm dusk sky, navigation lights blinking. Editorial illustration, navy + amber + signal red palette, no readable text, 16:9."
- **Time:** ~1 min

### Slide 10 · The Welcome Pier — Section 09 — Empty → ready

- **Eyebrow:** 09 · East Quay · Day one, for orgs joining the network
- **Title:** Empty berth → ready berth.
- **Body (two-panel comparison):**
  - **Today:** Empty berth · new ship arrives · nothing on the dock · subtitle: *"Where do I tie up?"*
  - → arrow →
  - **New portal:** Same berth, pre-stocked — labelled cargo lots laid out on the dock (Cargo manifest, B/L, Vessel arrival pack, +5 more) · subtitle: *"Welcome. 8 cargo lots ready for review."*
- **Pull-quote:** *"The Platform Admin's due-diligence labour becomes the new ship's first impression."*
- **Suggested visual:** Two identical berths side by side at dawn. Left berth: empty, a freshly arrived ship at the dock with crew looking around for someone, no cargo prepared. Right berth: same ship arriving, but the dock is already prepared — kraft-wrapped cargo lots laid out in numbered rows, dock workers waiting to load.
- **AI prompt:** "Two identical berths side by side at dawn. Left berth: empty dock with a newly arrived container ship moored alongside, crew on deck looking confused, no cargo prepared. Right berth: identical setup but the dock is already prepared — kraft-wrapped cargo lots in numbered rows on the quay, dock workers waiting to load, manifests on clipboards. Warm dawn light + signal red mooring lines + navy water. Editorial illustration, no readable text, 16:9."
- **Time:** ~1 min

### Slide 11 · The Captain's Council — Section 10 — Three approval stamps

- **Eyebrow:** 10 · The Captain's Council · What we need from leadership
- **Title:** Three calls before the build casts off.
- **Body (three asks as approval stamps on a navigation chart):**

  **A · Confirm who can send cargo on each Agreement**
  Only the cargo owner (or a shipping agent explicitly acting on their behalf) loads a Message. Today's system is more permissive.
  *Owner:* Product Lead + Compliance · *Decision needed:* before kickoff

  **B · Confirm "revoke and recreate" for schema changes**
  In-place amendments arrive later, once the cross-counterparty coordination layer ships. Acceptable for first customer launch?
  *Owner:* Product Lead + Engineering Lead · *Decision needed:* before kickoff

  **C · Greenlight a one-week user-test round**
  5–6 operators · 3 sample tasks each. A week of design time + an afternoon of sessions. Validates the consolidated Messages page + new Composer before the build investment.
  *Owner:* UIUX Lead + Product Lead · *Decision needed:* within 2 weeks

- **Closer:** Approvals today. Build casts off in 2 weeks. v1 arrives in 6 months.
- **Suggested visual:** A captain's council room. A wide oak table. An open navigation chart of the harbour. Three official rubber stamps lying flat across the chart — labelled A, B, C (leave faces blank for overlay). A captain's hand reaching for stamp A from the right. Brass compass and dividers nearby. Warm light from a single lamp over the table.
- **AI prompt:** "Top-down view of a captain's council room. A wide oak table with an open vintage navigation chart of a harbour spread across it. Three official rubber stamps lying flat across the chart in a row (leave the stamp faces neutral for overlay). A captain's hand in dark navy uniform sleeve reaching for the first stamp from the right. Brass compass and dividers beside the chart. Warm lamp light from above. Editorial illustration, warm wood + navy uniform + signal red wax + brass, no readable text, 16:9."
- **Time:** ~3 min — *the most important slide. Pause after each ask. Look at the owner.*

---

## Camera path + transition guidance for Prezi

In Prezi's path editor, set the camera order to:
**0 (overview) → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11**

Per-stop guidance:

- **Step 0 (aerial overview):** wide shot — Prezi auto-fits to see the whole harbour map. This is the dramatic "the whole world is a port" opener. Linger ~5 seconds while you say the opener line.
- **Step 1 (The Harbor):** dive into the centre. The audience sees all 10 backed-up berths. This is your 8-minute slide.
- **Steps 2–5 (West Quay):** Prezi's "swing down" between four slides feels natural in the West Quay column. Add small rotation (±5°) on alternating slides for visual variation.
- **Step 6 (Port Authority HQ):** big pullback UP. This is the Prezi-signature "epic camera move" moment. Make it dramatic.
- **Steps 7–10 (East Quay):** mirror of West Quay — swing right from the HQ, then down through the four East Quay slides.
- **Step 11 (Captain's Council):** pan inward and dive-in tight. The asks are the close — let them fill the screen.

## What to NOT do in Prezi

- **Don't use bullet lists for the body copy.** The content has been distilled per slide. Render each as a visual primitive (cargo stacks, funnel, before/after pair) — not as a `<ul>`.
- **Don't overdo zoom.** Prezi's default smart-zoom is enough. Don't add custom Z-axis effects or stretching.
- **Don't import the landing-page sections wholesale.** The web version (`index.html`) and the Prezi are two surfaces. They share the narrative; they don't share content density.
- **Don't drop the metaphor mid-deck.** If a slide doesn't fit the Port frame, restructure it until it does. Mixing metaphors is worse than committing to a weak one.
- **Don't add audio.** Speaker is the audio. Music behind a 28-minute talk wears thin.

## Where the rest of the content lives in this repo

- **Full 28-minute speaker script:** `portal-app/portal-rewrite-keynotes.md` — read this alongside building each slide. Each section in the script maps 1:1 to a slide above.
- **Design spec for the new portal (the prototype itself):** `docs/superpowers/specs/2026-05-31-prezi-presenter-mode-design.md`. Background detail if you want to add appendix slides.
- **Landing page web version:** `portal-app/index.html` opens at the overview screen — the read-anywhere version of the same content. Useful for shareable links after the meeting.
- **Q&A pre-answers + acceptance criteria + time budget:** appendix of `portal-app/portal-rewrite-keynotes.md`.

## Recommended build order

1. Open Prezi.com → New presentation → blank canvas.
2. Build **Slide 1 (The Harbor)** first — it's the most complex and sets the visual direction for everything else. Get the lighting, palette, and cargo-stack treatment right here; it'll cascade through the rest.
3. Build **Slide 11 (The Captain's Council)** second — confirms the close lands.
4. Author **Slide 0 (aerial overview)** with thumbnails of the two slides above visible.
5. Fill in slides 2–10 in order. Reuse the cargo / manifest / brass / signal-red / navy motifs.
6. Wire the camera path in the order specified.
7. Rehearse once end-to-end with `portal-rewrite-keynotes.md` open.
8. Share the Prezi link + the keynotes file with your co-presenters.

## In-repo presenter view

`portal-app/present.html` — my previous in-repo attempt. Now deprecated; kept as a fallback for offline rehearsal of the spatial map. The authoritative presentation is the Prezi you'll build using this guide.
