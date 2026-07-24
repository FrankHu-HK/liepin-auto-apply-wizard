# Liepin Fully-Automated Delivery Wizard · Error Codes and Exception Handling

> This skill uses a three-layer mechanism of "E-series error code + process exit code + friendly phrasing". The scripts really implement all judgments; the agent (WorkBuddy) must proactively tell the user the reason in text by exit code.

## 1. Process Exit Codes (agent must read)

| Exit code | Meaning | Agent should proactively tell the user |
|---|---|---|
| 0 | Done / daily cap reached / runtime-guardrail stop | On done go to result display; on cap say "applied N today, reached cap, rest left for tomorrow"; on timeout say "safely stopped, rerun resumes" |
| 2 | Pre-check 401 (token has no apply-job permission) | "Token has no delivery permission, go back to Stage 0 to regenerate credentials then rerun" |
| 3 | Persistent rate-limit >30min / consecutive-failure circuit break / other interruption beyond runtime | "Delivery too frequent and rate-limited (or token likely invalid), auto-paused; de-dup guarantees safe resume later" |
| 130 | User interruption (Ctrl+C / SIGTERM) | "Delivery interrupted by you, X applied, progress saved, rerun resumes" |
| 1 | Fatal error | Report the key parts of the error stack as-is |

## 2. E-series Error Codes

Each error code includes: **trigger / script behavior / friendly phrasing**. The script strictly follows this in the corresponding branch.

### E001 Missing LIEPIN_TOKEN
- **Trigger**: env `LIEPIN_TOKEN` is empty.
- **Script behavior**: print hint and `process.exit(3)`.
- **Friendly phrasing**: "Missing Liepin Token (x-user-token). Go back to Stage 0 to obtain it, then pass it inline in this command: `$env:LIEPIN_TOKEN='your token'`".

### E002 Missing config file
- **Trigger**: no `liepin_wizard_config.json` in the workspace.
- **Script behavior**: `process.exit(3)`.
- **Friendly phrasing**: "Please fill and submit the config via the web wizard page first, then run the delivery pipeline."

### E003 Invalid config field
- **Trigger**: salary ceiling < floor (and ceiling not 0), daily cap < 1, recruitmentType invalid.
- **Script behavior**: wizard side `wizard.js` returns 400 with hint; pipeline side falls back to safe default (recruitmentType defaults to nonRecruiter).
- **Friendly phrasing**: "Config problem: salary ceiling cannot be below floor; handled with safe default / please fix in wizard and regenerate."

### E004 Network / request timeout
- **Trigger**: a single MCP request exceeds 30s or connection error.
- **Script behavior**: count into backoff retry; continuous anomaly goes to rate-limit guard flow.
- **Friendly phrasing**: "Network jitter, retrying; if no response for a long time the network may be down, please check then rerun."

### E005 Persistent rate-limit >30 minutes
- **Trigger**: 429 backoff cumulative wait >1800s still limited.
- **Script behavior**: write report, `process.exit(3)`.
- **Friendly phrasing**: "Delivery too frequent and rate-limited for over 30 minutes, auto-paused. De-dup guarantees safe resume later; suggest waiting 1~2 hours before rerun."

### E006 Pre-check 401 (token no apply permission)
- **Trigger**: first-item pre-check apply returns 401 / unauthorized.
- **Script behavior**: write report, `process.exit(2)`, no bulk apply.
- **Friendly phrasing**: "Token has no 'delivery' permission (search may still work). Go back to Stage 0 to regenerate credentials and confirm apply permission is checked, then rerun."

### E007 Consecutive-failure circuit break (token invalid)
- **Trigger**: 3 consecutive non-rate-limit hard failures (e.g. repeated 401 / API anomaly).
- **Script behavior**: write report, `process.exit(3)`.
- **Friendly phrasing**: "3 consecutive delivery failures, likely token invalid or API anomaly, circuit-broken and stopped. Please regenerate token then rerun; applied part will not repeat."

### E008 Daily cap reached
- **Trigger**: `liepin_daily_quota.json` today's count ≥ dailyCap.
- **Script behavior**: write report, `process.exit(0)`, mark quotaReached.
- **Friendly phrasing**: "Applied N today, reached cap; remaining roles left for tomorrow auto-resume. Account protection active."

### E009 Global runtime exceeded
- **Trigger**: run exceeds 45 minutes (MAX_RUNTIME_MS).
- **Script behavior**: safe stop, persist, `process.exit(0)`.
- **Friendly phrasing**: "Reached max runtime 45 minutes, safely stopped and progress saved; rerun resumes remaining roles."

### E010 User interruption
- **Trigger**: received SIGINT / SIGTERM.
- **Script behavior**: write partial report, `process.exit(130)`.
- **Friendly phrasing**: "Delivery interrupted by you, X applied, progress saved, rerun resumes, never repeats."

### E011 Search returned nothing
- **Trigger**: a keyword returns empty across all pages.
- **Script behavior**: skip that keyword, continue to next; if all empty report 0 to apply.
- **Friendly phrasing**: "No matching roles under current criteria, try relaxing salary / industry / location."

### E012 Config write failed (wizard side)
- **Trigger**: `wizard.js` writing `liepin_wizard_config.json` throws.
- **Script behavior**: HTTP 500 returns the error reason.
- **Friendly phrasing**: "Requirement config write failed (disk / permission issue), please check workspace writability then retry wizard."

### E013 Unknown result needs manual check
- **Trigger**: apply returned undeterminable success/failure (empty return, non-standard text).
- **Script behavior**: mark as `unknown`, write to report.
- **Friendly phrasing**: "W roles returned unclear results, marked unknown, please verify manually in the Liepin App; never fake success."

## 3. Exception Handling Design Principles
- **Never fake success**: fail / unknown are never treated as success.
- **Progress not lost**: any interruption (rate-limit / circuit break / user / timeout) writes report before exit.
- **Resumable**: de-dup set persisted across runs, rerun only applies un-applied.
- **Proactively told**: any non-0 exit or cap reached, the agent must explain the reason in text immediately + progress saved.
