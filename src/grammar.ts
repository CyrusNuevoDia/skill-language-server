import { regex } from "arkregex"
import { type } from "arktype"

// Name = [a-z0-9_] segments joined by runs of "-" or ":" — separators can
// repeat (a::b, x--y) but never lead or trail, so "/ship:" in prose keeps
// its colon.
export const SKILL_NAME_PATTERN = "[a-z0-9_]+(?:[-:]+[a-z0-9_]+)*"

/** Full-string validation for canonical skill names. */
export const SkillName = type(regex(`^${SKILL_NAME_PATTERN}$`))
export type SkillName = typeof SkillName.infer

/** A preceding character that makes a sigil part of a path, URI, shell expression, home path, or closing tag. */
export const REFERENCE_BAD_PREV = regex("[A-Za-z0-9_$/:.<~-]")

/** Fresh per scan because the global flag makes RegExp.exec stateful. */
export const createSkillTokenPattern = () =>
  regex(`([/$])(${SKILL_NAME_PATTERN})`, "g")
