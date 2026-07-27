---
"skill-language-server": patch
---

Relax Node engines requirement to >=22 so the Zed extension can run the npm-installed server on Zed's bundled Node runtime. The Zed shim now auto-installs `skill-language-server` from npm (and keeps it updated) when no binary is found on PATH.
