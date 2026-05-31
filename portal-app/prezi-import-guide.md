# Prezi Import Guide — Portal Rewrite Pitch

How to author the management-approval Prezi using the content I've already built in this repo. Pair this with `portal-rewrite-keynotes.md` (the 28-minute speaker script).

**The plan:** sign in to Prezi.com → New presentation → choose a "blank canvas" template → drop in each of the 11 slide compositions below → import the suggested imagery via Prezi's built-in library, Unsplash, or AI generation → wire the camera path in the order below. Total authoring time: ~90–120 minutes.

---

## The metaphor: a mail system

The pitch is structured around a postal/mail-system analogy because the platform literally is one — **Agreements** are contracts between sender and recipient, **Messages** are the data that flows under them. Reuse this throughout: envelopes, postmarks, sorting machines, delivery counters, mailboxes, stamps. The metaphor lets every slide carry a visual identity without explaining itself.

Where Prezi's built-in image library has supply-chain / postal / logistics assets, use them. Where it doesn't, the AI prompts in each slide below are written to feed FLUX / DALL-E / Midjourney directly.

## Spatial map (Prezi's canvas)

Prezi uses a free-positioning canvas — you place each slide anywhere in 2D space and the camera flies between them on click. Use this map:

```
                        ┌──────────────────────────┐
                        │  06  THE LOOKOUT          │
                        │  Mental model · 3 doors   │
                        └──────────────────────────┘
                                    ▲
                                    │
        WEST WING                   │                    EAST WING
   (customer journey,               │              (rollout journey,
    top→bottom in time)             │                top→bottom in time)
                                    │
   ┌───────────────┐                │                ┌───────────────┐
   │ 02  Funnel    │                │                │ 07  Schedule  │
   │ 5→1 sorting   │                │                │ v1 vs deferred│
   └───────────────┘                │                └───────────────┘
   ┌───────────────┐    ┌──────────────────────────┐ ┌───────────────┐
   │ 03  Postage   │    │  01  THE MAIL ROOM        │ │ 08  Forward   │
   │ Consent ≠     │ ←  │  Ten frictions, ten       │ │ Soft landing  │
   │ Action        │    │  queues that pile up      │ │ for migration │
   └───────────────┘    │  (THE OPENING SLIDE)      │ └───────────────┘
   ┌───────────────┐    └──────────────────────────┘ ┌───────────────┐
   │ 04  Counter   │                ▲                │ 09  Mailbox   │
   │ 7→5 operator  │                │                │ Empty→Full    │
   └───────────────┘                │                └───────────────┘
   ┌───────────────┐                │                ┌───────────────┐
   │ 05  Back room │                │                │ 10  Stamps    │
   │ 9→5 admin     │                │                │ Three asks    │
   └───────────────┘                ▼                └───────────────┘
                            ┌──────────────────────────┐
                            │  11  THE TOWN HALL        │
                            │  Decisions today.         │
                            │  Build kicks off in 2 wks.│
                            └──────────────────────────┘
```

**Camera order (linear walkthrough):**
0 (overview · wide shot of the whole map) → 1 (Mail Room) → 2–5 (West Wing, top→bottom) → 6 (Lookout, big swing up) → 7 (East Wing top) → 8 → 9 → 10 → 11 (Town Hall close).

---

## Slide-by-slide build sheet

Each slide below gives you: **title** (what goes large on the slide) · **eyebrow** (small label above the title) · **body** (the actual content) · **suggested visual** (with an AI prompt you can copy-paste) · **time on slide** (matches the keynote).

### Slide 0 · The Overview (the opening dive-in)

- **Title (centered, big):** Portal Rewrite
- **Subtitle:** Ten frictions. Ten costs. One prototype that cancels them.
- **Audience caption (small):** Dex Technologies leadership · May 2026
- **Suggested visual:** Central illustration of a stylized **postal sorting hub** — a futuristic mail-processing facility seen from above, with conveyor belts radiating outward to 11 numbered stations. Around it, thumbnail tiles of the 11 slides arranged in the map shape above. Three large icons floating in the corners: a ship (TradEx), a construction crane (BuildEx), a medical cross (HealthDex).
- **AI prompt to generate the hub:**
  > "Isometric illustration of a stylized postal sorting facility seen from above, warm cream and kraft-paper palette, postal red accents, conveyor belts radiating outward connecting 11 work stations around a central hub, two figures at the central control desk, ship + construction crane + medical-cross icons floating at the periphery, clean editorial style, soft warm light, no text on the image, 16:9 aspect ratio"
