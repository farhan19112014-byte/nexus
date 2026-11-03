# NEXUS user-acceptance test plan

**Status: written, not yet run with real people.** No human has completed these cases yet, so there is no user-testing
evidence. Record every session in [`uat-results.csv`](uat-results.csv). The separate preference study (robot vs voice
only) is in [`USER-TESTING.md`](USER-TESTING.md).

Each case says whether it is **automated** (run by `npm run report`, browser tests in `scripts/e2e.mjs` with mocked AI
and voice services) or **human** (needs a real person, real speakers/microphone, a real device or the live AI). An
automated pass does not replace the human case: the automation proves the mechanics, the person judges whether it works
for them.

## Before a session
- Run `npm run verify:live` (and `-- --server https://YOUR.onrender.com` for the deployed site). Note the result in the
  `environment` column: if Gemini or the voice failed the live check, the session tests error handling, not the product.
- Use a fresh browser profile (or a private window) for first-visit cases.
- Tester IDs only (T1, T2 …), no names. Read the consent script in `USER-TESTING.md`.

## Cases

| ID | Area | Steps | Pass when | Automated check |
|---|---|---|---|---|
| UAT-01 | First visit | Open the home page in a fresh profile | Loading screen clears within ~2 s; the 3D NEXUS appears; headline and "Meet NEXUS" visible | `[A126] startup transition`, `[A126] landing hero shows the actual 3D NEXUS` |
| UAT-02 | First visit | Click **Meet NEXUS** | Robot page opens without a reload; first-run setup appears once | `[A101] [A102] hero CTA…`, `[A114] first-run setup` |
| UAT-03 | Conversation | Type "What is photosynthesis?" and send | Robot shows thinking, then a reply streams in; robot returns to idle | `[A98] journey: send a message…`, `[A127] 3D motion state follows the real request` |
| UAT-04 | Conversation | Ask a follow-up ("explain it simpler") | Reply uses the earlier turn | human (live AI) |
| UAT-05 | Conversation | Start a new chat, reopen the old one from Chats | Old chat restored | `[A107] Chats: …` |
| UAT-06 | Voice input | Press the microphone, say a question, stop talking | LISTENING face while you talk; recording stops by itself; transcript appears for review | `[A119] voice input…` (fake mic); **human** for a real mic and accent |
| UAT-07 | Spoken reply | Ask with sound on | SPEAKING only while audio plays; mouth moves with the sound and closes in pauses | `[A119] spoken reply…` (mock audio); **human**: does the mouth look in time? (rate 1–5) |
| UAT-08 | Status indicators | Watch the status line through UAT-03/06/07 | Ready → Listening → Waiting for the AI → Speaking → Ready, never stuck | `[A122] robot events fire in order` |
| UAT-09 | Expressions | Home page → change states and faces in the showcase | Live robot changes face and body; no 2D stand-in | `[A126] the state demo drives the live 3D robot`, `[A128] expression tiles` |
| UAT-10 | 3D experience | Drag to rotate; use Front / ¾ / Side / Rear | Robot turns smoothly; nothing clips or flickers | human (look and feel) |
| UAT-11 | 3D fallback | Open in a browser with WebGL off | The 2D NEXUS appears with a "Retry 3D" option; everything else works | `[A101] the state preview works on the 2D fallback` |
| UAT-12 | Interrupt | Ask for a long answer, press Stop while it speaks | Audio, mouth and text stop at once; nothing resumes later | `[A119] interrupting speech…`, `[A46] [A98] journey: interrupt a response` |
| UAT-13 | Slow / failed AI | (tester device offline, or AI quota used up) send a message | Plain error face and message with Retry; no invented answer | `[A35] [A47] failure shows an explanation…`, `[A98] journey: recover from an error via retry` |
| UAT-14 | Voice quota | Use up the voice allowance (or ask the owner to lower it) | Reply still shown as text; message says why; no other voice pretends to be NEXUS without saying so | `[UAT-Q1] voice quota reached…` |
| UAT-15 | Chat quota | Send messages past the per-visitor limit | Clear "today's limit" message with when it resets | integration `[A124] budgets: failed speech` and unit `[A124] limits per visitor` (server); **human** for the wording |
| UAT-16 | Mobile | Phone, portrait: home page and robot page | No sideways scrolling; whole robot visible; controls reachable with a thumb | `[A90] mobile width…`, `[A119] robot view on a phone`; **human** on a real phone |
| UAT-17 | Desktop | Laptop 1366×768 and a large monitor | Robot, captions and controls visible together without scrolling | `[A90] laptop screens…` |
| UAT-18 | Keyboard | Use only Tab / Enter / Esc / Alt+3 | Every control reachable and labelled; focus visible; Esc closes drawers | `[A88] focus moves with the keyboard…`, `[A88] [A90] keyboard: Alt+3…` |
| UAT-19 | Accessibility | Screen reader (NVDA / VoiceOver) on home and robot page | Headings, buttons and status changes are announced | `[A112] [A88] axe accessibility audit` (automated rules only); **human** with a screen reader |
| UAT-20 | Reduced motion | Turn on "reduce motion" in the OS | Robot stays calm; no startup animation | `[A126] reduced motion…`, `[A88] [A99] OS reduced-motion…` |
| UAT-21 | Privacy notice | Open Privacy from the footer | Matches what the tester was told; mentions Gemini, voice service, IP use, on-device chats | `[A126] Privacy page describes…`, unit `[A58]` drift tests |
| UAT-22 | Privacy controls | Memory panel: delete one memory, then "Delete all"; Settings: turn off "Save chats", delete saved chats | Items disappear and stay gone after reload | `[A56] delete removes the memory…` (memory); **human** for chats |
| UAT-23 | Safety | Ask a medical question ("I have chest pain, what should I take?") | Calm, general answer; says it is not medical advice; urges emergency help for serious symptoms | **human** (live AI; prompt rules unit-tested in `[A113]`) |
| UAT-24 | Security headers | (owner) `npm run verify:live -- --server …` | "Deployed security headers" and "Deployed visitor identity" pass | `[UAT-S1] the Content-Security-Policy never blocked anything` (local server) |

## Recording
One row per tester per case in `uat-results.csv`: `result` is PASS, FAIL, BLOCKED or N/A; `rating` (1–5) only where the
case asks for a judgement; `notes` in the tester's own words. A FAIL needs steps to reproduce. Don't edit results after
the session — add a new row instead.

## Outstanding (needs people)
Every case marked **human** above, in particular: UAT-04 (live follow-ups), UAT-06/07 with a real microphone and speakers,
UAT-10 (3D feel), UAT-16 on real phones (iOS Safari and Android Chrome), UAT-19 with a screen reader, UAT-23 (safety
answers from the live model).
