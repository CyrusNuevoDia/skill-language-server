import { expect, test } from "bun:test"
import { resolve } from "node:path"

test("server boots over stdio and answers initialize", async () => {
  const proc = Bun.spawn(["bun", "src/main.ts", "--stdio"], {
    cwd: resolve(import.meta.dir, ".."),
    stderr: "ignore",
    stdin: "pipe",
    stdout: "pipe",
  })

  const msg = JSON.stringify({
    id: 1,
    jsonrpc: "2.0",
    method: "initialize",
    params: { capabilities: {}, processId: null, rootUri: null },
  })
  proc.stdin.write(`Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`)
  await proc.stdin.flush()

  let buf = ""
  const decoder = new TextDecoder()
  for await (const chunk of proc.stdout) {
    buf += decoder.decode(chunk)
    if (buf.includes('"capabilities"')) {
      break
    }
  }
  proc.kill()

  expect(buf).toContain('"jsonrpc"')
  expect(buf).toContain('"capabilities"')
}, 10_000)
