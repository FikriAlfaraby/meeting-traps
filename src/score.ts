import { readFileSync, writeFileSync } from "node:fs"
import { basename } from "node:path"

import type { Finding, MeetingCheck, Outcome } from "./check.ts"
import { checkMinutes } from "./check.ts"
import type { Trap } from "./data.ts"
import { loadDataset } from "./data.ts"
import type { Recording } from "./record.ts"

/**
 * Scores recordings with no network: every reply goes through check.ts.
 *
 *   node src/score.ts recordings/<name>.json [...]
 *
 * Writes results/<name>.json and prints one line per model.
 */

export type Counts = Record<Outcome, number>

export interface Summary {
  replies: number
  truncated: number
  outcomes: Counts
  byKind: Partial<Record<Trap["kind"], Counts>>
  findings: Partial<Record<Finding["kind"], number>>
}

export interface Result {
  recording: string
  recordedAt: string
  model: Recording["model"]
  promptHash: string
  summary: Summary
  runs: (MeetingCheck & { repeat: number })[]
}

const zero = (): Counts => ({ pass: 0, invented: 0, missed: 0, review: 0 })

export function score(recording: Recording, path: string): Result {
  const data = loadDataset()
  const runs = recording.runs.map((run) => {
    const meeting = data.meetings.find((m) => m.id === run.meeting)
    if (!meeting) throw new Error(`${path}: no meeting ${run.meeting} in the data`)
    return { ...checkMinutes(meeting, data, run.reply), repeat: run.repeat }
  })
  const summary: Summary = {
    replies: recording.runs.length,
    truncated: recording.runs.filter((r) => r.finish === "length" || r.finish === "max_tokens").length,
    outcomes: zero(),
    byKind: {},
    findings: {},
  }
  for (const run of runs) {
    for (const t of run.traps) {
      summary.outcomes[t.outcome] += 1
      const counts = (summary.byKind[t.kind] ??= zero())
      counts[t.outcome] += 1
    }
    for (const f of run.findings) summary.findings[f.kind] = (summary.findings[f.kind] ?? 0) + 1
  }
  return { recording: path, recordedAt: recording.recordedAt, model: recording.model, promptHash: recording.promptHash, summary, runs }
}

function main(): void {
  const paths = process.argv.slice(2)
  if (paths.length === 0) {
    console.error("Usage: node src/score.ts recordings/<name>.json [...]")
    process.exit(2)
  }
  for (const path of paths) {
    const result = score(JSON.parse(readFileSync(path, "utf8")) as Recording, path)
    writeFileSync(`results/${basename(path)}`, `${JSON.stringify(result, null, 2)}\n`)
    const o = result.summary.outcomes
    const f = result.summary.findings
    console.log(
      `${result.model.name.padEnd(20)} replies ${result.summary.replies}  pass ${o.pass}  invented ${o.invented}  missed ${o.missed}  review ${o.review}  ` +
        `quotes not in transcript ${f["quote-not-in-transcript"] ?? 0}  owners not at the meeting ${f["owner-not-in-meeting"] ?? 0}`,
    )
  }
}

if (import.meta.main) main()
