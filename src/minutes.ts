/**
 * Reads minutes written in markdown into sections and items. The minutes come from different
 * models in different shapes: headings or bold labels, bullets or numbered items, nested
 * sub-bullets, or a table. Only the structure is read here; what the items say is checked in
 * check.ts.
 */

export type SectionKind = "decisions" | "actions" | "questions" | "summary" | "other"

export interface Item {
  /** The item's text, with any nested sub-items joined on with " | ". */
  text: string
  /** For a table row: each cell under its header, lower-cased header names. */
  cells?: Record<string, string>
}

export interface Section {
  kind: SectionKind
  title: string
  items: Item[]
}

export interface Minutes {
  sections: Section[]
  decisions: Item[]
  actions: Item[]
  questions: Item[]
}

const KINDS: [SectionKind, RegExp][] = [
  ["questions", /open question|question|pertanyaan|unresolved|open issue|open item|parked/i],
  ["decisions", /decision|keputusan|decided|agreed/i],
  ["actions", /action|tindak lanjut|to-?do|next step|follow-?up|tugas/i],
  ["summary", /summary|purpose|ringkasan|overview|tl;?dr|about|what .* (for|about)/i],
]

export function sectionKind(title: string): SectionKind {
  for (const [kind, pattern] of KINDS) if (pattern.test(title)) return kind
  return "other"
}

const LIST_ITEM = /^(\s*)(?:[-*+•]|\d+[.)])\s+(.*)$/

/** A line that opens a section: a markdown heading, a bold-only line, or a short "Title:" line. */
function heading(line: string): string | null {
  const hash = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)
  if (hash?.[1]) return hash[1].replace(/\*\*/g, "").trim()
  const bold = /^\s*(?:\d+[.)]\s*)?\*\*([^*]+?)\*\*\s*:?\s*$/.exec(line)
  if (bold?.[1]) return bold[1].trim()
  const label = /^\s*(?:\d+[.)]\s*)?\*\*([^*]+?)\*\*\s*[—–:-]\s*(.*)$/.exec(line)
  if (label?.[1] && sectionKind(label[1]) !== "other" && !LIST_ITEM.test(line.replace(/\*\*[^*]+\*\*/, "x"))) {
    return label[1].trim()
  }
  const plain = /^\s*([A-Za-z][\w /&-]{2,40}):\s*$/.exec(line)
  if (plain?.[1] && sectionKind(plain[1]) !== "other") return plain[1].trim()
  return null
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim())
}

function isSeparatorRow(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)
}

export function parseMinutes(text: string): Minutes {
  const sections: Section[] = []
  let current: Section = { kind: "other", title: "", items: [] }
  sections.push(current)
  let parentIndent = -1
  let tableHeader: string[] | null = null

  const lines = text.replace(/\r\n/g, "\n").split("\n")
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "")
    if (!line.trim()) {
      tableHeader = null
      continue
    }

    const title = heading(line)
    if (title !== null) {
      current = { kind: sectionKind(title), title, items: [] }
      sections.push(current)
      parentIndent = -1
      tableHeader = null
      // "**Decisions** — none" keeps its text as an item.
      const rest = /\*\*[^*]+\*\*\s*[—–:-]\s*(.+)$/.exec(line)?.[1]
      if (rest) current.items.push({ text: rest.trim() })
      continue
    }

    if (line.trim().startsWith("|")) {
      if (isSeparatorRow(line)) continue
      const cells = splitRow(line)
      if (tableHeader === null) {
        tableHeader = cells.map((c) => c.replace(/\*\*/g, "").toLowerCase())
        continue
      }
      const map: Record<string, string> = {}
      tableHeader.forEach((name, i) => {
        map[name] = cells[i] ?? ""
      })
      current.items.push({ text: cells.join(" | "), cells: map })
      continue
    }

    const item = LIST_ITEM.exec(line)
    if (item) {
      const indent = item[1]?.length ?? 0
      const body = item[2] ?? ""
      const last = current.items.at(-1)
      if (last && parentIndent >= 0 && indent >= parentIndent + 2) {
        last.text += ` | ${body}`
      } else {
        current.items.push({ text: body })
        parentIndent = indent
      }
      continue
    }

    // A wrapped line belongs to the item above it; prose before any item is an item of its own.
    const last = current.items.at(-1)
    if (last && /^\s+/.test(raw)) last.text += ` ${line.trim()}`
    else current.items.push({ text: line.trim() })
  }

  const of = (kind: SectionKind) => sections.filter((s) => s.kind === kind).flatMap((s) => s.items)
  return {
    sections: sections.filter((s) => s.items.length > 0 || s.title),
    decisions: of("decisions"),
    actions: of("actions"),
    questions: of("questions"),
  }
}
