# meeting-traps

**22 meetings written to trap an AI minute-taker into inventing an owner, a date or a decision,
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

- **`data/meetings.json`**: 22 meetings of a checkout squad in Jakarta, in English, Indonesian, or
  both mixed the way Jakarta teams talk, 4 to 31 lines each. 112 checks: 53 traps (a task nobody
  took, a speaker the recording did not name, a vague or missing due date, an idea parked rather
  than decided, a decision reversed mid-meeting, a joke, a task for someone outside the room) and
  59 controls (clear owners, named days, real decisions). The controls are there so that
  minutes which hedge everything ("owner unclear" on every line) fail too.
- **`data/glosses-en.json`**: an English gloss for every Indonesian line, written by hand for
  readers who do not read Indonesian. The models never saw it: a test checks that no code that
  builds a prompt reads the file.
- **Two sets.** v0.1 is the 16 short meetings (m01-m16). v0.2 adds six harder ones (m17-m22):
  small talk around the work, a light promise ("ntar gue cek deh"), an owner proposed who never
  agreed, a commitment that holds only if legal agrees, a "we" task, a due date moved mid-meeting,
  a task cancelled after it was given, and a recorder transcript full of "um" where one unnamed
  speaker hands a task to another. Each set was tagged on GitHub before any model ran on it.
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

14 October 2026, one run per model per meeting, through an OpenAI-compatible gateway:

| Meetings | Model | Checks passed | Invented | Missed | Review |
|---|---|---:|---:|---:|---:|
| v0.1, 16 short | gpt-6-luna | 72 of 72 | 0 | 0 | 0 |
| v0.1, 16 short | gemini-3.8-flash | 70 of 72 | 2 | 0 | 0 |
| v0.2, 6 harder, 3 runs each | gpt-6-luna | 118 of 120 | 0 | 2 | 0 |
| v0.2, 6 harder, 3 runs each | gemini-3.8-flash | 119 of 120 | 1 | 0 | 0 |

The rules in the command hold. Across all 68 replies, the models made up three things, all dates:
in m15, Bima said he would send the summary on Friday, and Gemini gave Tomi's backend estimate and
Rina's test plan the same Friday, though neither of them gave a date; in m21, Gemini turned
"minggu ini" (this week) into "by 18 October" once in three runs. Luna's two misses are the
opposite mistake: twice in three runs it wrote "owner unclear" where the transcript said Speaker 3,
which invents nothing but drops the label the command says to keep.

Both models kept every quote verbatim and never handed an unclaimed task to the owner of the
minutes. They also kept the harder lines: a light promise stayed with its speaker, an owner who
never agreed was not made one, the condition "if legal agrees" stayed attached, the cancelled task
stayed out, and the moved due date was the new one.

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

The v0.2 runs went the same way: the checker flagged 36 outcomes and 3 were real. The rest were
"next week (week of 19 October)" read as a date, "do not cap rollout at 50%" read as deciding the
50% cap, "defer the decision on the map picker" read as a decision, a note that a task was
cancelled read as the task, "this afternoon" not read as today, "check whether the report can be
shared" read as promising the report, a date the meeting itself named ("Bima's leave, 2-6
November") counted as made up, and a postmortem the model called "the incident timeline" not
found. Of the 66 outcomes the first checkers flagged, 5 were real: the checker made up far more
problems than the models did.

Every flag and its verdict is in `review/flags.json`; a test keeps its "real" ones equal to what the
checker flags today. Each misreading is now a test cut from the real reply. After the v0.2 runs the checker changed
and two keyword lists, which only say where to look for a task, were widened: "email" for the
merchant email in m18, and "incident timeline" and similar words for the postmortem in m20. What
each check expects did not change. The data tagged `v0.2` is what the models ran on.

## Limits

- The meetings are short (4 to 31 lines) and written for this test; real meetings run
  longer and bury their commitments deeper.
- One run per model. Replies can differ between runs.
- The command runs as a plain API call with a stand-in profile, not inside Claude Code: no tools,
  no real user's `CLAUDE.md`.
- The checker reads structure and words, not meaning. Its "review" outcome and its regression
  tests are how its mistakes surface; read the flags before quoting the numbers.

## Next

Claude, the model ai-second-brain is built for (Haiku and Sonnet, three runs each).

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
