# Benchmarks

## Method

Each scenario runs twice against the same Northstar portal variant:

- **Baseline.** Fixed accessible names from the original form (`Invoice ID`, `Submit invoice`, and the other original labels). It declares success only when the page contains “invoice submitted successfully”. It does not read the verification API before declaring that.
- **FlowProof.** The approved invoice workflow, including recovery and the authoritative read.

After both, the harness reads the portal verification API. `incorrectSuccess` is true only when the approach declared `VERIFIED` and the authoritative result was not `VERIFIED`.

The focused suite is scenarios A, B, and E. The full suite is A through H. Sample size is the number of rows stored for that suite. The UI does not fill missing suites with sample percentages.

## Measured outside the suite

These three runs were executed directly, not as a benchmark suite, so they are not shown as a benchmark score:

| Scenario | Run | Declared by FlowProof | Authoritative record |
| --- | --- | --- | --- |
| A normal | `run_425a22085217b086a7efe67b` | VERIFIED | stored |
| E false success | `run_acca589a61eba17ff0ed3955` | FAILED | not stored |
| B changed button | `run_b84eca55d199532e11ede86c` | VERIFIED after one deterministic repair | stored |

No benchmark suite has been completed in this workspace. Cost per verified run is not reported for a suite that has not run. Otari spend for these three runs is zero because no model was called.
