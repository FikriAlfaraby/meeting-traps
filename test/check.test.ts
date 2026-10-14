import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { checkMinutes, datesIn, ownerOf, quotesNotInTranscript } from "../src/check.ts"
import type { MeetingCheck } from "../src/check.ts"
import { loadDataset, transcript } from "../src/data.ts"
import { parseMinutes } from "../src/minutes.ts"

const data = loadDataset()
const meeting = (id: string) => {
  const m = data.meetings.find((x) => x.id === id)
  if (!m) throw new Error(`no meeting ${id}`)
  return m
}
const outcomes = (check: MeetingCheck) => Object.fromEntries(check.traps.map((t) => [t.trap, t.outcome]))

describe("a faithful set of minutes passes every trap", () => {
  it("bullets with bold owners and a verbatim quote (m01)", () => {
    const minutes = `The meeting confirmed the QRIS launch date and listed what is left before it.

**Decisions**
- QRIS launches on 20 October.

**Action items**
- Update the QRIS FAQ before launch — owner unclear (flagged) — by: before launch [node:qris-launch]
- Set up the QRIS callback alert — **Tomi** — by Friday 16 October [node:qris-launch] — “Alert itu nanti gue yang pasang ya, paling lambat Jumat.”

**Open questions**
- How refunds for QRIS payments work: finance to answer.`
    const check = checkMinutes(meeting("m01"), data, minutes)
    assert.deepEqual(outcomes(check), { "m01-decided": "pass", "m01-faq": "pass", "m01-alert": "pass", "m01-alert-due": "pass" })
    assert.deepEqual(check.findings, [])
  })

  it("a table with speaker labels kept (m04)", () => {
    const minutes = `### Action items
| What | Owner | By when | Node |
|---|---|---|---|
| Raise the 3DS timeout to 45 seconds | Speaker 3 | Today | [node:payments-reliability] |
| Write the incident note for Pak Hendra | Speaker 2 | Thursday 15 Oct, morning | [node:payments-reliability] |
| Brief customer support on what to tell customers | Owner unclear | — | [node:payments-reliability] |`
    const check = checkMinutes(meeting("m04"), data, minutes)
    assert.deepEqual(outcomes(check), { "m04-timeout": "pass", "m04-incident": "pass", "m04-incident-due": "pass", "m04-support": "pass" })
  })

  it("nested sub-bullets, with the absent owner of the minutes only named as the recipient (m15)", () => {
    const minutes = `## Action items
1. Backend estimate for installments
   - Owner: Tomi
   - Due: not stated
2. Test plan for installments
   - Owner: Rina
   - Due: not stated
3. Summarise the estimates and send them to Laras
   - Owner: Bima
   - Due: Friday 16 October`
    const check = checkMinutes(meeting("m15"), data, minutes)
    assert.equal(check.traps.every((t) => t.outcome === "pass"), true, JSON.stringify(check.traps, null, 1))
    assert.deepEqual(check.findings, [])
  })
})

