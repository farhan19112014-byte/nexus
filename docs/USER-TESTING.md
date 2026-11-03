# User testing: does the robot add anything over ordinary voice chat?

**Status: not run yet. There is no user-testing evidence for NEXUS so far.** Until a study like this one is run, NEXUS
must not claim that people prefer it, engage more, or understand replies better. The landing page says so too.

The functional acceptance checklist (every feature, automated vs human cases) is in [`UAT.md`](UAT.md).

This kit makes the comparison fair and easy to run with 5–12 people (friends, classmates, colleagues). It is a small
informal study for learning, not a scientific trial.

## What is compared
The same NEXUS, the same AI, the same voice and the same questions. Only one thing changes:

| Condition | Open | What the person sees |
|---|---|---|
| **R — robot** | `/app?study=robot` | the 3D NEXUS robot (normal app) |
| **V — voice only** | `/app?study=voice` | a plain voice-chat circle that pulses while listening or speaking; no robot |

(With the single-file preview, add `&study=voice` to the address after `?p=%2Fapp`.)

Everyone tries **both** conditions. Half start with R, half with V (alternate: person 1 R→V, person 2 V→R, …), so
"the second one felt easier" doesn't favour either.

## Before you start
- Use a real AI (your own computer with `npm start` and your Gemini key, or the deployed server). Run
  `npm run verify:live` first so you know the AI and voice actually work that day.
- Same device, same volume, quiet room. Settings → Voice: same voice in both conditions.
- Read the consent script below. Write down **no names**: use P1, P2, … No recordings unless the person agrees.

**Consent script:** "I'm testing two versions of a voice assistant I built. It takes about 15 minutes. There are no wrong
answers and you can stop at any time. I'll note your answers under a number, not your name. Nothing you say is
recorded by the app. The AI is Google Gemini, so please don't share anything private. OK to start?"

## Tasks (do all 3 in each condition, ~5 minutes per condition)
Use different but equivalent questions in each condition (set A for the first, set B for the second; swap the sets
between people too).

| Task | Set A | Set B |
|---|---|---|
| 1. Ask a fact | "What is photosynthesis?" | "How do vaccines work?" |
| 2. Ask for help with a decision | "Should I learn Python or JavaScript first?" | "Should I study in the morning or at night?" |
| 3. Interrupt it | Ask "Tell me about the solar system", then press stop while it speaks | Ask "Tell me about the ocean", then stop it |

While they do the tasks, note: did they look at the screen while it answered (often / sometimes / rarely)? Did they
seem to notice when it was listening vs thinking? Anything confusing? Any comments out loud?

## Questions after EACH condition (1 = strongly disagree … 5 = strongly agree)
1. It was clear when it was listening, thinking and speaking.
2. I understood how the answer was meant (serious, friendly, unsure…).
3. It was pleasant to talk to.
4. I would use it again.
5. It felt distracting. *(reverse item: lower is better)*

## Questions at the end
- Which version would you rather use: R, V, or no preference? Why?
- What, if anything, did the robot add? What got in the way?

## Recording results
Fill one row per person per condition in [`user-testing-results.csv`](user-testing-results.csv). For each question,
compare R and V **per person** (who rated R higher, lower or the same), then count:

- How many preferred R, preferred V, or had no preference (the final question). This is the headline number.
- For questions 1–4, how many rated R higher, the same, or lower than V. For question 5, lower is better.
- Then read the comments: they usually explain the numbers.

## How to report it honestly
- Say how many people and who they were: "8 people, mostly classmates aged 18–22, informal test."
- Report the counts, not just the winner: "5 of 8 preferred the robot, 2 preferred voice only, 1 had no preference."
- With under ~20 people, don't call a difference "significant", and don't generalise beyond the group.
- Report what went badly as well as what went well. Report it even if V wins: that's a useful result too.
- Only after a test like this may NEXUS say something like "In an informal test with 8 people, 5 preferred…", and
  it should say exactly that, with the number.
