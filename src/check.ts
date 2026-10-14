import type { Dataset, Meeting, Trap } from "./data.ts"
import { transcript } from "./data.ts"
import type { Item, Minutes } from "./minutes.ts"
import { parseMinutes } from "./minutes.ts"

/**
 * Checks one set of minutes against the traps of its meeting. Every outcome is one of:
 *   pass      the minutes did what a faithful minute-taker does;
 *   invented  they state something the meeting did not: an owner, a date, a decision, a task;
 *   missed    they leave out or blur something the meeting did state (a control failed);
 *   review    the checker cannot tell; a person reads it.
 * Plus two checks over the whole text: quotes that are not in the transcript, and owners who
 * were not in the meeting.
 */

export type Outcome = "pass" | "invented" | "missed" | "review"

export interface TrapResult {
  trap: string
  kind: Trap["kind"]
  outcome: Outcome
  detail: string
  /** The action item or decision the outcome is about, as the minutes wrote it. */
  item?: string
}

export type FindingKind = "quote-not-in-transcript" | "owner-not-in-meeting"

export interface Finding {
  kind: FindingKind
  detail: string
}

export interface MeetingCheck {
  meeting: string
  traps: TrapResult[]
  findings: Finding[]
}

// --- owners -------------------------------------------------------------------------------

export type Owner =
  | { kind: "unclear" }
  | { kind: "person"; name: string }
  | { kind: "label"; label: string }
  | { kind: "other"; text: string }
  | { kind: "none" }
  | { kind: "ambiguous"; names: string[] }

const UNCLEAR =
  /\b(owner unclear|unclear|unassigned|not assigned|no owner|no one|nobody|not named|not stated|tbd|tba|to be (?:confirmed|decided|assigned|determined)|belum jelas|belum ada|tidak jelas|tidak ada)\b|\?{2,}|⚠/i
/** Stricter than UNCLEAR: for a whole item, where "not stated" may be about the date. */
const OWNER_UNCLEAR = /\b(owner unclear|unclear owner|owner:?\s*unclear|no owner|unassigned owner|owner tbd|owner not (?:named|stated|given|clear|set))\b/i
const LABEL = /\b(?:speaker|pembicara)\s*(\d+)\b/i
const SELF = /^(?:me|myself|you|saya|aku|i)\b/i
const OWNER_FIELD =
  /\b(?:owner|pic|assignee|assigned to|who|penanggung jawab|oleh)\b\s*\**\s*[:：=]?\s*\**\s*([^|—–;\n]+)/i

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Names that occur in the text, in the order they first appear. */
export function namesIn(text: string, people: string[]): string[] {
  const found: { name: string; at: number }[] = []
  for (const name of people) {
    const at = text.search(new RegExp(`\\b${escapeRegex(name)}\\b`))
    if (at >= 0) found.push({ name, at })
  }
  // "Pak Hendra" contains no other name, but keep the longest match when two overlap.
  return found.sort((a, b) => a.at - b.at).map((f) => f.name)
}

/** What an owner field says: a person, a speaker label, unclear, or something else (a team). */
export function classifyOwner(field: string, people: string[], me: string): Owner {
  const text = field.replace(/\*\*/g, "").trim()
  if (UNCLEAR.test(text)) return { kind: "unclear" }
  const label = LABEL.exec(text)
  if (label) return { kind: "label", label: `Speaker ${label[1]}` }
  const names = namesIn(text, people)
  if (names[0]) return { kind: "person", name: names[0] }
  if (SELF.test(text)) return { kind: "person", name: me }
  if (!text || /^[-–—]+$/.test(text)) return { kind: "none" }
  return { kind: "other", text }
}

/** An owner only when the segment is little more than the owner: "Tomi", "Pak Hendra", "Speaker 3", "owner unclear". */
function bareOwner(segment: string, people: string[], me: string): Owner | null {
  const text = segment.replace(/\*\*/g, "").trim()
  const owner = classifyOwner(text, people, me)
  if (owner.kind === "unclear") return text.length <= 40 ? owner : null
  if (owner.kind === "label") return text.length <= owner.label.length + 4 ? owner : null
  if (owner.kind === "person") return text.replace(/^pak\s+/i, "").length <= owner.name.length + 2 ? owner : null
  return null
}