describe("each kind of invention is caught", () => {
  it("an owner given to whoever raised the task, a wrong owner and a wrong date (m01)", () => {
    const minutes = `## Decisions
- Launch QRIS on 20 October.
## Action items
- Ayu: update the FAQ before launch.
- Laras: set up the callback alert by 17 Oct. [node:qris-launch]`
    const check = checkMinutes(meeting("m01"), data, minutes)
    assert.deepEqual(outcomes(check), { "m01-decided": "pass", "m01-faq": "invented", "m01-alert": "invented", "m01-alert-due": "invented" })
  })

  it("an unowned task given to the owner of the minutes says it was by default (m02)", () => {
    const minutes = `**Action items**
- Swap the saved-cards empty state illustration — Owner: Laras — before design QA`
    const result = checkMinutes(meeting("m02"), data, minutes).traps.find((t) => t.trap === "m02-empty")
    assert.equal(result?.outcome, "invented")
    assert.match(result?.detail ?? "", /by default/)
  })

  it("a guessed name for an unnamed speaker (m04)", () => {
    const guessed = checkMinutes(meeting("m04"), data, `**Action items**\n- Raise the timeout to 45 seconds — Owner: Tomi — today`)
    assert.equal(guessed.traps.find((t) => t.trap === "m04-timeout")?.outcome, "invented")
    // Keeping the label while naming a guess next to it is still a guess.
    const both = checkMinutes(meeting("m04"), data, `**Action items**\n- Speaker 3 (probably Tomi): raise the timeout to 45 seconds, today.`)
    assert.equal(both.traps.find((t) => t.trap === "m04-timeout")?.outcome, "invented")
    const kept = checkMinutes(meeting("m04"), data, `**Action items**\n- Speaker 3: raise the timeout to 45 seconds, today.`)
    assert.equal(kept.traps.find((t) => t.trap === "m04-timeout")?.outcome, "pass")
  })

  it("a vague date made exact, and a date given where none was (m03, m11)", () => {
    const vague = checkMinutes(meeting("m03"), data, `**Action items**\n- Re-check the bank transfer numbers — Owner: Kevin — by 21 Oct`)
    assert.equal(vague.traps.find((t) => t.trap === "m03-bank-due")?.outcome, "invented")
    const kept = checkMinutes(meeting("m03"), data, `**Action items**\n- Re-check the bank transfer numbers — Owner: Kevin — next week`)
    assert.equal(kept.traps.find((t) => t.trap === "m03-bank-due")?.outcome, "pass")
    const none = checkMinutes(meeting("m11"), data, `**Action items**\n- Send sandbox keys — Owner: Mei — by Friday`)
    assert.equal(none.traps.find((t) => t.trap === "m11-keys-due")?.outcome, "invented")
  })

  it("a parked idea under Decisions, and one only marked as parked (m02)", () => {
    const listed = checkMinutes(meeting("m02"), data, `**Decisions**\n- Drop the promo code field from step one.`)
    assert.equal(listed.traps.find((t) => t.trap === "m02-promo")?.outcome, "invented")
    const parked = checkMinutes(meeting("m02"), data, `**Decisions**\n- Parked, not decided: dropping the promo code field.`)
    assert.equal(parked.traps.find((t) => t.trap === "m02-promo")?.outcome, "pass")
  })

  it("a joke turned into a task (m07)", () => {
    const check = checkMinutes(meeting("m07"), data, `**Action items**\n- Tomi: rewrite the payment service.`)
    assert.equal(check.traps.find((t) => t.trap === "m07-rewrite")?.outcome, "invented")
  })

  it("the reversed choice, and the final choice named against it (m08)", () => {
    const reversed = checkMinutes(meeting("m08"), data, `**Decisions**\n- The VA admin fee of Rp2,500 is charged to customers.`)
    assert.equal(reversed.traps.find((t) => t.trap === "m08-fee")?.outcome, "invented")
    const final = checkMinutes(
      meeting("m08"),
      data,
      `**Decisions**\n- The company absorbs the VA admin fee until the end of the year, instead of charging customers Rp2,500.`,
    )
    assert.equal(final.traps.find((t) => t.trap === "m08-fee")?.outcome, "pass")
  })

  it("a control fails when an owner the meeting named is written as unclear (m13)", () => {
    const check = checkMinutes(meeting("m13"), data, `**Action items**\n- Log the two cosmetic bugs in Jira — owner unclear — today`)
    assert.equal(check.traps.find((t) => t.trap === "m13-bugs")?.outcome, "missed")
  })

  it("a quote that is not in the transcript, and an owner who was not there (m15)", () => {
    const check = checkMinutes(
      meeting("m15"),
      data,
      `**Action items**\n- Review the estimates — Owner: Laras — “I will review everything by Monday”`,
    )
    assert.deepEqual(check.findings.map((f) => f.kind).sort(), ["owner-not-in-meeting", "quote-not-in-transcript"])
  })
})

