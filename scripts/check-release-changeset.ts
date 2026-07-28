import { regex } from "arkregex"
import { type } from "arktype"
import { $ } from "bun"
import { uniq } from "es-toolkit"

const PACKAGE_NAME = "skill-language-server"
const GENERATED_VERSION_COMMIT_PREFIX = `chore(release): bump ${PACKAGE_NAME} version`
const RELATIVE_PATH_PREFIX_PATTERN = /^\.\//
const CHANGESET_PATH_PATTERN = regex("^\\.changeset/[^/]+\\.md$")
const CHANGESET_RELEASE_LINE_PATTERN = regex(
  '^"([^"]+)":\\s*([A-Za-z0-9_-]+)\\s*$'
)

const RELEASE_INPUT_FILES = new Set([
  "package.json",
  "bun.lock",
  "README.md",
  "CHANGELOG.md",
  "justfile",
  "scripts/check-release-changeset.ts",
])
const RELEASE_INPUT_PREFIXES = [
  "src/",
  "ext/",
  ".changeset/",
  ".github/workflows/",
]

const ReleaseType = type("'patch' | 'minor' | 'major'")
const ChangeStatus = type("'A' | 'C' | 'M' | 'R' | 'D'")
type ChangeStatus = typeof ChangeStatus.infer

type ChangedFile = {
  status: ChangeStatus
  paths: [string, ...string[]]
}

type ReleaseEntry = {
  packageName: string
  releaseType: typeof ReleaseType.infer
}

type ParsedChangeset = {
  empty: boolean
  filePath: string
  releases: ReleaseEntry[]
}

// Must stay a function declaration: tsc's never-return control-flow analysis
// doesn't terminate branches after calls to const-arrow never functions.
function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

const git = async (...args: string[]) => (await $`git ${args}`.text()).trimEnd()

const normalizePath = (filePath: string) =>
  filePath.replaceAll("\\", "/").replace(RELATIVE_PATH_PREFIX_PATTERN, "")

const isChangesetPath = (filePath: string): boolean =>
  CHANGESET_PATH_PATTERN.test(filePath)

const isReleaseInputPath = (filePath: string) =>
  RELEASE_INPUT_FILES.has(filePath) ||
  RELEASE_INPUT_PREFIXES.some((prefix) => filePath.startsWith(prefix))

const currentPath = ({ status, paths }: ChangedFile) =>
  status === "D" ? paths[0] : (paths.at(-1) ?? paths[0])

function parseNameStatusLine(line: string): ChangedFile {
  const [rawStatus, ...rawPaths] = line.split("\t")
  const status = rawStatus?.[0]

  if (!ChangeStatus.allows(status)) {
    fail(`Unable to parse git diff status line: ${line}`)
  }

  const [firstPath, ...restPaths] = rawPaths
    .map(normalizePath)
    .filter((filePath) => filePath.length > 0)

  if (firstPath === undefined) {
    fail(`Git diff status line did not include a path: ${line}`)
  }

  return { paths: [firstPath, ...restPaths], status }
}

const parseNameStatus = (diffOutput: string) =>
  diffOutput
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map(parseNameStatusLine)

const changedReleaseInputPaths = (changes: ChangedFile[]) =>
  uniq(
    changes
      .flatMap((change) => change.paths)
      .filter(
        (filePath) => isReleaseInputPath(filePath) && !isChangesetPath(filePath)
      )
  ).toSorted()

const changedChangesetFiles = (changes: ChangedFile[]) =>
  changes.filter((change) => change.paths.some(isChangesetPath))

const parseableChangesetPaths = (changesets: ChangedFile[]) =>
  uniq(
    changesets
      .filter((changeset) => changeset.status !== "D")
      .map(currentPath)
      .filter(isChangesetPath)
  ).toSorted()

const untrackedChangesetChanges = async () =>
  (await git("ls-files", "--others", "--exclude-standard", ".changeset/*.md"))
    .split("\n")
    .map(normalizePath)
    .filter(isChangesetPath)
    .map((filePath): ChangedFile => ({ paths: [filePath], status: "A" }))

const formatChangedFile = (change: ChangedFile) =>
  change.paths.length > 1
    ? `${change.status} ${change.paths[0]} -> ${currentPath(change)}`
    : `${change.status} ${change.paths[0]}`

const bulletList = (items: string[]) =>
  items.length === 0 ? "- none" : items.map((item) => `- ${item}`).join("\n")

