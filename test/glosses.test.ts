import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { describe, it } from "node:test"

import { loadDataset } from "../src/data.ts"
import { buildPrompt } from "../src/prompt.ts"

interface Glosses {
  about: string
  meetings: Record<string, [line: string, gloss: string | null][]>
  quotes: Record<string, string>
}

const data = loadDataset()
const glosses = JSON.parse(readFileSync(new URL("../data/glosses-en.json", import.meta.url), "utf8")) as Glosses
const pairs = Object.values(glosses.meetings).flat()

/** Common Indonesian words that English never uses: a line with one of them needs a gloss. */
const INDONESIAN =
  /\b(yang|gue|lo|nggak|udah|sudah|kita|itu|ini|dan|di|ke|ya|aja|nanti|ntar|deh|sih|tolong|bisa|soal|buat|sama|harus|belum|minggu|besok|hari|tapi|kalau|oke|sip|iya|setuju|sepakat|kenapa|betul|makasih|gampang|banget|lagi|juga|gimana|siap|mantap)\b/i

/** The lines of the mixed meetings that are English as spoken, so they carry no gloss. */
const ALREADY_ENGLISH = new Set(["Thanks Kev."])

/** Days and spans a gloss must keep: a wrong one would misstate a due date the checks are about. */
const DAYS: [RegExp, RegExp][] = [
  [/\bsenin\b/i, /\bMonday\b/],
  [/\bselasa\b/i, /\bTuesday\b/],
  [/\brabu\b/i, /\bWednesday\b/],
  [/\bkamis\b/i, /\bThursday\b/],
  [/\bjumat\b/i, /\bFriday\b/],
  [/\bsabtu\b/i, /\bSaturday\b/],
  [/\bseptember\b/i, /\bSeptember\b/],
  [/\boktober\b/i, /\bOctober\b/],
  [/\bnovember\b/i, /\bNovember\b/],
  [/\bjanuari\b/i, /\bJanuary\b/],
  [/\bbesok\b/i, /\btomorrow\b/i],
  [/\bhari ini\b/i, /\btoday\b/i],
  [/\bsore ini\b/i, /\bthis afternoon\b/i],
  [/\bminggu ini\b/i, /\bthis week\b/i],
  [/\bminggu depan\b/i, /\bnext week\b/i],
  [/\bminggu lalu\b/i, /\blast week/i],
  [/\btahun ini\b/i, /\bthis year\b/i],
  [/\btahun lalu\b/i, /\blast year/i],
  [/\bakhir tahun\b/i, /\bend of the year\b/i],
  [/\bH\+1\b/, /\b(a day later|next-day)\b/],
]

/** "2.500" and "2,500" are one number, "100 ribu" is 100000, and "11.11" stays a date. */
function numbers(text: string): string[] {
  return [...text.replace(/\bH\+1\b/g, "").matchAll(/(\d+(?:[.,]\d+)*)(\s+ribu\b)?/gi)].map(([, n = "", ribu]) => {
    const whole = /^\d{1,3}(?:[.,]\d{3})+$/.test(n) ? n.replace(/[.,]/g, "") : n
    return ribu ? String(Number(whole) * 1000) : whole
  })
}

/** A quote's key: the quote without the punctuation a model put after it. */
const quoteKey = (quote: string): string => quote.trim().replace(/[\s.,;:]+$/, "")

/** Every Indonesian quote inside the recorded minutes, in the order first seen. */
function quotesInMinutes(): string[] {
  const out = new Set<string>()
  for (const file of readdirSync(new URL("../recordings/", import.meta.url)).filter((f) => f.endsWith(".json")).sort()) {
    const recording = JSON.parse(readFileSync(new URL(`../recordings/${file}`, import.meta.url), "utf8")) as { runs: { reply: string }[] }
    for (const { reply } of recording.runs) {
      for (const [, quote = ""] of reply.matchAll(/["“]([^"”\n]{2,}?)["”]/g)) if (INDONESIAN.test(quote)) out.add(quoteKey(quote))
    }
  }
  return [...out]
}

/** The checks every gloss passes: English, with the numbers, people, short names and days of its line. */
function checkGloss(line: string, gloss: string): void {
  assert.notEqual(gloss.trim(), "", line)
  assert.notEqual(gloss, line)
  assert.doesNotMatch(gloss, INDONESIAN, gloss)
  const english = numbers(gloss)
  for (const n of numbers(line)) assert.ok(english.includes(n), `${n} is missing from: ${gloss}`)
  for (const person of data.people) {
    if (new RegExp(`\\b${person}\\b`).test(line)) assert.match(gloss, new RegExp(`\\b${person}\\b`), gloss)
  }
  for (const [short] of line.matchAll(/\b[A-Z]{2,}\b/g)) assert.match(gloss, new RegExp(`\\b${short}\\b`), gloss)
  for (const [said, meant] of DAYS) if (said.test(line)) assert.match(gloss, meant, `${line} -> ${gloss}`)
}

describe("the English glosses", () => {
  it("cover every line of every meeting that is not in English, in order", () => {
    for (const m of data.meetings.filter((x) => x.language !== "en")) {
      const glossed = glosses.meetings[m.id]
      assert.ok(glossed, `${m.id} has no glosses`)
      assert.deepEqual(glossed.map(([line]) => line), m.lines.map(([, text]) => text), m.id)
    }
  })

  it("exist only for those meetings", () => {
    const notEnglish = new Set(data.meetings.filter((m) => m.language !== "en").map((m) => m.id))
    for (const id of Object.keys(glosses.meetings)) assert.ok(notEnglish.has(id), id)
  })

  it("leave out only the lines that are English as spoken", () => {
    for (const [line, gloss] of pairs) assert.equal(gloss === null, ALREADY_ENGLISH.has(line), line)
  })

  it("are English and keep the numbers, people, short names and days of their line", () => {
    for (const [line, gloss] of pairs) if (gloss !== null) checkGloss(line, gloss)
  })

  it("give every Indonesian quote in the recorded minutes its English, and only those", () => {
    assert.deepEqual(Object.keys(glosses.quotes), quotesInMinutes())
    for (const [quote, gloss] of Object.entries(glosses.quotes)) checkGloss(quote, gloss)
  })

  it("are not needed in the English meetings", () => {
    for (const m of data.meetings.filter((x) => x.language === "en")) {
      for (const [, text] of m.lines) assert.doesNotMatch(text, INDONESIAN, `${m.id}: ${text}`)
    }
  })

  it("never reach the models: each prompt holds the lines as spoken, with nothing between or after them", () => {
    for (const m of data.meetings) {
      const { system, user } = buildPrompt(m)
      const spoken = m.lines.map(([speaker, text]) => `${speaker}: ${text}`).join("\n")
      const at = user.indexOf(spoken)
      assert.ok(at >= 0, `${m.id}: the prompt does not hold the lines as spoken`)
      assert.ok(at + spoken.length === user.length || user[at + spoken.length] === "\n", `${m.id}: text follows the last line`)
      for (const gloss of [...(glosses.meetings[m.id] ?? []).map(([, g]) => g), ...Object.values(glosses.quotes)]) {
        if (gloss && gloss.split(" ").length >= 4) assert.ok(!`${system}\n${user}`.includes(gloss), `${m.id}: ${gloss}`)
      }
    }
  })
})
