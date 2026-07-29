export type SkillClient = "ambiguous" | "claude" | "codex"
export type SkillSchemaScope = "claude" | "universal"
export type YAMLType = "boolean" | "mapping" | "sequence" | "string"

export type SkillSchemaVariant = {
  finiteValues?: readonly string[]
  scope: SkillSchemaScope
  source: string
  yamlTypes: readonly YAMLType[]
}

export type SkillSchemaEntry = {
  description: string
  name: string
  variants: readonly SkillSchemaVariant[]
}

const AGENT_SKILLS_SPEC = "https://agentskills.io/specification"
const CLAUDE_SKILLS_DOCS = "https://code.claude.com/docs/en/skills"
const PATH_SEPARATOR = /[\\/]/

const universal = (
  yamlTypes: readonly YAMLType[]
): readonly SkillSchemaVariant[] => [
  {
    scope: "universal",
    source: AGENT_SKILLS_SPEC,
    yamlTypes,
  },
]

const claude = (
  yamlTypes: readonly YAMLType[],
  finiteValues?: readonly string[]
): readonly SkillSchemaVariant[] => [
  {
    finiteValues,
    scope: "claude",
    source: CLAUDE_SKILLS_DOCS,
    yamlTypes,
  },
]

export const SKILL_SCHEMA: readonly SkillSchemaEntry[] = [
  {
    description: "Display name for the skill.",
    name: "name",
    variants: universal(["string"]),
  },
  {
    description: "What the skill does and when to use it.",
    name: "description",
    variants: universal(["string"]),
  },
  {
    description: "License name or a reference to a bundled license file.",
    name: "license",
    variants: universal(["string"]),
  },
  {
    description: "Environment and product compatibility requirements.",
    name: "compatibility",
    variants: universal(["string"]),
  },
  {
    description: "Additional string key-value metadata.",
    name: "metadata",
    variants: universal(["mapping"]),
  },
  {
    description: "Tools the skill may use without asking permission.",
    name: "allowed-tools",
    variants: [
      ...universal(["string"]),
      {
        scope: "claude",
        source: CLAUDE_SKILLS_DOCS,
        yamlTypes: ["string", "sequence"],
      },
    ],
  },
  {
    description: "Additional context for when Claude should invoke the skill.",
    name: "when_to_use",
    variants: claude(["string"]),
  },
  {
    description: "Argument hint shown in skill completion.",
    name: "argument-hint",
    variants: claude(["string"]),
  },
  {
    description: "Named positional arguments for skill substitution.",
    name: "arguments",
    variants: claude(["string", "sequence"]),
  },
  {
    description: "Prevent Claude from invoking the skill automatically.",
    name: "disable-model-invocation",
    variants: claude(["boolean"], ["true", "false"]),
  },
  {
    description: "Control whether the skill appears in the user skill menu.",
    name: "user-invocable",
    variants: claude(["boolean"], ["true", "false"]),
  },
  {
    description: "Tools unavailable while the skill is active.",
    name: "disallowed-tools",
    variants: claude(["string", "sequence"]),
  },
  {
    description: "Model used while the skill is active.",
    name: "model",
    variants: claude(["string"]),
  },
  {
    description: "Reasoning effort used while the skill is active.",
    name: "effort",
    variants: claude(["string"], ["low", "medium", "high", "xhigh", "max"]),
  },
  {
    description: "Execution context for the skill.",
    name: "context",
    variants: claude(["string"], ["fork"]),
  },
  {
    description: "Subagent type used in a forked context.",
    name: "agent",
    variants: claude(["string"]),
  },
  {
    description: "Run a forked skill in the background.",
    name: "background",
    variants: claude(["boolean"], ["true", "false"]),
  },
  {
    description: "Hooks scoped to the skill lifecycle.",
    name: "hooks",
    variants: claude(["mapping"]),
  },
  {
    description: "Glob patterns limiting automatic skill activation.",
    name: "paths",
    variants: claude(["string", "sequence"]),
  },
  {
    description: "Shell used for dynamic commands in the skill.",
    name: "shell",
    variants: claude(["string"], ["bash", "powershell"]),
  },
]

export function clientForSkillPath(path: string): SkillClient {
  const segments = path.split(PATH_SEPARATOR)
  if (segments.includes(".claude")) {
    return "claude"
  }
  if (segments.includes(".agents") || segments.includes(".codex")) {
    return "codex"
  }
  return "ambiguous"
}

export const schemaVariantsForClient = (
  entry: SkillSchemaEntry,
  client: SkillClient
): readonly SkillSchemaVariant[] =>
  client === "claude" || client === "ambiguous"
    ? entry.variants
    : entry.variants.filter(({ scope }) => scope === "universal")

export const schemaEntriesForClient = (
  client: SkillClient
): readonly SkillSchemaEntry[] =>
  SKILL_SCHEMA.filter(
    (entry) => schemaVariantsForClient(entry, client).length > 0
  )