- **Time:** 60 sec (read the opener line from keynotes.md)

### Slide 1 · The Mail Room — Section 00 — Ten frictions

- **Eyebrow:** 00 · The Mail Room · Why this needs leadership attention
- **Title:** Ten kinds of mail. Ten queues that pile up.
- **Subhead:** Five paid by customers at the front counter · Five paid by the staff in the back room
- **Body — two rows of five envelope stacks each:**

  | Front Counter (customer queues) | Back Room (internal queues) |
  |---|---|
  | Operator · *retention risk* | BD · *pipeline velocity* |
  | Service Provider · *audit exposure* | Product · *roadmap drag* |
  | DEX admin · *time-to-market* | Engineering · *catalogue relay* |
  | Platform admin · *activation drop-off* | UIUX · *surface-area sprawl* |
  | Pack dispatcher · *top-account ceiling* | Ops · *ticket & change load* |

- **Closing pull-quote:** *"Customers pay the postage. We pay the staffing."*
- **Suggested visual:** Wide hero illustration of a busy postal sorting floor: long counter with five customers (queue) on the left side, five staff working at sorting stations on the right side. Envelopes stacked at each station. Animated GIF or video clip showing envelopes piling up over time would be ideal.
- **AI prompt:** "Wide editorial illustration of a 1920s/modern hybrid postal sorting floor, five customers waiting at a counter on the left (one per persona type, varied), five staff working at sorting stations on the right, envelopes stacked into queues at each station, warm cream walls, postal red accents, kraft envelopes piled up, no text, 16:9"
- **Time:** 8 min (the core pitch — let this slide breathe)

### Slide 2 · The Sorting Machine — Section 01 — 5 → 1

- **Eyebrow:** 01 · West Wing · Upstream of compose
- **Title:** Five consent types collapse into one.
- **Body — funnel diagram:**
  - Left side (5 stacked envelope labels): Subscription · DER · SPR · Tripartite · Direct
  - Funnel arrow
  - Right side (one large envelope label): **AGREEMENT**
- **Pull-quote:** *"One contract type. One wizard. One lifecycle."*
- **Suggested visual:** A vintage postal sorting machine (1950s-era industrial design) with five different envelope types feeding into the top, one standardised envelope dropping out the bottom. Brass mechanisms, leather conveyor, warm light.
- **AI prompt:** "Vintage 1950s postal sorting machine, five different envelope shapes feeding into the top hopper, one standardized envelope dropping from the chute at the bottom, warm brass mechanisms, leather conveyor belts, editorial illustration style, kraft and red palette, no text, 16:9"
- **Time:** 2 min

### Slide 3 · The Postage Window — Section 02 — Consent ≠ Action

- **Eyebrow:** 02 · West Wing · The shift, downstream
- **Title:** Consent and action are decoupled.
- **Body — paired blocks:**
  - **Consent** (decided once) — at Agreement creation, the stamp on the envelope says who can send and what
  - ≠
  - **Action** (just fill data) — for every Message, operator just fills the form and the system handles routing
- **Pull-quote:** *"The structural shift. Not a UI re-skin."*
- **Suggested visual:** Two-panel composition. Left: a beautifully detailed wax-sealed envelope (the consent), shown once on a desk being signed and stamped. Right: a stack of identical envelopes flowing through a slot (the actions), pre-stamped, just contents varying.
- **AI prompt:** "Two-panel editorial illustration: left panel shows a hand pressing a wax seal onto a kraft envelope at a wooden desk lit by a warm lamp; right panel shows a stream of pre-stamped envelopes flowing through a mail slot, identical postage but varied content visible inside. Kraft + postal red + warm wood palette, no text, 16:9"
- **Time:** 2 min

### Slide 4 · The Counter — Section 03 — 7 → 5 operator

- **Eyebrow:** 03 · West Wing · One task, two journeys
- **Title:** Send a Cargo manifest to Maersk.
- **Body — before/after pair:**
  - **Today** — 7 steps · refresh-to-verify · EForm-vs-ETR vocabulary · *(dotted progress bar showing 7 dots)*
  - → arrow →
  - **New portal** — 5 steps · live timeline · 1 vocabulary · *(solid progress bar showing 5 dots)*
