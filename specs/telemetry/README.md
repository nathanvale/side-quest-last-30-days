# Telemetry Contract Lock (v1)

This folder is the normative contract pack for `l30d.run.completed` telemetry.

## Normative Artifacts

- Envelope schema: `specs/telemetry/l30d.run.completed.envelope.v1.schema.json`
- Data payload schema: `specs/telemetry/run-completed-data.v1.schema.json`
- Data-quality schema: `specs/telemetry/data-quality.v1.schema.json`
- Confidence schema: `specs/telemetry/confidence.v1.schema.json`
- TypeScript contract types: `src/lib/telemetry-contract.ts`
- Runtime validator module: `scripts/telemetry/validator.ts`
- Canonical sample fixture: `fixtures/telemetry/run.completed.v1.sample.json`
- Fixture validation entrypoint: `scripts/telemetry/validate-fixture.ts`
- Contract tests: `tests/telemetry-contract.test.ts`

## Builder Workflow

1. Implement telemetry producers against `src/lib/telemetry-contract.ts`.
2. Validate shape and formulas locally:
   - `bun run telemetry:validate`
3. Run contract tests:
   - `bun test tests/telemetry-contract.test.ts`

## Validator Workflow

1. Re-run schema+formula fixture validation:
   - `bun run telemetry:validate`
2. Re-run contract tests:
   - `bun test tests/telemetry-contract.test.ts`
3. Confirm envelope compatibility in end-to-end telemetry smoke tests.

## Change Control

1. `*.v1.schema.json` files are immutable except typo/docs fixes.
2. Any breaking field or formula change requires new `v2` schema files.
3. `src/lib/telemetry-contract.ts` must remain backward-compatible for v1.
4. `fixtures/telemetry/run.completed.v1.sample.json` must stay valid and formula-consistent.

## Formula Locks

Data quality:
- `quality_score = round(0.30*in_range_ratio*100 + 0.25*fresh_72h_ratio*100 + 0.20*multi_source_trend_ratio*100 + 0.20*citation_resolvable_ratio*100 + 0.05*execution_health_score)`

Execution health:
- `execution_health_score = max(0, 100 - 10*rate_limited_source_count - 15*partial_source_failure_count - (stale_cache_used ? 10 : 0))`

Confidence:
- `confidence_score = round(0.30*freshness + 0.25*source_confirmation + 0.25*citation_validity + 0.10*data_completeness + 0.10*execution_health)`

Grade/label mapping:
- `quality_grade`: A>=85, B>=70, C>=55, D>=40, F<40
- `confidence_label`: high>=80, medium>=60, low<60
