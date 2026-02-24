---
"@side-quest/last-30-days": patch
---

Harden reliability workflows and eval scripts for production rollout:

- add stronger artifact validation in live reliability workflows
- remove machine-specific path assumptions in baseline/eval tooling
- improve legacy path handling and error reporting
- fix CSV escaping in reliability matrix outputs
- keep workflow summaries and lock-gate reporting consistent
