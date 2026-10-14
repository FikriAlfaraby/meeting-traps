import { readFileSync } from "node:fs"

/** One transcript line: who spoke, and what they said. */
export type Line = [speaker: string, text: string]

interface TaskTrap {
  id: string
  why: string
  /** Words that find the action item for this task: any one of them, case-insensitive. */
  task: string[]
  /** Words that mean a matching line is about a different task. */
  exclude?: string[]
}

/** A task with a clear owner: the minutes must name that owner. A control, not a trap. */
export interface OwnedTrap extends TaskTrap {
  kind: "owned"
  owner: string
}

/** A task nobody took: the minutes must say the owner is unclear. */
export interface UnownedTrap extends TaskTrap {
  kind: "unowned"
}

/** A task taken by an unnamed speaker ("Speaker 3"): the minutes must keep the label. */
export interface SpeakerLabelTrap extends TaskTrap {
  kind: "speaker-label"
  owner: string
}

/** A task that belongs to someone outside the meeting: no one in the room may be made its owner. */
export interface OutsideOwnerTrap extends TaskTrap {
  kind: "outside-owner"
  allowed: string[]
}

/** Someone proposed an owner who never agreed: the minutes must not present it as their commitment. */
export interface UnconfirmedTrap extends TaskTrap {
  kind: "unconfirmed"
  proposed: string
}

/** A commitment that holds only if something happens first: the minutes must keep the condition. */
export interface ConditionalTrap extends TaskTrap {
  kind: "conditional"
  owner: string
  /** Words that name the condition, besides "if", "once", "after" and their Indonesian kin. */
  condition: string[]
}

/** "We should...": a task for the group, which the minutes must not hand to one person. */
export interface WeTaskTrap extends TaskTrap {
  kind: "we-task"
}

/** A joke, a wish or a conditional offer: it must not become an action item. */
export interface NotATaskTrap extends TaskTrap {
  kind: "not-a-task"
}

/** The task's due date is a named day: the minutes must give that day or none. A control. */
export interface DueExactTrap extends TaskTrap {
  kind: "due-exact"
  date: string
}

/** The task's due date is vague ("next week"): the minutes must not turn it into a date. */
export interface DueVagueTrap extends TaskTrap {
  kind: "due-vague"
  said: string
}

/** The task has no due date: the minutes must not give one. */
export interface DueNoneTrap extends TaskTrap {
  kind: "due-none"
}

/** Settled in the meeting: it must be under Decisions. A control. */
export interface DecidedTrap {
  id: string
  why: string
  kind: "decided"
  topic: string[]
  /** If given, the decision must also contain one of these words. */
  also?: string[]
}

/** Discussed and left open: it must not be under Decisions. */
export interface NotDecidedTrap {
  id: string
  why: string
  kind: "not-decided"
  topic: string[]
}

/** Decided one way, then reversed: Decisions must hold the final choice. */
export interface ReversedTrap {
  id: string
  why: string
  kind: "reversed"
  topic: string[]
  final: string[]
  dropped: string[]
}

export type Trap =
  | OwnedTrap
  | UnownedTrap
  | SpeakerLabelTrap
  | OutsideOwnerTrap
  | UnconfirmedTrap
  | ConditionalTrap
  | WeTaskTrap
  | NotATaskTrap
  | DueExactTrap
  | DueVagueTrap
  | DueNoneTrap
  | DecidedTrap
  | NotDecidedTrap
  | ReversedTrap

export type TaskTrapKind = Extract<Trap, { task: string[] }>["kind"]

export interface Meeting {
  id: string
  title: string
  /** YYYY-MM-DD, in Jakarta. */
  date: string
  weekday: string
  time: string
  language: "en" | "id" | "id-en"
  attendees: string[]
  /** The recording did not say who is speaking: lines carry "Speaker 2" or "Pembicara 2". */
  speakersUnresolved: boolean
  lines: Line[]
  traps: Trap[]
  note?: string
}

export interface Dataset {
  about: string
  /** Whose minutes these are: the "me" of the command. */
  owner: string
  /** Everyone the meetings mention, so the checker can tell a name from a word. */
  people: string[]
  meetings: Meeting[]
}

export function loadDataset(path: URL | string = new URL("../data/meetings.json", import.meta.url)): Dataset {
  return JSON.parse(readFileSync(path, "utf8")) as Dataset
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

/** "2026-10-13" -> "13 October 2026" */
export function longDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number)
  return `${day} ${MONTHS[(month ?? 1) - 1]} ${year}`
}

/** The transcript as a recorder would hand it over: a header, then one line per turn. */
export function transcript(meeting: Meeting): string {
  const attendees = meeting.attendees.join(", ")
  const unresolved = meeting.speakersUnresolved ? " (the recording did not identify who is speaking)" : ""
  return [
    `Meeting: ${meeting.title}`,
    `Date: ${meeting.weekday} ${longDate(meeting.date)}, ${meeting.time} WIB`,
    `Attendees: ${attendees}${unresolved}`,
    "",
    ...meeting.lines.map(([speaker, text]) => `${speaker}: ${text}`),
  ].join("\n")
}
