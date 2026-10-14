import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"

import { loadDataset } from "./data.ts"
import type { ModelConfig, Usage } from "./models.ts"
import { complete, cost } from "./models.ts"
import { buildPrompt, promptHash } from "./prompt.ts"

/**
 * Records each model's minutes for every meeting, with no checking: the recording is the
 * evidence, and score.ts reads it later with no network. A recording that already exists is
 * resumed, so an interrupted run never pays twice for the same reply.
 *
 *   node src/record.ts <model.json> <out.json> [--runs N] [--budget USD] [--only m01,m02]
 *
 * With --budget, the run stops before the call that could take spending past the budget.
 */

export interface RecordedRun {
  meeting: string
  repeat: number
  reply: string
  finish: string | null
  usage: Usage | null
  usd: number
}

export interface Recording {
  recordedAt: string
  model: Omit<ModelConfig, "apiKeyEnv">
  promptHash: string
  runs: RecordedRun[]
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function save(path: string, recording: Recording): void {
  recording.runs.sort((a, b) => a.meeting.localeCompare(b.meeting) || a.repeat - b.repeat)
  writeFileSync(`${path}.tmp`, `${JSON.stringify(recording, null, 2)}\n`)
  renameSync(`${path}.tmp`, path)
}

async function main(): Promise<void> {
  const [configPath, out] = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"))
  if (!configPath || !out) {
    console.error("Usage: node src/record.ts <model.json> <out.json> [--runs N] [--budget USD] [--only m01,m02]")
    process.exit(2)
  }
  const config = JSON.parse(readFileSync(configPath, "utf8")) as ModelConfig
  const runs = Number(arg("runs") ?? 1)
  const budget = arg("budget") === undefined ? Infinity : Number(arg("budget"))
  const only = arg("only")?.split(",")
  const meetings = loadDataset().meetings.filter((m) => !only || only.includes(m.id))

  // The recording names the model, never where its key lives.
  const model: Omit<ModelConfig, "apiKeyEnv"> = {
    name: config.name,
    provider: config.provider,
    model: config.model,
    endpoint: config.endpoint,
    maxTokens: config.maxTokens,
    ...(config.price ? { price: config.price } : {}),
  }
  const recording: Recording = existsSync(out)
    ? (JSON.parse(readFileSync(out, "utf8")) as Recording)
    : { recordedAt: new Date().toISOString(), model, promptHash: promptHash(), runs: [] }
  if (recording.promptHash !== promptHash()) throw new Error(`${out} was recorded with another prompt; record to a new file`)

  const done = new Set(recording.runs.map((r) => `${r.meeting}#${r.repeat}`))
  const todo = meetings.flatMap((m) => Array.from({ length: runs }, (_, repeat) => ({ meeting: m, repeat }))).filter((t) => !done.has(`${t.meeting.id}#${t.repeat}`))
  let spent = recording.runs.reduce((sum, r) => sum + r.usd, 0)
  let largest = recording.runs.reduce((max, r) => Math.max(max, r.usd), 0)
  let stopped = false

  const worker = async (): Promise<void> => {
    for (;;) {
      const task = todo.shift()
      if (!task) return
      // Leave room for one more call as large as the largest so far.
      if (spent + Math.max(largest, 0.05) > budget) {
        stopped = true
        return
      }
      const prompt = buildPrompt(task.meeting)
      const reply = await complete(config, prompt.system, prompt.user)
      const usd = cost(config, reply.usage)
      spent += usd
      largest = Math.max(largest, usd)
      recording.runs.push({ meeting: task.meeting.id, repeat: task.repeat, reply: reply.text, finish: reply.finish, usage: reply.usage, usd })
      save(out, recording)
      console.error(`${config.name} ${task.meeting.id}#${task.repeat} ${reply.finish ?? "?"} ${reply.usage ? `${reply.usage.input}+${reply.usage.output} tokens` : ""} $${spent.toFixed(4)}`)
    }
  }
  await Promise.all(Array.from({ length: 4 }, () => worker()))
  save(out, recording)
  console.error(`${stopped ? "Stopped at the budget" : "Done"}: ${recording.runs.length} replies, $${spent.toFixed(4)} spent, in ${out}`)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