- **Pull-quote:** *"Same task. Two fewer translation steps."*
- **Suggested visual:** Postal counter, two camera angles side by side. Left: cluttered customer service window, forms piled high, frustrated customer, seven slips on the counter. Right: clean modern counter, smiling customer, five tidy slips. Same person, same task, two experiences.
- **AI prompt:** "Two-panel postal counter scene. Left: cluttered 1970s post-office counter, customer mid-paperwork with 7 forms scattered, frustrated clerk. Right: clean modern postal counter, same customer relaxed, 5 forms in a tidy stack, helpful clerk. Editorial illustration, warm cream walls + postal red accents, no text, 16:9"
- **Time:** 2 min

### Slide 5 · The Back Office — Section 04 — 9 → 5 admin

- **Eyebrow:** 04 · West Wing · Same story, for the admins
- **Title:** Register a new document type.
- **Body — versus block:**
  - **9 steps** · 4 actor types · *days → weeks*
  - → arrow →
  - **5 steps** · 1 admin · *minutes*
- **Pull-quote:** *"Smart Start drafts. Test-as-operator verifies. The catalogue relay is gone."*
- **Sarah quote** (read aloud, source: keynotes.md): *"Every quarter I open three tabs — the Confluence requirements page, the BD spec sheet, the IMDA standard — and hand-translate them into a schema."*
- **Suggested visual:** Back-office postal admin scene. Left: chaotic — four people in a relay around a desk passing paperwork (CSM → dev → tech lead → ops), days/weeks calendar overlay. Right: one admin at a single screen, schema authored in minutes, single calendar day overlay.
- **AI prompt:** "Two-panel illustration of a postal back office. Left: chaotic four-person relay around a paperwork-strewn desk, calendar showing days/weeks. Right: single calm admin at modern workstation with a clear screen, calendar showing minutes. Warm desk lamps, kraft envelopes nearby, editorial illustration style, no text, 16:9"
- **Time:** 2 min · *most important storytelling slide for BD audience — invest visual care here*

### Slide 6 · The Lookout — Section 05 — Three doors

- **Eyebrow:** 05 · The Lookout · The new mental model
- **Title:** Three questions. Three sections.
- **Body — three pillars:**
  - **WORK** · *"What needs my attention?"* · Inbox · Drafts
  - **EXCHANGE** · *"What's the business state?"* · Agreements · Messages
  - **DIRECTORY** · *"What are the building blocks?"* · Data elements · Participants
- **Suggested visual:** Three large brass-handled wooden doors in a row, each with a brass plate naming the section. Each door slightly open, revealing a hint of what's behind it (charts/dashboards for Exchange, etc.).
- **AI prompt:** "Three large mahogany doors in a row in a warm wood-paneled hallway, each with a polished brass plate at eye level reading WORK, EXCHANGE, DIRECTORY (do not render text in the image — leave plates blank for me to overlay), each door slightly ajar revealing a sliver of golden light, editorial illustration style, no text, 16:9"
- **Time:** 1 min

### Slide 7 · The Loading Dock — Section 06 — Ten decisions

- **Eyebrow:** 06 · The Observatory · Ten decisions that shape the experience
- **Title:** Ten decisions. Each cancels a Section 00 tax.
- **Body — list of ten as captioned packages:**
  01. Inbox is the home page
  02. One page for sent and received data
  03. One status vocabulary
  04. Composing happens under an Agreement
  05. Agreement terms frozen at acceptance
  06. Notifications match the stakes
  07. Multi-counterparty distributions are one gesture
  08. Operators describe their own side
  09. Admins author elements themselves
  10. Brand-new orgs land on pre-staged work
- **Caption:** *"Read them as: because operators pay X today, we made decision Y."*
- **Suggested visual:** A loading dock at golden hour. Ten brown-paper-wrapped packages, each tagged with a number (01–10) and a one-word label. Stacked neatly waiting for the truck. Light streaming through warehouse openings.
- **AI prompt:** "Loading dock at golden hour, ten kraft-paper-wrapped packages neatly stacked, each tagged with a number (01–10) on brown paper labels, warm sunlight streaming through tall warehouse openings, editorial illustration, dust particles in light beams, no readable text, 16:9"
- **Time:** 3 min