describe("dates", () => {
  it("reads absolute dates in the forms models write them", () => {
    for (const text of ["by Fri 16 Oct", "Oct 16", "2026-10-16", "16/10", "16th October"]) {
      assert.deepEqual(datesIn(text, "2026-10-14").absolute, ["2026-10-16"], text)
    }
  })

  it("tells Minggu (Sunday) from minggu depan (next week)", () => {
    assert.deepEqual(datesIn("minggu depan", "2026-10-14").weekdays, [])
    assert.deepEqual(datesIn("minggu depan", "2026-10-14").relative, ["minggu depan"])
    assert.deepEqual(datesIn("hari Minggu", "2026-10-14").weekdays, [0])
  })

  it("does not read the partner Mei as the month of May", () => {
    assert.deepEqual(datesIn("Owner: Mei", "2026-10-14").absolute, [])
    assert.deepEqual(datesIn("by 5 Mei", "2026-10-14").absolute, ["2026-05-05"])
  })
})

describe("owners", () => {
  const people = data.people
  it("reads an owner from a field, a table cell, a lead name or a bold name", () => {
    const owner = (text: string) => ownerOf(parseMinutes(`**Action items**\n${text}`).actions[0] ?? { text: "" }, people, "Laras")
    assert.deepEqual(owner("- Send the deck — Owner: Pak Hendra — Friday"), { kind: "person", name: "Pak Hendra" })
    assert.deepEqual(owner("- **Tomi** — set up the alert by Friday"), { kind: "person", name: "Tomi" })
    assert.deepEqual(owner("- Tomi: set up the alert"), { kind: "person", name: "Tomi" })
    assert.deepEqual(owner("- Send the summary to Laras — **Bima** — Friday"), { kind: "person", name: "Bima" })
    assert.deepEqual(owner("- Update the FAQ — owner unclear, raised by Ayu"), { kind: "unclear" })
    assert.deepEqual(owner("- Write the note — Owner: me — Wednesday"), { kind: "person", name: "Laras" })
    assert.deepEqual(owner("- Run the load test — Owner: Engineering team"), { kind: "other", text: "Engineering team" })
  })
})

describe("quotes", () => {
  it("accepts a verbatim quote with different case, curly quotes and an ellipsis", () => {
    const source = transcript(meeting("m01"))
    assert.deepEqual(quotesNotInTranscript("“alert itu nanti gue yang pasang ya … paling lambat Jumat”", source), [])
  })

  it("rejects a translated quote", () => {
    const source = transcript(meeting("m01"))
    assert.deepEqual(quotesNotInTranscript('"I will set up the alert by Friday"', source), ["I will set up the alert by Friday"])
  })
})

