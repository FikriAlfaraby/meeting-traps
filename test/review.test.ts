import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"

import type { Result } from "../src/score.ts"

interface Flag {
  set: "v0.1" | "v0.2"
  model: string
  run: number
  trap: string
  flagged: string
  verdict: "real" | "misread" | "faithful"
  type: string
  why: string
}

const review = JSON.parse(readFileSync(new URL("../review/flags.json", import.meta.url), "utf8")) as { flags: Flag[] }
const result = (set: string, model: string) =>
  JSON.parse(readFileSync(new URL(`../results/2026-10-14-${model}${set === "v0.2" ? "-v0.2" : ""}.json`, import.meta.url), "utf8")) as Result
const key = (f: { set: string; model: string; run: number; trap: string }) => `${f.set} ${f.model} #${f.run} ${f.trap}`

describe("the review of every first-pass flag", () => {
  it("calls real exactly what the checker still flags today", () => {
    const today: string[] = []
    for (const set of ["v0.1", "v0.2"]) {
      for (const model of ["gpt-6-luna", "gemini-3.8-flash"]) {
        for (const run of result(set, model).runs) {
          for (const t of run.traps) if (t.outcome !== "pass") today.push(key({ set, model, run: run.repeat, trap: t.trap }))
        }
      }
    }
    const real = review.flags.filter((f) => f.verdict === "real").map(key)
    assert.deepEqual(real.sort(), today.sort())
  })

  it("lists each flag once, with a reason", () => {
    const keys = review.flags.map(key)
    assert.equal(new Set(keys).size, keys.length)
    for (const f of review.flags) assert.ok(f.why.length > 10 && f.type.length > 0, key(f))
  })
})