### Slide 8 · The Delivery Schedule — Section 07 — v1 vs deferred

- **Eyebrow:** 07 · East Wing · What launches first vs what's deferred
- **Title:** Honest scoping.
- **Body — two boards:**
  - **On the truck today (v1 · 6 months):** One portal · Inbox home · One Messages page · Live timeline · One Composer + auto-review · Watch toggle · Cross-network warnings · Settings → Pitstops
  - **Waiting at the depot (deferred · needs platform):** Schema-negotiation handshake · In-place Agreement amendments · Bulk send · Test mode · Org-wide failure banner · Mobile push
- **Pull-quote:** *"Deferred items all wait on one shared coordination layer."*
- **Suggested visual:** A delivery dispatch board (the kind from a 1960s postal depot) with two columns of slats. Left column: packages with green stickers ("ON THE TRUCK"). Right column: packages with grey stickers ("AT THE DEPOT"). Dispatcher visible in the foreground checking the board.
- **AI prompt:** "1960s postal depot dispatch board with two vertical columns of paper slats, green stickers on the left column and grey stickers on the right column, dispatcher in mid-distance reviewing the board with a clipboard, warm sodium lighting, editorial illustration style, no readable text, 16:9"
- **Time:** 2 min

### Slide 9 · The Forwarding Service — Section 08 — Soft landing

- **Eyebrow:** 08 · East Wing · Rollout day, for users already on the network
- **Title:** Migration is a design problem. Not an afterthought.
- **Body — three guarantee cards:**
  - 🔗 **Bookmarks don't break** — Legacy URLs redirect to their new home automatically
  - 📦 **Drafts carry over** — In-progress Agreements + Messages appear at the same stage
  - ℹ **One first-login panel** — Dismissible, audit-logged, gone after acknowledgement
- **Suggested visual:** A mail forwarding office. Three counters or windows, each with a friendly clerk doing one of the three things: stamping a forward-redirect on an envelope, carefully moving a partly-written letter to a new in-tray, handing a one-page welcome card to a customer.
- **AI prompt:** "Triptych illustration of a mail-forwarding office. Three counter windows side by side: first clerk stamping a forward-redirect onto an envelope, second clerk carefully transferring a half-written letter between in-trays, third clerk handing a single welcome card to a customer. Warm cream walls + brass fittings, editorial illustration, no readable text, 16:9"
- **Time:** 1 min

### Slide 10 · The Mailbox — Section 09 — Empty → consequential

- **Eyebrow:** 09 · East Wing · Day one, for orgs joining the network
- **Title:** Empty inbox → consequential inbox.
- **Body — two-panel comparison:**
  - **Today:** Empty mailbox · note inside: *"Welcome. No items in your inbox."* · subtitle: *"Where do I start?"*
  - → arrow →
  - **New portal:** Same mailbox, packed with pre-staged envelopes labelled (Cargo manifest, B/L, Vessel arrival pack, +5 more) · subtitle: *"Welcome. 8 drafts ready for review."*
- **Pull-quote:** *"Platform Admin's due-diligence labour becomes the new operator's first impression."*
- **Suggested visual:** Two old-fashioned brass-and-glass apartment mailboxes side by side, identical exterior. Left mailbox door open: empty, single tumbleweed of a "Welcome" card. Right mailbox door open: stuffed with neatly labelled kraft envelopes ready for review.
- **AI prompt:** "Two old-fashioned brass-and-glass apartment mailboxes side by side in a warmly lit lobby. Left mailbox door open showing emptiness with a single small welcome card lying inside. Right mailbox door open, stuffed with neatly stacked kraft envelopes labelled with shipping document names. Editorial illustration, warm brass + cream walls, no readable text, 16:9"
- **Time:** 1 min

### Slide 11 · The Town Hall — Three Approval Stamps — Section 10

- **Eyebrow:** 10 · The Town Hall · What we need from leadership
- **Title:** Three calls before the build begins.
- **Body — three asks as approval stamps:**

  **A · Confirm who can send data on each Agreement**
  Only the data owner (or a Service Provider explicitly acting on their behalf) composes Messages. Today's system is more permissive.
  *Owner:* Product Lead + Compliance · *Decision needed:* before kickoff

  **B · Confirm "revoke and recreate" for schema changes**
  In-place amendments arrive later, once the coordination layer ships. Acceptable for first customer launch?
  *Owner:* Product Lead + Engineering Lead · *Decision needed:* before kickoff

  **C · Greenlight a one-week user-test round**
  5–6 operators · 3 sample tasks each. A week of design time + an afternoon of sessions. Validates the consolidated Messages page + new Composer before the build investment.
  *Owner:* UIUX Lead + Product Lead · *Decision needed:* within 2 weeks

