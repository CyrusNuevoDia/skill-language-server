---
"skill-language-server": minor
---

Parser correctness fixes and unrestricted name length, locked in by a new fast-check property suite:

- CRLF documents now close code fences correctly. Previously a fence opener in a `\r\n` file never matched its closer, silencing tokens, diagnostics, and completion for the rest of the document.
- The frontmatter `name:` range now anchors strictly after the key, so a skill named `name` (or any short value occurring inside the literal text `name:`) renames its value, never the key.
- Skill names are no longer capped at 64 characters — anything the token grammar accepts is a valid rename target.
