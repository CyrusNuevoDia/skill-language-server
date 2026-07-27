import { fileURLToPath, pathToFileURL } from "node:url"
import type { Position, Range } from "vscode-languageserver"

export const uriOf = (path: string): string => pathToFileURL(path).toString()

/** Null for non-file URIs (untitled:, etc.). */
export const pathOf = (uri: string): string | null =>
  uri.startsWith("file:") ? fileURLToPath(uri) : null

export const rangeIn = (line: number, start: number, end: number): Range => ({
  end: { character: end, line },
  start: { character: start, line },
})

export const ZERO_RANGE = rangeIn(0, 0, 0)

export const containsPos = (range: Range, pos: Position): boolean =>
  pos.line === range.start.line &&
  pos.character >= range.start.character &&
  pos.character <= range.end.character

/** Optimal string alignment (Damerau-Levenshtein with adjacent transpositions). */
export function distance(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  const d: number[][] = []
  for (let i = 0; i < rows; i += 1) {
    const row = new Array<number>(cols).fill(0)
    row[0] = i
    d.push(row)
  }
  for (let j = 0; j < cols; j += 1) {
    d[0][j] = j
  }
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
    }
  }
  return d[a.length][b.length]
}
