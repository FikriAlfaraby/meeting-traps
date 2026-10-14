import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

import type { Meeting } from "./data.ts"
import { transcript } from "./data.ts"

const read = (name: string) => readFileSync(new URL(`../prompts/${name}`, import.meta.url), "utf8")

/** The command's body as Claude Code sends it: front matter removed, the transcript as its argument. */
export function commandBody(): string {
  return read("meeting-notes.md").replace(/^---\n[\s\S]*?\n---\n/, "").trim()
}

export interface Prompt {
  system: string
  user: string
}

export function buildPrompt(meeting: Meeting): Prompt {
  return { system: read("profile.md").trim(), user: commandBody().replace("$ARGUMENTS", transcript(meeting)) }
}

/** Changes whenever the command or the profile changes, so a recording names the prompt it used. */
export function promptHash(): string {
  return createHash("sha256").update(read("meeting-notes.md")).update("\n---\n").update(read("profile.md")).digest("hex").slice(0, 16)
}