- **Closer:** Decisions today. Build kicks off in 2 weeks. v1 ships in 6 months.
- **Suggested visual:** A wooden desk with three rubber stamps lying flat — labelled A, B, C — and a single sheet of paper waiting to be stamped. A hand reaching for stamp A. Warm light from a banker's lamp. Optionally a fountain pen and an inkpad in postal red beside the stamps.
- **AI prompt:** "Wooden desk top-down view, three large rubber stamps labelled A, B, C arranged in a row (do not render letters — leave stamp faces neutral for overlay), a sheet of cream paper waiting to be stamped, a hand reaching for stamp A from the right, banker's lamp warm light, fountain pen and red inkpad to the side, editorial illustration, no readable text, 16:9"
- **Time:** 3 min · *the most important slide. Pause after each ask. Look at the owner.*

---

## Camera path + transition guidance for Prezi

In Prezi's path editor, set the camera order to:
**0 (overview) → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11**

Per-stop guidance:

- **Step 0 (Overview):** wide shot — Prezi will auto-fit the camera to see the whole canvas. This is the dramatic "the whole world is a mail network" opener. Linger ~5 seconds while you say the opener line.
- **Step 1 (Mail Room):** dive in to the center. The audience should see all 10 envelope stacks at once. This is your 8-minute slide.
- **Steps 2–5 (West Wing):** Prezi's "swing down" between four slides feels natural in the West Wing column. Add small rotation (±5°) on alternating slides for visual variation.
- **Step 6 (Lookout):** big pullback UP. This is the Prezi-signature "epic camera move" moment. Make it dramatic.
- **Steps 7–10 (East Wing):** mirror of West Wing — swing right from the Lookout, then down through the four East Wing slides.
- **Step 11 (Town Hall):** pan inward and dive-in tight. The asks are the close — let them fill the screen.

## What to NOT do in Prezi

- **Don't use bullet lists for the body copy.** The content has been distilled per slide. Render each as a visual primitive (envelope stack, funnel, before/after pair) — not as a `<ul>`.
- **Don't overdo zoom.** Prezi's default smart-zoom is enough. Don't add custom Z-axis effects or stretching.
- **Don't import the landing-page sections wholesale.** The web version (`index.html`) and the Prezi are two surfaces. They share the narrative; they don't share content density.
- **Don't add audio.** Speaker is the audio. Music behind a 28-minute talk wears thin.

## Where the rest of the content lives in this repo

- **Full 28-minute speaker script:** `portal-app/portal-rewrite-keynotes.md` — read this alongside building each slide. Each section in the script maps 1:1 to a slide above.
- **Design spec for the new portal (the prototype itself):** `docs/superpowers/specs/2026-05-31-prezi-presenter-mode-design.md` (yes — same date, different artefact). Useful background if you want to add appendix detail to any slide.
- **Landing page web version:** `portal-app/index.html` opens at the overview screen — works in any browser as the read-anywhere version of the same content. Useful for shareable links after the meeting.
- **Q&A pre-answers + acceptance criteria + time budget:** `portal-rewrite-keynotes.md` appendix section.

## Recommended build order

1. Open Prezi.com → New presentation → blank canvas.
2. Build **Slide 1 (Mail Room)** first — it's the most complex and sets the visual direction for everything else.
3. Build **Slide 11 (Town Hall)** second — confirms the close lands.
4. Author **Slide 0 (Overview)** with thumbnails of the two slides above visible.
5. Fill in slides 2–10 in order. Reuse the envelope/stamp/mailbox motifs.
6. Wire the camera path in the order specified.
7. Rehearse once end-to-end with `portal-rewrite-keynotes.md` open.
8. Share the Prezi link + the keynotes file with your co-presenters.

## In-repo presenter view

`portal-app/present.html` — my previous attempt to build a Prezi-style presenter locally. It works but doesn't reach the visual bar Prezi delivers. Keep as a fallback for offline rehearsal; the authoritative presentation is the Prezi you'll build using this guide.