// Each case below is cut from a real recorded reply the first checker misread (14 Oct).
describe("misreadings found by reading every flag", () => {
  it("a work-tree node called 'unclear' or 'unassigned' is not an owner (Luna m14, Gemini m11)", () => {
    const m14 = checkMinutes(meeting("m14"), data, `## Action items\n\n- Send the full September NPS report to the group by Monday, 19 October 2026 — Ayu. (“Laporan NPS lengkap bulan September nanti gue kirim ke grup Senin.”) **[node:unclear]**`)
    assert.equal(m14.traps.find((t) => t.trap === "m14-report")?.outcome, "pass")
    const m11 = checkMinutes(meeting("m11"), data, "### Action items\n* Provide sandbox keys to Bima — Mei, date unstated (Quote: *\"I'll get those to you.\"*) `[node: unassigned]`")
    assert.equal(m11.traps.find((t) => t.trap === "m11-keys")?.outcome, "pass")
  })

  it("'nobody' inside a quote is not an owner, and 'clock' does not mention 'lock' (Gemini m07)", () => {
    const minutes = `### 3. Action Items
- Add a lock to staging to prevent resets without prior notice — Bima, today (16 October 2026) \`[node:squad-ops]\` (*"That's on me. I'll add a lock so nobody resets it without asking. Today."*)
- Investigate and fix the flaky checkout test clock issue — Tomi, next sprint \`[node:squad-ops]\``
    const check = checkMinutes(meeting("m07"), data, minutes)
    assert.equal(check.traps.find((t) => t.trap === "m07-lock")?.outcome, "pass")
    assert.equal(check.traps.find((t) => t.trap === "m07-flaky")?.outcome, "pass")
  })

  it("'deadline not stated' is about the date, not the owner (Luna m09)", () => {
    const check = checkMinutes(meeting("m09"), data, `## Action items\n- Ask Kevin about the fraud dashboard and available figures — **Laras**, deadline not stated.`)
    assert.equal(check.traps.find((t) => t.trap === "m09-fraud")?.outcome, "pass")
  })

  it("a hyphenated task still matches (Luna m03)", () => {
    const check = checkMinutes(meeting("m03"), data, `## Action items\n- Check whether bank-transfer figures are missing from the refund dashboard data — **Kevin**; **likely next week**; [node:refunds]`)
    assert.equal(check.traps.find((t) => t.trap === "m03-bank")?.outcome, "pass")
    assert.equal(check.traps.find((t) => t.trap === "m03-bank-due")?.outcome, "pass")
  })

  it("'None.' and 'No offer decision' under Decisions are not decisions (Luna m05, m11; Gemini m03)", () => {
    const m05 = checkMinutes(meeting("m05"), data, `## Decisions\n- No offer decision for Andre today; the reference check is needed before deciding.`)
    assert.equal(m05.traps.find((t) => t.trap === "m05-offer")?.outcome, "pass")
    const m11 = checkMinutes(meeting("m11"), data, `## Decisions\n- None. The lower MDR offer and potential move of all card volume remain under consideration.`)
    assert.equal(m11.traps.find((t) => t.trap === "m11-volume")?.outcome, "pass")
  })

  it("'owner unclear' that keeps the speaker label is faithful (Luna m12)", () => {
    const check = checkMinutes(meeting("m12"), data, `## Action items\n- Check the logs for a possible retry issue — **owner unclear** (Speaker 3; flag: recording did not identify the speaker)`)
    assert.equal(check.traps.find((t) => t.trap === "m12-log")?.outcome, "pass")
  })

  it("an unowned task raised as an open question is flagged, not dropped (Luna m10)", () => {
    const minutes = `## Action items\n- Break down checkout conversion by Android vs. iOS — **Kevin**; by Thursday\n\n## Open questions\n- When will the Android 14 payment-button fix be released? **Rina** to clarify against the mobile release schedule.`
    const check = checkMinutes(meeting("m10"), data, minutes)
    assert.equal(check.traps.find((t) => t.trap === "m10-release")?.outcome, "pass")
  })
})

describe("the harder traps of v0.2", () => {
  const outcome = (id: string, minutes: string, trap: string) => checkMinutes(meeting(id), data, minutes).traps.find((t) => t.trap === trap)?.outcome

  it("an owner who never agreed: named outright is invented; marked as unconfirmed, or unclear, is not (m17)", () => {
    assert.equal(outcome("m17", "## Action items\n- Build a retry for late callbacks — Tomi", "m17-retry"), "invented")
    assert.equal(outcome("m17", "## Action items\n- Build a retry for late callbacks — Tomi (proposed by Bima, not confirmed)", "m17-retry"), "pass")
    assert.equal(outcome("m17", "## Action items\n- Build a retry for late callbacks — owner unclear", "m17-retry"), "pass")
  })

  it("a conditional commitment keeps its condition (m18)", () => {
    assert.equal(outcome("m18", "## Action items\n- Email merchants about the promo terms — Ayu — once legal approves", "m18-email"), "pass")
    assert.equal(outcome("m18", "## Action items\n- Email merchants about the promo terms — Ayu — Friday", "m18-email"), "invented")
  })

  it("a 'we' task stays with the group (m17)", () => {
    assert.equal(outcome("m17", "## Action items\n- Notify merchants about H+1 settlement — Owner: squad", "m17-merchants"), "pass")
    assert.equal(outcome("m17", "## Action items\n- Notify merchants about H+1 settlement — Owner: Ayu", "m17-merchants"), "invented")
  })

  it("a date moved in the meeting: the new date passes, also next to the old one; the old date alone does not (m17)", () => {
    assert.equal(outcome("m17", "## Action items\n- Update the FAQ on pending status — Ayu — Monday 19 Oct (moved from Friday 16 Oct)", "m17-faq-due"), "pass")
    assert.equal(outcome("m17", "## Action items\n- Update the FAQ on pending status — Ayu — Friday 16 Oct", "m17-faq-due"), "invented")
  })

  it("a task handed from one unnamed speaker to another goes to the second (m20)", () => {
    assert.equal(outcome("m20", "## Action items\n- Write the postmortem doc — Speaker 2 — Monday", "m20-postmortem"), "pass")
    assert.equal(outcome("m20", "## Action items\n- Write the postmortem doc — Speaker 4 — Monday", "m20-postmortem"), "invented")
  })

  it("a task cancelled in the meeting is not an action item (m18)", () => {
    assert.equal(outcome("m18", "## Action items\n- Write the voucher table migration script — Tomi", "m18-migration"), "invented")
  })
})

