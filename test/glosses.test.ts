import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { describe, it } from "node:test"

import { loadDataset } from "../src/data.ts"

interface Glosses {
  about: string
  meetings: Record<string, [line: string, gloss: string | null][]>
}

const data = loadDataset()
const glosses = JSON.parse(readFileSync(new URL("../data/glosses-en.json", import.meta.url), "utf8")) as Glosses
const pairs = Object.values(glosses.meetings).flat()

/** Common Indonesian words that English never uses: a line with one of them needs a gloss. */
const INDONESIAN =
  /\b(yang|gue|lo|nggak|udah|sudah|kita|itu|ini|dan|di|ke|ya|aja|nanti|ntar|deh|sih|tolong|bisa|soal|buat|sama|harus|belum|minggu|besok|hari|tapi|kalau|oke|sip|iya|setuju|sepakat|kenapa|betul|makasih|gampang|banget|lagi|juga|gimana|siap|mantap)\b/i

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

  it("are English: none is empty, repeats its line or keeps an Indonesian word", () => {
    for (const [line, gloss] of pairs) {
      if (gloss === null) continue
      assert.notEqual(gloss.trim(), "", line)
      assert.notEqual(gloss, line)
      assert.doesNotMatch(gloss, INDONESIAN, gloss)
    }
  })

  it("leave out only lines that are already English", () => {
    for (const [line, gloss] of pairs) if (gloss === null) assert.doesNotMatch(line, INDONESIAN, line)
  })

  it("are not needed in the English meetings", () => {
    for (const m of data.meetings.filter((x) => x.language === "en")) {
      for (const [, text] of m.lines) assert.doesNotMatch(text, INDONESIAN, `${m.id}: ${text}`)
    }
  })

  it("never reach the models: no code that builds a prompt reads them", () => {
    for (const file of readdirSync(new URL("../src/", import.meta.url))) {
      assert.doesNotMatch(readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8"), /glosses/, file)
    }
  })
})