function printDiagnostics(releasePaths: string[], changesets: ChangedFile[]) {
  console.log(`Changed release input files:\n${bulletList(releasePaths)}`)
  console.log(
    `Changed changeset files:\n${bulletList(changesets.map(formatChangedFile))}`
  )
}

function parseReleaseLine(line: string, filePath: string): ReleaseEntry {
  const releaseLine = CHANGESET_RELEASE_LINE_PATTERN.exec(line)

  if (releaseLine === null) {
    fail(`${filePath}: malformed frontmatter line: ${line}`)
  }

  const { 1: packageName, 2: releaseType } = releaseLine

  if (!ReleaseType.allows(releaseType)) {
    fail(
      `${filePath}: unsupported release type "${releaseType}" for "${packageName}".`
    )
  }

  return { packageName, releaseType }
}

function parseChangeset(content: string, filePath: string): ParsedChangeset {
  const lines = content.replaceAll("\r\n", "\n").split("\n")

  if (lines[0]?.trim() !== "---") {
    fail(`${filePath}: frontmatter must start with a --- fence.`)
  }

  const closingFence = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---"
  )

  if (closingFence === -1) {
    fail(`${filePath}: missing frontmatter fences.`)
  }

  const releaseLines = lines
    .slice(1, closingFence)
    .map((line) => line.trim())
    .filter((line) => line !== "")

  return {
    empty: releaseLines.length === 0,
    filePath,
    releases: releaseLines.map((line) => parseReleaseLine(line, filePath)),
  }
}

const readChangedChangesets = (filePaths: string[]) =>
  Promise.all(
    filePaths.map(async (filePath) =>
      parseChangeset(await Bun.file(filePath).text(), filePath)
    )
  )

async function main() {
  const latestCommitSubject = await git("log", "-1", "--pretty=%s")

  if (latestCommitSubject.startsWith(GENERATED_VERSION_COMMIT_PREFIX)) {
    console.log(
      `Skipping release changeset enforcement for generated version commit: ${latestCommitSubject}`
    )
    return
  }

  const baseBranch = process.env.GITHUB_BASE_REF?.trim() || "main"
  const mergeBase =
    (await git("merge-base", "HEAD", `origin/${baseBranch}`).catch(
      () => undefined
    )) ??
    (await git("merge-base", "HEAD", baseBranch).catch(() => undefined)) ??
    "HEAD"
  const diffOutput = await git(
    "diff",
    "--name-status",
    "--diff-filter=ACMRD",
    mergeBase,
    "HEAD"
  )
  const changes = [
    ...parseNameStatus(diffOutput),
    ...(await untrackedChangesetChanges()),
  ]
  const releasePaths = changedReleaseInputPaths(changes)
  const changesets = changedChangesetFiles(changes)

  printDiagnostics(releasePaths, changesets)

  const parsedChangesets = await readChangedChangesets(
    parseableChangesetPaths(changesets)
  )

  if (releasePaths.length === 0) {
    console.log("No published package inputs changed; no changeset required.")
    return
  }

  if (changesets.length === 0) {
    fail(
      "Published package inputs changed, but no changed .changeset/*.md file was found."
    )
  }

  if (parsedChangesets.length === 0) {
    fail(
      "Published package inputs changed, but no non-deleted changed changeset file remains to parse."
    )
  }

  const hasPackageRelease = parsedChangesets.some((changeset) =>
    changeset.releases.some((release) => release.packageName === PACKAGE_NAME)
  )
  const hasEmptyChangeset = parsedChangesets.some(
    (changeset) => changeset.empty
  )
  const unsupportedReleases = parsedChangesets.flatMap((changeset) =>
    changeset.releases
      .filter((release) => release.packageName !== PACKAGE_NAME)
      .map((release) => `${changeset.filePath}: "${release.packageName}"`)
  )

  if (unsupportedReleases.length > 0) {
    fail(
      [
        `Changesets in this repo may only release "${PACKAGE_NAME}" or be empty.`,
        ...unsupportedReleases.map((release) => `- ${release}`),
      ].join("\n")
    )
  }

  if (hasPackageRelease || hasEmptyChangeset) {
    console.log("Release changeset check passed.")
    return
  }

  fail(
    `Published package inputs changed, but no changed changeset targets "${PACKAGE_NAME}" and no changed changeset is empty.`
  )
}

await main()
