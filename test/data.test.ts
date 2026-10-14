import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { describe, it } from "node:test"

import { loadDataset } from "../src/data.ts"
import type { Recording } from "../src/record.ts"
import { score } from "../src/score.ts"

const data = loadDataset()
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const weekday = (iso: string) => WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()]

describe("the meetings", () => {
  it("have unique ids, and so do their traps", () => {
    const meetings = data.meetings.map((m) => m.id)
    const traps = data.meetings.flatMap((m) => m.traps.map((t) => t.id))
    assert.equal(new Set(meetings).size, meetings.length)
    assert.equal(new Set(traps).size, traps.length)
  })

  it("say the right weekday for their date", () => {
    for (const m of data.meetings) assert.equal(m.weekday, weekday(m.date), m.id)
  })

  it("only have speakers who attended, or unnamed speaker labels when the recording did not say", () => {
    for (const m of data.meetings) {
      for (const [speaker] of m.lines) {
        if (m.speakersUnresolved) assert.match(speaker, /^(Speaker|Pembicara) \d+$/, m.id)
        else assert.ok(m.attendees.includes(speaker), `${m.id}: ${speaker} is not an attendee`)
      }
    }
  })

  it("give owned tasks to someone in the room, and name everyone the checker must recognise", () => {
    for (const m of data.meetings) {
      for (const t of m.traps) {
        if (t.kind === "owned") assert.ok(m.attendees.includes(t.owner), `${t.id}: ${t.owner}`)
      }
      for (const name of m.attendees) assert.ok(data.people.includes(name), `${m.id}: ${name} missing from people`)
    }
  })

  it("set each named due date after its meeting, within a week", () => {
    for (const m of data.meetings) {
      for (const t of m.traps) {
        if (t.kind !== "due-exact") continue
        const days = (Date.parse(t.date) - Date.parse(m.date)) / 86_400_000
        assert.ok(days >= 0 && days <= 7, `${t.id}: ${days} days`)
      }
    }
  })
})

describe("the published results", () => {
  for (const file of readdirSync(new URL("../recordings/", import.meta.url)).filter((f) => f.endsWith(".json"))) {
    it(`follow from recordings/${file}`, () => {
      const recording = JSON.parse(readFileSync(new URL(`../recordings/${file}`, import.meta.url), "utf8")) as Recording
      const published = JSON.parse(readFileSync(new URL(`../results/${file}`, import.meta.url), "utf8")) as unknown
      assert.deepEqual(score(recording, `recordings/${file}`), published)
    })
  }

  it("are quoted in the README", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8")
    const total = data.meetings.reduce((n, m) => n + m.traps.length, 0)
    for (const file of readdirSync(new URL("../results/", import.meta.url)).filter((f) => f.endsWith(".json"))) {
      const result = JSON.parse(readFileSync(new URL(`../results/${file}`, import.meta.url), "utf8")) as ReturnType<typeof score>
      const o = result.summary.outcomes
      const row = `| ${result.model.name} | ${o.pass} of ${total} | ${o.invented} | ${o.missed} | ${o.review} |`
      assert.ok(readme.includes(row), `README is missing: ${row}`)
    }
    const traps = data.meetings.flatMap((m) => m.traps)
    const controls = traps.filter((t) => t.kind === "owned" || t.kind === "due-exact" || t.kind === "decided").length
    assert.ok(readme.includes(`${data.meetings.length} meetings`), "meeting count")
    assert.ok(readme.includes(`${total} checks: ${total - controls} traps`), "trap count")
    assert.ok(readme.includes(`${controls} controls`), "control count")
    const lines = data.meetings.map((m) => m.lines.length)
    assert.ok(readme.includes(`${Math.min(...lines)} to ${Math.max(...lines)} lines`), "meeting length")
  })
})