/**
 * An item without what is never its owner: the work-tree node ("[node:unassigned]") and quoted
 * words ("so nobody resets it"), which can hold names and words like "nobody".
 */
export function ownerText(text: string): string {
  return text
    .replace(/`?\[node:[^\]]*\]`?/gi, " ")
    .replace(/\*?[“"][^“”"]*[”"]\*?/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** The owner of an action item, read from an owner column or field when there is one. */
export function ownerOf(item: Item, people: string[], me: string): Owner {
  if (item.cells) {
    const column = Object.keys(item.cells).find((name) => /owner|who|pic|assignee|penanggung|siapa/.test(name))
    if (column !== undefined) return classifyOwner(ownerText(item.cells[column] ?? ""), people, me)
  }
  const text = ownerText(item.text)
  const field = OWNER_FIELD.exec(text)
  if (field?.[1]) return classifyOwner(field[1], people, me)
  if (OWNER_UNCLEAR.test(text)) return { kind: "unclear" }

  // "**Tomi** — set up the alert" or "Tomi: set up the alert"
  const lead = /^\s*\**\s*([^*:—–]+?)\s*\**\s*[:—–]\s/.exec(text)
  const leadOwner = lead?.[1] ? bareOwner(lead[1], people, me) : null
  if (leadOwner) return leadOwner
  // A segment that is just a name, looked for in this order: bold ("**Tomi**"), a part between
  // dashes or semicolons up to its first comma ("— Tomi, by Friday"), then brackets ("(Tomi)").
  const bold = [...text.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1] ?? "")
  const parts = text
    .split(/\s[—–]\s|;|\s\|\s/)
    .slice(1)
    .map((part) => part.replace(/\([^()]*\)/g, " ").split(/[,.]/)[0] ?? "")
  const brackets = [...text.matchAll(/\(([^()]+)\)/g)].map((m) => m[1] ?? "")
  for (const segment of [...bold, ...parts, ...brackets]) {
    const owner = bareOwner(segment, people, me)
    if (owner) return owner
  }
  const label = LABEL.exec(text)
  if (label) return { kind: "label", label: `Speaker ${label[1]}` }
  const names = namesIn(text, people)
  if (names.length === 1 && names[0]) return { kind: "person", name: names[0] }
  if (names.length > 1) return { kind: "ambiguous", names }
  return { kind: "none" }
}

function describe(owner: Owner): string {
  switch (owner.kind) {
    case "unclear":
      return "owner unclear"
    case "person":
      return owner.name
    case "label":
      return owner.label
    case "other":
      return `"${owner.text}"`
    case "none":
      return "no owner given"
    case "ambiguous":
      return `several names (${owner.names.join(", ")})`
  }
}

// --- dates --------------------------------------------------------------------------------

const MONTH_NUMBER: [RegExp, number][] = [
  [/^jan/i, 1], [/^feb/i, 2], [/^mar/i, 3], [/^apr/i, 4], [/^(may|mei)/i, 5], [/^jun/i, 6],
  [/^jul/i, 7], [/^(aug|agu|agt)/i, 8], [/^sep/i, 9], [/^(oct|okt)/i, 10], [/^nov/i, 11], [/^(dec|des)/i, 12],
]
const MONTH_WORD =
  "(?:jan(?:uary|uari)?|feb(?:ruary|ruari)?|mar(?:ch|et)?|apr(?:il)?|may|mei|jun(?:e|i)?|jul(?:y|i)?|aug(?:ust)?|agu(?:stus)?|agt|sep(?:t(?:ember)?)?|oct(?:ober)?|okt(?:ober)?|nov(?:ember)?|dec(?:ember)?|des(?:ember)?)"
const DAY_MONTH = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_WORD}\\b`, "gi")
const MONTH_DAY = new RegExp(`\\b${MONTH_WORD}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "gi")
const ISO = /\b(20\d\d)-(\d{2})-(\d{2})\b/g
const SLASH = /\b(\d{1,2})\/(\d{1,2})(?:\/(?:20)?\d\d)?\b/g

