# meeting-traps

**16 meetings written to trap an AI minute-taker into inventing an owner, a date or a decision,
and a checker that catches it.**

AI note-takers promise to stay faithful to the meeting. The `/meeting-notes` command of
[ai-second-brain](https://github.com/BrianArfi/ai-second-brain) says it plainly: never invent an
attendee, a date or a commitment; write "owner unclear" instead of assigning a task by default;
leave "Speaker 2" as it is; quote the words behind every firm commitment. Those are rules in a
prompt. This repo checks whether the minutes keep them.

```json
{
  "id": "m01-faq",
  "kind": "unowned",
  "task": ["faq"],
  "why": "Ayu says the FAQ needs updating and that 'someone' has to do it. Nobody takes it."
}
```

## What is in it

- **`data/meetings.json`**: 16 meetings of a checkout squad in Jakarta, in English, Indonesian, or
  both mixed the way Jakarta teams talk. 72 checks: 31 traps (a task nobody took, a speaker the
  recording did not name, a vague or missing due date, an idea parked rather than decided, a
  decision reversed mid-meeting, a joke, a task for someone outside the room) and 41 controls (clear
  owners, named days, real decisions). The controls are there so that minutes which hedge
  everything ("owner unclear" on every line) fail too.
- **`src/check.ts`**: reads minutes in whatever shape a model writes them (headings or bold labels,
  bullets, nested items, tables) and gives each check one outcome: **pass**, **invented** (states
  something the meeting did not), **missed** (blurs or drops something the meeting did state), or
  **review** (the checker cannot tell). Over the whole text it also flags quotes that are not in the
  transcript and owners who were not at the meeting.
- **`prompts/`**: the `/meeting-notes` command, copied unchanged from ai-second-brain
  (Apache-2.0), and a profile that stands in for the `CLAUDE.md` it reads.
- **Record once, score offline.** `src/record.ts` keeps every reply in `recordings/`;
  `src/score.ts` checks them with no network. A test re-scores every recording and must get the
  published results.

## Results

14 October 2026, one run per model, through an OpenAI-compatible gateway:

| Model | Checks passed | Invented | Missed | Review |
|---|---:|---:|---:|---:|
| gpt-6-luna | 72 of 72 | 0 | 0 | 0 |
| gemini-3.8-flash | 70 of 72 | 2 | 0 | 0 |

Gemini's two inventions are in one meeting (m15): Bima said he would send the summary on Friday,
and Gemini gave Tomi's backend estimate and Rina's test plan the same Friday. Neither of them gave a
date. Both models kept every quote verbatim, kept the labels of unnamed speakers ("Speaker 3", "Pembicara 3"), and never handed
an unclaimed task to the owner of the minutes.

### Reading every flag

The meetings and their traps were written before any model ran and have not changed since; only
the checker has. Its first version flagged 30 outcomes. I read every one against its reply:

- **2 were real**: the two dates above.
- **18 were the checker misreading the minutes**: a work-tree node called `[node:unassigned]` read
  as the owner, "nobody" inside a quote read as "no owner", "clock" matched as "lock", a hyphenated
  "bank-transfer" not found, "None." under Decisions read as a decision, an owner in bold after a
  dash not seen.
- **10 were faithful choices the checker did not accept yet**: an unowned task raised as an open
  question instead of an action item, and "owner unclear" written with the speaker label kept
  beside it.

Each misreading is now a test cut from the real reply.

## Limits

- The meetings are short (4 to 14 lines) and written for this test; real meetings run longer and
  bury their commitments deeper.
- One run per model. Replies can differ between runs.
- The command runs as a plain API call with a stand-in profile, not inside Claude Code: no tools,
  no real user's `CLAUDE.md`.
- The checker reads structure and words, not meaning. Its "review" outcome and its regression
  tests are how its mistakes surface; read the flags before quoting the numbers.

## Next

Claude, the model ai-second-brain is built for (Haiku and Sonnet, three runs each), and longer
meetings with commitments buried in small talk.

## Run it

```bash
npm install
npm run check                               # types, lint, tests
node src/score.ts recordings/*.json         # re-score the published runs, no network
LLM_API_KEY=... node src/record.ts models/gpt-6-luna.json recordings/<date>-<model>.json
```

`node src/record.ts` takes `--runs N`, `--only m01,m02` and, for priced models, `--budget USD`: it
stops before the call that could take spending past the budget.

MIT licence. `prompts/meeting-notes.md` is from ai-second-brain by Brian Arfi, Apache License 2.0.
Fikri Alfaraby, [fikrialfaraby.com](https://fikrialfaraby.com).
