---
"@side-quest/word-on-the-street": minor
---

Surface rate-limit diagnostics in Report schema and compact output

When a 429 rate limit is encountered, the Report now includes structured per-source diagnostic fields: `*_rate_limit_type` (transient vs quota), `*_rate_limit_error_code`, `*_rate_limit_reset_ms`, `*_rate_limit_retry_after_ms`, `*_rate_limit_retries_attempted`, `*_used_stale_cache`, and `*_cache_age_hours`. Compact output renders a structured diagnostics block instead of a flat error string. Happy-path output is unchanged - fields are omitted when no rate limit occurred.