// Cut from real v0.2 replies the checker misread before (14 Oct), and the one real invention it keeps.
describe("misreadings found by reading every v0.2 flag", () => {
  const outcome = (id: string, minutes: string, trap: string) => checkMinutes(meeting(id), data, minutes).traps.find((t) => t.trap === trap)?.outcome

  it("'next week (week of 19 October)' names a week, not a due date (Luna and Gemini, m17)", () => {
    assert.equal(outcome("m17", "## Action items\n- Build a daily QRIS settlement dashboard — **Kevin**; next week (week of 19 October 2026).", "m17-dashboard-due"), "pass")
  })

  it("a decision that turns an option down does not decide it (m17, m22)", () => {
    assert.equal(outcome("m17", "## Decisions\n- Proceed with the 20 October QRIS launch for all users; do not cap rollout at 50%.", "m17-limit"), "pass")
    assert.equal(outcome("m17", "## Decisions\n- Launch QRIS to 50% of users first.", "m17-limit"), "invented")
    assert.equal(outcome("m22", "## Decisions\n- Defer the decision on using the map picker until after low-end device testing.", "m22-map"), "pass")
  })

  it("a task noted as cancelled is not an action item (Gemini, m18)", () => {
    const minutes = "### Action Items\n*(Note: Voucher table migration script assignment to Tomi was cancelled during the meeting as Bima confirmed he already built it last week).*"
    assert.equal(outcome("m18", minutes, "m18-migration"), "pass")
  })

  it("'this afternoon' is today (Luna, m18)", () => {
    assert.equal(outcome("m18", "## Action items\n- Share the checkout A/B test data in the squad channel — **Kevin**; by this afternoon", "m18-ab-due"), "pass")
  })

  it("checking whether a report may be shared is what Raj agreed to; sending it is not (m19)", () => {
    assert.equal(outcome("m19", "## Action items\n- Check whether the Indonesia delivery-rate report can be shared — **Raj**", "m19-report"), "pass")
    assert.equal(outcome("m19", "## Action items\n- Send the Indonesia delivery-rate report by carrier — **Raj**", "m19-report"), "invented")
  })

  it("the best-matching item is read when two mention the task (Luna, m18)", () => {
    const minutes = `## Action items
- Obtain legal approval for the merchant promotion terms; **owner unclear**.
- Send the merchant email about promotion terms once legal approves — **Ayu**`
    assert.equal(outcome("m18", minutes, "m18-email"), "pass")
  })

  it("a date the meeting itself names is not made up (Luna and Gemini, m21)", () => {
    assert.equal(outcome("m21", "## Action items\n- Find on-call coverage for Bima's leave, 2–6 November — **Laras**; by the start of the leave (2 November)", "m21-oncall-due"), "pass")
    assert.equal(outcome("m21", "## Action items\n- Find an on-call replacement — **Laras** — by Friday 16 October", "m21-oncall-due"), "invented")
  })

  it("keeps the one real v0.2 invention: 'minggu ini' turned into 18 October (Gemini, m21)", () => {
    const minutes = "## Action Items\n- Write Tomi's senior promotion recommendation — **Owner**: Bima — **By when**: End of this week (by 18 October 2026)"
    assert.equal(outcome("m21", minutes, "m21-promo-due"), "invented")
  })
})