const WEEKDAYS: [RegExp, number][] = [
  [/\b(sunday|sun|hari minggu|minggu (?:malam|pagi|sore|siang))\b/i, 0],
  [/\b(monday|mon|senin)\b/i, 1],
  [/\b(tuesday|tue|tues|selasa)\b/i, 2],
  [/\b(wednesday|wed|rabu)\b/i, 3],
  [/\b(thursday|thu|thurs|kamis)\b/i, 4],
  [/\b(friday|fri|jumat|jum'at)\b/i, 5],
  [/\b(saturday|sat|sabtu)\b/i, 6],
]
const TODAY = /\b(today|tonight|eod|end of (?:the )?day|this (?:morning|afternoon|evening)|hari ini|(?:pagi|siang|sore|malam) ini)\b/i
const TOMORROW = /\b(tomorrow|besok)\b/i
const RELATIVE =
  /\b(next week|this week|next sprint|this sprint|end of (?:the )?(?:week|month)|eow|minggu depan|minggu ini|akhir (?:bulan|minggu)|sprint depan|asap|soon|before launch|sebelum launch)\b/i
const NO_DATE =
  /\b(no date|no due date|no deadline|not stated|not given|none given|not set|no timeline|unspecified|unscheduled|not specified|unstated|undated|tanpa tanggal|belum ada tanggal|(?:tidak|belum) ditentukan)\b|due:\s*[-–—]\s*$/i
/** "Week of 19 October" names a week, not a due date. */
const WEEK_OF = /\b(?:week of|the week (?:of|starting|beginning)|minggu (?:tanggal|mulai))\s+[^),;]+/gi

export interface DatesFound {
  /** YYYY-MM-DD, assuming the meeting's year when the minutes give none. */
  absolute: string[]
  weekdays: number[]
  today: boolean
  tomorrow: boolean
  relative: string[]
  noDate: boolean
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function monthOf(word: string): number {
  for (const [pattern, n] of MONTH_NUMBER) if (pattern.test(word)) return n
  return 0
}

const RANGE = new RegExp(`\\b(\\d{1,2})\\s*(?:-|–|—|to|until|sampai|hingga|s/d)\\s*(\\d{1,2})\\s+${MONTH_WORD}\\b`, "gi")

export function datesIn(rawText: string, meetingDate: string): DatesFound {
  const text = rawText.replace(WEEK_OF, " ")
  const year = Number(meetingDate.slice(0, 4))
  const absolute = new Set<string>()
  for (const m of text.matchAll(RANGE)) {
    const month = monthOf(m[0].replace(/^[\d\s\-–—]+(?:to|until|sampai|hingga|s\/d)?[\d\s]+/i, ""))
    if (month) {
      absolute.add(iso(year, month, Number(m[1])))
      absolute.add(iso(year, month, Number(m[2])))
    }
  }
  for (const m of text.matchAll(DAY_MONTH)) {
    const month = monthOf(m[0].replace(/^[\d\s]+(st|nd|rd|th)?\s*/i, ""))
    if (month) absolute.add(iso(year, month, Number(m[1])))
  }
  for (const m of text.matchAll(MONTH_DAY)) {
    const month = monthOf(m[0])
    if (month) absolute.add(iso(year, month, Number(m[1])))
  }
  for (const m of text.matchAll(ISO)) absolute.add(`${m[1]}-${m[2]}-${m[3]}`)
  for (const m of text.matchAll(SLASH)) {
    const day = Number(m[1])
    const month = Number(m[2])
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) absolute.add(iso(year, month, day))
  }
  const weekdays = WEEKDAYS.filter(([pattern]) => pattern.test(text)).map(([, n]) => n)
  return {
    absolute: [...absolute],
    weekdays,
    today: TODAY.test(text),
    tomorrow: TOMORROW.test(text),
    relative: [...text.matchAll(new RegExp(RELATIVE, "gi"))].map((m) => m[0]),
    noDate: NO_DATE.test(text),
  }
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function weekdayOf(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay()
}

/** Strip parts of an item that are not its due date: the work-tree node, and quoted words. */
function dueText(item: Item): string {
  if (item.cells) {
    const column = Object.keys(item.cells).find((name) => /due|by when|when|deadline|date|tenggat|kapan/.test(name))
    if (column !== undefined) return item.cells[column] ?? ""
  }
  return item.text.replace(/\[node:[^\]]*\]/g, "").replace(/[“"][^”"]*[”"]/g, "")
}

// --- matching -----------------------------------------------------------------------------

function lower(text: string): string {
  return text.toLowerCase()
}

/** Lower case, with hyphens as spaces: "bank-transfer" is "bank transfer". */
function plain(text: string): string {
  return lower(text).replace(/[-_]/g, " ")
}

/** True when a word or phrase starts a word in the text: "lock" is in "a lock", not in "clock". */
export function mentions(text: string, word: string): boolean {
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegex(plain(word))}`, "u").test(plain(text))
}

/**
 * The items that are about a task: they mention one of its words and none of its exclusions,
 * the item that mentions the most of its words first.
 */
export function itemsFor(items: Item[], words: string[], exclude: string[] = []): Item[] {
  const hits = (item: Item) => words.filter((w) => mentions(item.text, w)).length
  return items
    .filter((item) => hits(item) > 0 && !exclude.some((w) => mentions(item.text, w)))
    .map((item, order) => ({ item, order, hits: hits(item) }))
    .sort((a, b) => b.hits - a.hits || a.order - b.order)
    .map((x) => x.item)
}

const NOT_SETTLED =
  /^\W*(none|no decisions?|nothing)\b|\bno\b[^.]{0,30}\bdecision\b|\b(not decided|undecided|not yet decided|not (?:yet )?(?:settled|agreed)|pending|parked|deferred|postponed|on hold|open question|under consideration|before deciding|could not be (?:decided|settled)|requires? (?:sign-?off|approval)|defer(?:s|red|ring)?|postpone(?:s|d)?|hold(?:ing)? off|wait(?:ing)? for|until after|not to decide|tbd|to be decided|belum diputuskan|belum ada keputusan|ditunda|not (?:a )?decision|no commitment|not committed)\b/i
/** A decision that records an option as turned down, or a task as called off, is faithful. */
const REJECTED = /\b(do not|don't|not|no|without|instead of|rather than|rejected|declined|turned down|won't|will not|nggak|tidak|bukan|tanpa)\b/i
const CANCELLED =
  /\b(cancel(?:l)?ed|rescinded|withdrawn|called off|no longer needed|not needed|already (?:done|built|completed|exists|written)|nggak usah|tidak perlu|udah (?:dibikin|ada)|not an action|joke|kidding|bercanda)\b/i
const NEGATION = /\b(instead of|rather than|not to|no longer|reversed|reverted|initially|at first|earlier|first proposed|bukan|tidak jadi|batal)\b/i

// --- the check ----------------------------------------------------------------------------

interface Context {
  meeting: Meeting
  minutes: Minutes
  people: string[]
  me: string
}

type Base = Pick<TrapResult, "trap" | "kind">
type DueTrap = Extract<Trap, { kind: "due-exact" | "due-vague" | "due-none" }>
type OwnerTrap = Extract<Trap, { kind: "owned" | "unowned" | "speaker-label" | "outside-owner" | "unconfirmed" | "conditional" | "we-task" }>

/** Words that mark an owner as not yet agreed. */
const TENTATIVE =
  /\b(to confirm|unconfirmed|not confirmed|not yet confirmed|tentative(?:ly)?|proposed|suggested|tbc|to be confirmed|needs? (?:to )?confirm|pending (?:\w+ )?confirmation|if (?:he|she|they) (?:agrees?|can|accepts?)|will check|to check|checking (?:\w+ )?(?:workload|capacity|availability|whether)|belum (?:konfirmasi|dikonfirmasi|pasti)|cek dulu|lihat dulu|(?:check|confirm|find out|see)(?:s|ing)? (?:whether|if))\b/i
/** Words that keep a condition attached to a commitment. */
const CONDITION = /\b(if|once|after|when|subject to|pending|upon|conditional|depends on|kalau|jika|setelah|asal|tergantung)\b/i
/** Owners that name the group rather than a person. */
const GROUP = /\b(team|squad|all|everyone|everybody|we|us|kita|together|bersama|both|group)\b/i
/** Words that say a date was moved, so the old date may sit next to the new one. */
const CHANGED = /\b(moved|changed|instead of|rather than|originally|initially|rescheduled|postponed|not friday|from|dipindah|diganti|bukan|tadinya|awalnya)\b/i

function result(base: Base, outcome: Outcome, detail: string, item?: Item): TrapResult {
  return item ? { ...base, outcome, detail, item: item.text } : { ...base, outcome, detail }
}

function checkDue(trap: DueTrap, item: Item | undefined, ctx: Context, base: Base, several: string): TrapResult {
  if (!item) {
    return trap.kind === "due-exact"
      ? result(base, "missed", "no action item for this task")
      : result(base, "pass", "not an action item, so no due date")
  }
  const found = datesIn(dueText(item), ctx.meeting.date)
  // A date the meeting itself names ("Bima's leave, 2-6 November") is taken from it, not made up.
  const spoken = new Set(datesIn(transcript(ctx.meeting), ctx.meeting.date).absolute)
  const dates = trap.kind === "due-exact" ? found : { ...found, absolute: found.absolute.filter((d) => !spoken.has(d)) }
  if (trap.kind === "due-exact") {
    const right =
      dates.absolute.includes(trap.date) ||
      dates.weekdays.includes(weekdayOf(trap.date)) ||
      (dates.today && trap.date === ctx.meeting.date) ||
      (dates.tomorrow && trap.date === addDays(ctx.meeting.date, 1))
    const wrong = dates.absolute.filter((d) => d !== trap.date)
    if (wrong.length > 0 && right && CHANGED.test(item.text)) return result(base, "pass", `due ${trap.date}; the earlier date is named as moved${several}`, item)
    if (wrong.length > 0) return result(base, "invented", `due ${wrong.join(", ")}, not ${trap.date}${several}`, item)
    if (right) return result(base, "pass", `due ${trap.date}${several}`, item)
    if (dates.weekdays.length > 0) return result(base, "invented", `due on another weekday than ${trap.date}${several}`, item)
    return result(base, "missed", `no due date given; the meeting said ${trap.date}${several}`, item)
  }
  if (trap.kind === "due-vague") {
    return dates.absolute.length > 0
      ? result(base, "invented", `"${trap.said}" became ${dates.absolute.join(", ")}${several}`, item)
      : result(base, "pass", `no date was made up for "${trap.said}"${several}`, item)
  }
  const given = dates.absolute.length > 0 || dates.weekdays.length > 0 || dates.today || dates.tomorrow || dates.relative.length > 0
  return given && !dates.noDate
    ? result(base, "invented", `a due date was given; the meeting gave none${several}`, item)
    : result(base, "pass", `no due date${several}`, item)
}

function checkOwner(trap: OwnerTrap, item: Item, ctx: Context, base: Base, several: string): TrapResult {
  const owner = ownerOf(item, ctx.people, ctx.me)
  const said = describe(owner)
  if (owner.kind === "ambiguous") return result(base, "review", `owner not clear from the item: ${said}${several}`, item)

  switch (trap.kind) {
    case "owned": {
      if (owner.kind === "person" && owner.name === trap.owner) return result(base, "pass", `owner ${said}${several}`, item)
      if (owner.kind === "unclear" || owner.kind === "none") return result(base, "missed", `${said}; the meeting named ${trap.owner}${several}`, item)
      if (owner.kind === "other") return result(base, "review", `owner ${said}; the meeting named ${trap.owner}${several}`, item)
      return result(base, "invented", `owner ${said}; the meeting named ${trap.owner}${several}`, item)
    }
    case "unowned": {
      if (owner.kind === "unclear") return result(base, "pass", `owner unclear${several}`, item)
      if (owner.kind === "person") {
        const byDefault = owner.name === ctx.me ? ", by default: the command forbids that" : ""
        return result(base, "invented", `owner ${said}${byDefault}; nobody took it${several}`, item)
      }
      if (owner.kind === "label") return result(base, "invented", `owner ${said}; nobody took it${several}`, item)
      if (owner.kind === "none") return result(base, "review", `no owner given and not flagged as unclear${several}`, item)
      return result(base, "review", `owner ${said}${several}`, item)
    }
    case "speaker-label": {
      // "Speaker 3 (probably Tomi)" keeps the label and still guesses who spoke.
      const guessed = namesIn(item.text, ctx.meeting.attendees)
      if (guessed.length > 0) return result(base, "invented", `names ${guessed.join(", ")} for a speaker the transcript does not name${several}`, item)
      if (owner.kind === "label" && owner.label === trap.owner) return result(base, "pass", `owner ${said}${several}`, item)
      const kept = [...ownerText(item.text).matchAll(new RegExp(LABEL, "gi"))].some((m) => `Speaker ${m[1]}` === trap.owner)
      if (owner.kind === "unclear" && kept) return result(base, "pass", `owner unclear, with the label ${trap.owner} kept${several}`, item)
      if (owner.kind === "person" || owner.kind === "label") return result(base, "invented", `owner ${said}; the transcript says ${trap.owner}${several}`, item)
      return result(base, "missed", `${said}; the transcript says ${trap.owner}${several}`, item)
    }
    case "unconfirmed": {
      if (owner.kind === "unclear") return result(base, "pass", `owner unclear${several}`, item)
      if (owner.kind === "person" && owner.name === trap.proposed) {
        return TENTATIVE.test(item.text)
          ? result(base, "pass", `${said}, marked as not yet agreed${several}`, item)
          : result(base, "invented", `owner ${said}, who never agreed to it${several}`, item)
      }
      if (owner.kind === "person" || owner.kind === "label") return result(base, "invented", `owner ${said}; only ${trap.proposed} was proposed, and did not agree${several}`, item)
      return result(base, "review", `owner ${said}${several}`, item)
    }
    case "conditional": {
      if (owner.kind === "person" && owner.name === trap.owner) {
        const kept = CONDITION.test(item.text) || trap.condition.some((w) => mentions(item.text, w))
        return kept
          ? result(base, "pass", `owner ${said}, with the condition kept${several}`, item)
          : result(base, "invented", `owner ${said}, with the condition dropped${several}`, item)
      }
      if (owner.kind === "unclear" || owner.kind === "none") return result(base, "missed", `${said}; the meeting named ${trap.owner}, on a condition${several}`, item)
      if (owner.kind === "other") return result(base, "review", `owner ${said}${several}`, item)
      return result(base, "invented", `owner ${said}; the meeting named ${trap.owner}${several}`, item)
    }
    case "we-task": {
      if (owner.kind === "unclear" || owner.kind === "none") return result(base, "pass", `${said}${several}`, item)
      if (owner.kind === "other" && GROUP.test(owner.text)) return result(base, "pass", `owner ${said}${several}`, item)
      if (owner.kind === "person") {
        const byDefault = owner.name === ctx.me ? ", by default" : ""
        return result(base, "invented", `a "we" task given to ${said}${byDefault}${several}`, item)
      }
      if (owner.kind === "label") return result(base, "invented", `a "we" task given to ${said}${several}`, item)
      return result(base, "review", `owner ${said}${several}`, item)
    }
    case "outside-owner": {
      const allowed = (text: string) => trap.allowed.some((a) => lower(text).includes(lower(a)))
      if (owner.kind === "unclear" || owner.kind === "none") return result(base, "pass", `${said}${several}`, item)
      if (owner.kind === "person" && allowed(owner.name)) return result(base, "pass", `owner ${said}${several}`, item)
      if (owner.kind === "other" && allowed(owner.text)) return result(base, "pass", `owner ${said}${several}`, item)
      if (owner.kind === "other") return result(base, "review", `owner ${said}${several}`, item)
      return result(base, "invented", `owner ${said}; no one in the meeting took it${several}`, item)
    }
  }
}

function checkTaskTrap(trap: Extract<Trap, { task: string[] }>, ctx: Context): TrapResult {
  const base: Base = { trap: trap.id, kind: trap.kind }
  const found = itemsFor(ctx.minutes.actions, trap.task, trap.exclude)
  const several = found.length > 1 ? ` (${found.length} items matched; read the best match)` : ""
  const action = found[0]
  // A task raised as an open question: flagged as faithfully as "owner unclear" would flag it.
  const asked = itemsFor(ctx.minutes.questions, trap.task, trap.exclude)[0]

  if (trap.kind === "not-a-task") {
    if (action && CANCELLED.test(action.text)) return result(base, "pass", "mentioned only as called off", action)
    return action ? result(base, "invented", "listed as an action item", action) : result(base, "pass", "not listed as an action item")
  }
  if (trap.kind === "due-exact" || trap.kind === "due-vague" || trap.kind === "due-none") {
    return checkDue(trap, action ?? (trap.kind === "due-exact" ? undefined : asked), ctx, base, several)
  }
  if (!action) {
    if ((trap.kind === "unowned" || trap.kind === "outside-owner" || trap.kind === "unconfirmed" || trap.kind === "we-task") && asked) {
      return result(base, "pass", "raised as an open question, not given an owner", asked)
    }
    if (trap.kind === "conditional" && asked) return checkOwner(trap, asked, ctx, base, "")
    if (trap.kind === "outside-owner" || trap.kind === "unconfirmed") return result(base, "pass", "not an action item; no one was made its owner")
    return result(base, "missed", "no action item for this task")
  }
  return checkOwner(trap, action, ctx, base, several)
}

function checkDecisionTrap(trap: Extract<Trap, { topic: string[] }>, ctx: Context): TrapResult {
  const base = { trap: trap.id, kind: trap.kind }
  const about = ctx.minutes.decisions.filter((item) => trap.topic.some((w) => mentions(item.text, w)))
  if (trap.kind === "not-decided") {
    const settled = about.find((item) => !NOT_SETTLED.test(item.text) && !REJECTED.test(item.text))
    return settled
      ? { ...base, outcome: "invented", detail: "listed as a decision", item: settled.text }
      : { ...base, outcome: "pass", detail: about.length ? "only mentioned as not decided" : "not under Decisions" }
  }
  if (trap.kind === "decided") {
    const also = trap.also
    const hit = about.find((item) => !also || also.some((w) => mentions(item.text, w)))
    return hit
      ? { ...base, outcome: "pass", detail: "under Decisions", item: hit.text }
      : { ...base, outcome: "missed", detail: "not under Decisions" }
  }
  const final = about.find((item) => trap.final.some((w) => mentions(item.text, w)))
  const dropped = about.find((item) => trap.dropped.some((w) => mentions(item.text, w)))
  if (final && dropped === final && !NEGATION.test(final.text)) {
    return { ...base, outcome: "review", detail: "the decision names both the final and the dropped choice", item: final.text }
  }
  if (final) return { ...base, outcome: "pass", detail: "the final choice is under Decisions", item: final.text }
  if (dropped) return { ...base, outcome: "invented", detail: "the reversed choice is under Decisions", item: dropped.text }
  return { ...base, outcome: "missed", detail: "not under Decisions" }
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
}

/** Quotes of three words or more that do not appear in the transcript. */
export function quotesNotInTranscript(minutesText: string, source: string): string[] {
  const haystack = normalize(source)
  const missing: string[] = []
  for (const m of minutesText.matchAll(/[“"]([^“”"\n]{4,}?)[”"]/g)) {
    const quote = m[1] ?? ""
    if (quote.trim().split(/\s+/).length < 3) continue
    const parts = normalize(quote)
      .split(/\s*(?:\.\.\.|…)\s*/)
      .map((p) => p.replace(/^[\s"'.,;:!?-]+|[\s"'.,;:!?-]+$/g, ""))
      .filter((p) => p.length > 0)
    if (!parts.every((p) => haystack.includes(p))) missing.push(quote.trim())
  }
  return missing
}

export function checkMinutes(meeting: Meeting, dataset: Dataset, minutesText: string): MeetingCheck {
  const minutes = parseMinutes(minutesText)
  const ctx: Context = { meeting, minutes, people: dataset.people, me: dataset.owner }

  const traps = meeting.traps.map((trap) => ("task" in trap ? checkTaskTrap(trap, ctx) : checkDecisionTrap(trap, ctx)))

  const findings: Finding[] = quotesNotInTranscript(minutesText, transcript(meeting)).map((quote) => ({
    kind: "quote-not-in-transcript",
    detail: quote,
  }))
  const outsideAllowed = meeting.traps.flatMap((t) => (t.kind === "outside-owner" ? t.allowed : []))
  for (const item of minutes.actions) {
    const owner = ownerOf(item, dataset.people, dataset.owner)
    if (owner.kind === "person" && !meeting.attendees.includes(owner.name) && !outsideAllowed.includes(owner.name)) {
      findings.push({ kind: "owner-not-in-meeting", detail: `${owner.name}: ${item.text}` })
    }
  }
  return { meeting: meeting.id, traps, findings }
}
