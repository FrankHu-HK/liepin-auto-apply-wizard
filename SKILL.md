---
name: liepin-auto-apply-wizard
displayName: Liepin Fully-Automated Resume Delivery / Schedulable Unattended Runs / Zero-Touch / Rate-Limit-Safe (Crafted by a 23-year Fortune-500 HR VP, battle-tested by 100k+ users)
display_name: Liepin Fully-Automated Resume Delivery / Schedulable Unattended Runs / Zero-Touch / Rate-Limit-Safe (Crafted by a 23-year Fortune-500 HR VP, battle-tested by 100k+ users)
description: |
  A fully-automated Liepin resume-delivery skill (web-wizard style, supports scheduled / unattended runs). A one-time web wizard collects your job criteria (job title - combining role + level, industry, location, salary, recruitment type, daily cap, unattended or not); once triggered it **automatically pops up a preview panel with the wizard page** and, after you submit, **automatically starts foreground delivery with zero further action** - every application shows its result in real time, and you can always "check progress". It fully automates job search, smart filtering, cross-session de-duplication, rate-limit guarding, and resume delivery.
  Key highlights: ① Web wizard (the agent auto-pops the preview panel, not a dialog popup) ② Submit-and-auto-apply, zero touch (except on rate-limiting / interruption) ③ Job title = role + level combined ④ Recruitment-type filtering ⑤ Cross-session permanent de-duplication ⑥ Rate-limit guard + auto-recovery ⑦ Daily quota cap ⑧ Real four-state results + per-item real-time display ⑨ Proactive interruption reporting + stability guardrails ⑩ Schedulable unattended automation runs.
version: 3.0.1
requires:
  bins: [liepin-cli, node]
visibility: public
disable: false
---

# Liepin Fully-Automated Resume Delivery / Schedulable Unattended Runs / Zero-Touch / Rate-Limit-Safe (Crafted by a 23-year Fortune-500 HR VP, battle-tested by 100k+ users)

## One-line positioning

Turn "applying for jobs" into a closed loop of **web single-page wizard (enter criteria) → automated filtering & delivery → results display (with failure reasons)**, and **never fake success, never re-apply, never trip platform risk controls, and always explain clearly if interrupted**.

---

## ⏱️ 5-Minute Quick Start (read this and you can apply)

```
1️⃣ Tell me "help me apply on Liepin" → the AI auto-pops the web wizard
2️⃣ Fill in job title (e.g. HR Director) / industry / location / salary → click "Submit and start auto-apply"
3️⃣ Give me your Token (open https://www.liepin.com/mcp/auth and copy x-user-token)
4️⃣ Send the Token to me → the AI auto-configures it → auto-starts delivery
```

> In plain words: send me 3 things - **the instruction** (what role to apply for) + **Token** + **a one-line requirement**, and the AI handles the rest.
> - Token link: https://www.liepin.com/mcp/auth (open it and copy x-user-token)
> - Job title / industry / location / salary (or use defaults)
> - Then just wait for the results

**You never need to touch the command line, install Python, or configure an environment.** The AI auto-checks, auto-installs liepin-cli, and auto-delivers.

> 📚 The full reference docs are below. For first use, only the section above is enough; scroll down if you hit a problem.

---

## 📚 Glossary (fixed terminology, read before the body)

To avoid ambiguity, the following terms have fixed meanings throughout this document:

| Term | Meaning | Common confusion |
|---|---|---|
| **Four-state result** | The 4 terminal states judged per application: `success` (applied) / `already` (skipped, already applied) / `fail` (failed, with reason) / `unknown` (cannot be determined, needs manual check). **Never disguise `fail`/`unknown` as `success`.** | Differs from "three-state": this skill deliberately adds the `unknown` state to catch non-standard / undeterminable API responses - prefer labeling unknown over faking success. |
| **Rate-limit (429)** | Liepin's server-side throttling on overly frequent requests (HTTP still 200, but the response says "too frequent / restricted"). | Not an HTTP 429 - it is a business-layer throttle, so `isRateLimit()` uses text detection, not the status code. |
| **Backoff-and-retry** | On hitting rate-limit, wait with exponential backoff 15→240s; if cumulative wait exceeds 1800s it is judged "persistent rate-limiting" and auto-pauses. | Opposite of "brute-force retry": it has an upper bound and proactively stops. |
| **Cross-session de-duplication** | Reads all historical reports in the workspace, merges already-applied jobIds, and skips them this run - never re-applies to the same HR. | "Cross-session" means it also works across different runs, relying on persisted historical report files. |
| **Daily quota (dailyCap)** | `liepin_daily_quota.json` records `{date,count}`; stops when reached, resets at calendar-day 0:00. | Differs from "this-run cap": the quota is a cross-run cumulative daily total. |
| **Non-recruiter / recruiter** | `recruitmentType=nonRecruiter` keeps only direct enterprise hiring; `recruiter` keeps only recruiter / HR-service firms; `all` keeps both but prioritizes non-recruiters. | "Recruiter detection" is **heuristic** (not 100% precise), so `all` is kept as a fallback. |
| **Unattended** | The automation mode explicitly enabled by the user at wizard step 6: runs automatically on schedule, **zero touch**, no daily confirmation needed. | Only enabled **after explicit user authorization**; still protected by dailyCap / rate-limit / circuit-breaker guardrails - never unbounded mass-apply. |
| **Circuit breaker** | 3 consecutive non-rate-limit hard failures (e.g. token invalid) stops the process (exit code 3) to avoid wasted effort and account risk. | Distinct from "rate-limit pause": the breaker targets hard failures; the pause targets throttling. |
| **De-dup set** | The in-memory `Set<jobId>` merged from historical reports + this run's applied jobs. | Contains only `success`/`already` jobIds; `fail`/`unknown` are not counted (allowed to retry). |
| **Preference memory** | Each wizard submission writes the user's criteria to the workspace `liepin_wizard_config.json`, read back next time as "last preference", pre-filled and offered for reuse. | Differs from "cross-session de-dup": preference memory records "what you want to apply for"; de-dup records "what was already applied". The preference file contains no token and no personal info. |

---

## 0,TL;DR (30-second orientation)

- Want to **auto-apply on Liepin** → just say "help me apply my resume to director / general-manager roles on Liepin"; the skill **auto-launches the wizard and pops the form** (no need to ask for it); if a last preference exists in the workspace, it will **proactively ask whether to reuse it**.
- Want **direct hiring only, no recruiters** → choose "Non-recruiter positions only" in the wizard.
- Worried about **re-applying / getting rate-limited** → built-in cross-session de-dup + rate-limit guard + daily cap protect you automatically.
- Want to know **how it went** → read `liepin_wizard_summary.md` for a clear four-state breakdown.
- Want it to **run unattended (no action needed)** → enable "Unattended" at wizard step 6; after generating the automation spec the agent registers a periodic task, fully hands-off.
- Scripts are **really runnable**: `scripts/wizard.js` (wizard) + `scripts/apply_pipeline.js` (delivery), zero external dependencies, runs directly on Node 18+.

---

## 1, Capability Boundaries (what it does / doesn't do)

### What it does (11 core capabilities)
1. One-click launch of the web wizard (fills job title / industry / location / salary / recruitment type / daily cap in one go); on trigger it auto-pops the preview panel (not a dialog popup).
2. Cross-page keyword search on Liepin (with salary-floor passthrough).
3. Client-side multi-dimensional hard filtering (industry OR / multi-city OR / salary range; job title already includes level, so level is no longer filtered separately).
4. Recruitment-type filtering (non-recruiter only / recruiter only / both with non-recruiter priority).
5. Recruiter detection and post-filter sorting (heuristic).
6. Cross-session permanent de-duplication (reads all historical reports and merges applied jobIds).
7. Rate-limit guard + exponential backoff auto-retry.
8. Daily quota cap to protect the account.
9. Real four-state result judgment (success / already / fail / unknown).
10. Per-item failure reasons + result summary (MD + JSON).
11. Graceful interruption recovery (SIGINT/SIGTERM persistence + global runtime guardrail + consecutive-failure circuit breaker).

### What it does NOT do (hard boundaries)
1. **Does not apply to platforms other than Liepin** (BOSS / Zhaopin / 51job etc. are handled by their own skills).
2. **Does not fabricate or tamper** with resume content or delivery info.
3. **Does not brute-force mass-apply to bypass rate limits** (account health is a hard constraint).
4. **Does not collect or store** user personal info (name / phone / email / account).
5. **Does not handle** housing-fund / social-security / arbitration government systems.
6. **Does not bypass** Liepin token auth or reverse-engineer the API.
7. **Submit-and-auto-apply, zero touch** (except proactive notice on rate-limit / interruption anomalies); if the user explicitly enables "Unattended" at wizard step 6 and authorizes automation, it runs on schedule per config (still guarded by dailyCap, no unbounded mass-apply).

### Special-scenario boundaries
| Scenario | Handling |
|---|---|
| No Token (`LIEPIN_USER_TOKEN` or config file) | Prompt to run `liepin-cli setup` or set `LIEPIN_USER_TOKEN`; never guess or blindly continue |
| Token has no apply permission (401) | Abort on first pre-check, exit code 2, clearly tell user to regenerate |
| Token expires mid-run (401 during delivery) | Keep what was applied, abort and prompt to regenerate, can resume |
| First run in a fresh env | Starts with empty history; this run's applied jobs are still recorded for de-dup |
| Recruiter mis-detection | "Both" option provided as fallback; not 100% precise, by design |
| Relies only on official liepin-cli | Talks to Liepin OpenAPI directly; liepin-cli must be pre-installed and on PATH |
| Overseas / HK-Macau-Taiwan job search | Not supported; only domestic Liepin OpenAPI |
| Campus / internship / trainee mass-apply | Supported (enter "trainee / intern / probationer" etc. as job title); campus-only channels go through the campus system, this skill only applies to open social-recruitment roles |
| Zero search results | Prompt to relax keywords / industry / salary; never apply blindly |
| Employer requires an attachment resume | Liepin online resume delivery; attachment requirement escalates to manual prompt |
| Overlapping multi-keywords | Merge and de-dup; same jobId never applied twice |
| No network / server failure | Catch exception, write partial report and exit; progress not lost, can resume |
| Cross-city / location change | Re-fill location each time; de-dup still works cross-session |
| Multiple accounts at once | Not supported; single token per person only |
| Position closed / taken down | Mark fail + reason; never fake success |

---

## 2, Trigger Conditions (full trigger lexicon + three-tier judgment)

> This skill is highly sensitive to the combination **"Liepin" + "apply / submit / deliver"**, supporting dozens of colloquial, imperative, and interrogative phrasings; non-Liepin platforms or pure resume-writing / market-chat **do not trigger**.

> **Hard rule for auto-launch (v3.0.0 rewrite · self-check + install + foreground full chain)**: once a trigger word hits, the agent **must first run** `node scripts/selfcheck.js --auto-install` (**foreground**, not background / run_in_background),
> ① Detect and auto-install liepin-cli (pip install into a managed venv)
> ② Immediately show the install result (✅ CLI ready / ❌ failure reason) **to the user**
> ③ Then run `node scripts/wizard.js` (**foreground**, keep connection, long timeout), read `WIZARD_URL` from stdout and pop the preview panel.
> **Key behavior**: wizard.js **blocks waiting** until the user submits; after the user clicks "Submit and start auto-apply", wizard.js internally auto-spawns `apply_pipeline.js` (`stdio:inherit`), whose output is **streamed line-by-line in real time** to the agent stdout. The agent **must read line-by-line and show to the user immediately** - each application outputs one line `[apply seq/total] role@company|status: reason`, which is the user's real-time progress.
> **Forbidden**: ① skip selfcheck and run wizard directly ② wait for the user to say "I want the WEB wizard" ③ use a dialog popup instead of the preview panel ④ **run wizard.js in background** (makes output invisible, back to the old "need to ask progress" path) ⑤ **after user submits, say "waiting for confirmation / waiting for response"** - submit means auto-apply.

### 2.1 Trigger lexicon (full, grouped by intent; more phrasings = easier hit)
- **Apply / submit (direct intent)**: apply resume, help me apply, auto-apply, bulk apply, one-click apply, help me submit, submit application, apply a bit, mass apply, blanket apply, throw resume out, auto-submit, bulk submit, consecutive apply, idle apply, apply daily, apply on my behalf, smart apply, semi-auto apply, auto-send resume, help me send resume.
- **Liepin-specific**: apply on Liepin, apply on Liepin, Liepin resume, Liepin jobs, Liepin job search, liepin apply, apply via Liepin, Liepin help me find, apply on Liepin for me.
- **Filter / exclude**: direct hiring only, no recruiters, non-recruiter roles, filter recruiters, enterprise roles only, exclude recruiters, direct-hire priority, don't apply to recruiters, drop agencies, social recruitment only.
- **De-dup / no repeat**: don't re-apply, no duplicates, skip applied ones, de-dup, don't pester the same HR, don't apply to already-applied.
- **Rate-limit / protection**: don't apply too fast, control frequency, don't get banned, apply gently, don't trip risk control, safe delivery, rate-limit protection.
- **Resume / interruption**: continue applying, resume, didn't finish yesterday, keep applying, resume from breakpoint, unfinished last time, top up, apply the rest.
- **Status / query**: how did it go, any response, which did I apply, applied list, how many succeeded, failure reasons, how many applied today, how many left.
- **Config / setup**: set up delivery, configure delivery, set it up for me, make a delivery plan, plan delivery, apply by my criteria.
- **Interrogative / colloquial**: is there a tool to auto-apply on Liepin, can you auto-apply for me, can Liepin auto-apply, how to bulk-apply on Liepin, any quick way to apply, I want to apply lying down, help me get delivery done, applying is too tiring I leave it to you, auto-apply a bit for me daily.

### 2.2 User phrase → recognition mapping (expanded examples)
| User phrase | Recognized as | Action |
|---|---|---|
| "Help me apply my resume to those director roles on Liepin" | apply + role | launch wizard, pre-fill keyword |
| "Is there a one-click Liepin apply tool" | wizard-like | launch wizard |
| "Auto-apply non-recruiter roles on Liepin for me" | recruiter filter | default recruitmentType nonRecruiter |
| "Didn't finish yesterday, continue today" | resume-like | read history de-dup then resume |
| "Any response to my applied resumes" | status-like | read latest summary and report |
| "Mass-apply a round on Liepin for me" | apply-like | launch wizard, default all industries |
| "Throw the resume out, no recruiters" | apply + filter | recruitmentType nonRecruiter |
| "Auto-apply a bit for me daily on liepin" | apply + resume | launch wizard, daily cap protection |
| "Don't re-apply, be gentle" | de-dup + rate-limit | de-dup + backoff guard |
| "Liepin job hunt is tiring, you do it" | colloquial apply | launch wizard |
| "Bulk-apply by my salary criteria" | apply + salary | launch wizard, pre-fill salary |
| "Apply the rest of the roles" | resume-like | read quota and resume |
| "Which succeeded, which failed" | status-like | read summary, grouped report |
| "Set a delivery plan for me, direct hiring only" | config + filter | launch wizard, pre-fill recruitment type |
| "Apply lying down, just don't get banned" | colloquial + rate-limit | launch wizard + rate-limit guard |

### 2.3 Quantified three-tier judgment (short-circuit)
- **High trigger**: contains "Liepin" + (one of "apply / submit / deliver / auto-apply / one-click / mass-apply / throw resume") + role/need intent → launch wizard directly.
- **Medium trigger**: contains "Liepin" + "apply / submit" but vague need → launch wizard, fill gaps with defaults (job title defaults to HR direction, industry/location unrestricted, salary floor 25K, ceiling 50).
- **No trigger**: only chatting about hiring trends / writing resume / other platforms (BOSS, Zhaopin, 51job) / pure consultation → don't start, point to the relevant skill or boundary.
- **Ambiguity fallback**: if "Liepin" + "apply" but clearly means "help me see apply techniques" (not a real apply), prefer to ask for confirmation to avoid mis-launch.

---

## 3, Quick Start (4 steps)

1. **Install dependency (required first time)**: install the official open-source `liepin-cli` and add it to PATH (see "Dependency Pre-check" below). This skill calls it to actually hit Liepin's API; without it nothing runs.
2. **Get Token**: `liepin-cli setup` (interactively generates credentials and writes `~/.config/liepin-cli/config.json`), or copy `x-user-token` from 👉 https://www.liepin.com/mcp/auth and set it as env var `LIEPIN_USER_TOKEN`.
3. **Trigger auto-pops the wizard**: say a trigger phrase like "help me apply on Liepin"; the agent **immediately** runs `node scripts/wizard.js` in the foreground and **proactively pops the preview panel** opening `WIZARD_URL` (form auto-pre-filled with last preference, no need to wake it). Fill job title / industry / location / salary etc., then click "Submit and start auto-apply".
4. **Auto foreground delivery**: after wizard.js submits it **auto-starts delivery** (foreground, shows each result), no further action needed; only on rate-limit / interruption does it proactively notify. At the end read `liepin_wizard_summary.md` for a one-line report.

---

## 3.5, Dependency Pre-check (highest priority · read before first use)

This skill does **not** talk to Liepin's API directly; it calls the official open-source CLI **`liepin-cli`** to do search and delivery. Without it, the skill cannot run on this machine.

**Why must liepin-cli be installed?**
- It is Liepin's official open-source CLI, encapsulating auth, local request validation, and retries - legal and stable; this skill only does "filter + decide + display", delegating "actually sending requests" to it.
- Without it, `apply_pipeline.js` fails immediately with "liepin-cli command not found" - no search, no delivery.
- Without it there is also no unified token management: you'd pass the token manually each time, easily expired and easily leaked in shell history.

**Install once (any one):**
1. **pip + virtualenv (recommended)**: in the repo root run
   ```bash
   python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
   pip install -e ".[dev]"
   ```
   After install, ensure `liepin-cli` is on PATH: typing `liepin-cli --help` shows help = success.
2. **uv**: `git clone https://github.com/liepin-tech-2026/liepin-cli && cd liepin-cli && uv sync`, common command `uv run liepin-cli --help`.
3. If CLI is installed in a non-standard path, set env var `LIEPIN_CLI_BIN` to its executable before running (e.g. `/usr/local/bin/liepin-cli` or `C:\liepin-cli\liepin-cli.exe`).

**After install, don't forget the Token (see Stage 0)**: `liepin-cli setup` writes the config once, then auto-reused for all runs.

> **Agent must-do (proactively tell on missing dependency)**: before the first delivery trigger, the agent should run `node scripts/selfcheck.js` for a dependency pre-check; if it says "liepin-cli not installed", **proactively ask the user whether to install now** and paste the step-by-step above; don't assume it's installed, don't fail silently.

---

## 4, Execution Flow (strict order)

### Stage 0: Token preparation (step-by-step, based on liepin-cli)

> **Tell the user proactively**: The Token is only for this run, auto-read by liepin-cli (env `LIEPIN_USER_TOKEN` or config `~/.config/liepin-cli/config.json`), **not written to skill files, not saved to my memory, not printed to logs** - safe to use.

**Recommended (one-time, persistent credentials)**: run `liepin-cli setup` → browser opens Liepin auth page (👉 https://www.liepin.com/mcp/auth) → paste `x-user-token` → auto-written to local config, auto-reused for all later runs, no need to pass each time.

**Temporary (single run)**: `$env:LIEPIN_USER_TOKEN="the x-user-token you got from https://www.liepin.com/mcp/auth"`, valid only for current shell.

- Credentials last ~90 days; if delivery returns 401, re-run `liepin-cli setup` to refresh.
- ⚠️ Do not put `x-user-token` into `liepin_wizard_config.json` (that file only stores job preferences, no credentials).

### Stage 1: Web wizard auto-pops + submit-and-auto-apply (core highlight)

> **Hard rule (prevent "wizard doesn't auto-pop" accident)**: after the agent recognizes an apply trigger, **immediately** run `node scripts/wizard.js`, read the output `WIZARD_URL`, and **proactively open that URL with the preview panel** - **never wait for the user to say "I want the WEB wizard / open wizard / bring up the form"**, and **never use a dialog popup** to collect criteria.

**Zero touch (key)**:
- After the user fills criteria in the wizard page and clicks "Submit", `wizard.js` **auto-starts the delivery pipeline (`apply_pipeline.js`) and streams progress in the foreground** until this run's quota is exhausted or rate-limit / interruption stops it. **The agent must not ask the user further questions** (except anomalies needing user awareness or decisions, like rate-limit / interruption).
- The agent must run `node scripts/wizard.js` **in the foreground** (not background) so it can read and display delivery logs in real time; the user sees each result in the chat at any time.

**Preference memory and proactive reuse**:
- On trigger, check whether the workspace already has `liepin_wizard_config.json`:
  - If not → launch a blank wizard (preview already auto-opened), user fills once.
  - If yes → read config, **auto-pre-fill the form** (job title / industry / location / salary / recruitment type / daily cap); user can tweak then submit; **no dialog "reuse?" popup**, to honor zero-touch.

**Wizard form fields (v2.1.0 merged role + level)**:
- **Job title (role + level combined)**: e.g. "HR Director, Finance Manager, Procurement Supervisor, IT Specialist, Recruiting Manager". Multiple separated by comma / ideographic comma.
- **Industry**: 20+ industries, multi-select; check "All" for all industries.
- **Work location**: "All" = nationwide; or multiple cities (comma-separated, e.g. "Zhuhai, Shenzhen, Guangzhou").
- **Salary range**: floor / ceiling (K/month).
- **Recruitment type**: non-recruiter only / recruiter only / both.
- **Daily delivery cap**: default 50, guarded by rate-limit guardrails.

**Recommended execution flow (self-check → install → foreground full chain)**:
1. **Required**: agent first runs `node scripts/selfcheck.js --auto-install` (**foreground**), shows install result to user.
2. Agent runs `node scripts/wizard.js` (**foreground**, not background), reads `WIZARD_URL`, **proactively opens the preview panel**.
3. User fills once in the page → clicks "Submit and start auto-apply".
4. `wizard.js` writes config and **immediately spawns `apply_pipeline.js`** (`stdio:inherit`, foreground per-item delivery, **real-time output of each result to agent stdout**). **Agent reads stdout line-by-line and immediately shows each `[apply seq/total]...` line to the user as-is**.
5. After `wizard.js` exits (normal / cap reached / rate-limited / interrupted), agent reads `liepin_wizard_summary.md` for a one-line report.
6. **User never needs to say "submitted" / "how's progress" / "check progress"** - progress streams line-by-line in the chat, clear at a glance.

**Check progress (fallback)**: if for special reasons the wizard ran in background, when the user says "check progress" the agent reads `liepin_wizard_progress.jsonl` (appended per item in real time) and reports the latest.

**Fallback (when web unavailable)**: degrade to step-by-step collection via conversation questions, but **strictly never reference any user personal info** (household / current residence / name etc.); all locations and contacts must be filled by the user; still includes "job title (role+level)" / "recruitment type" and keyword-split hints.

### Stage 2: Auto-notify before delivery (daily cap, non-blocking)

> Submit-and-apply, zero touch: no confirmation dialog. After the pipeline starts, `apply_pipeline.js` **auto-prints** in the log: recruitment type, daily cap=N, applied today=M, max applicable this run N-M, filter settings. This is **notification not interrogation** - no user action needed, auto-starts.

After filtering, the pipeline clearly announces: "[Filter result] By your settings, X valid matching roles were found, starting delivery now...", then delivers per item with real-time results.

### Stage 3: Fully-automated delivery pipeline (foreground run + per-item real-time display)

> Agent runs `node scripts/wizard.js` **in the foreground** (it internally spawns `apply_pipeline.js` and streams logs). If running the pipeline alone, also foreground:

```powershell
# Token is auto-read by liepin-cli (env LIEPIN_USER_TOKEN or config file); no need to pass here
node scripts/apply_pipeline.js
```

- **Per-item real-time display**: each application immediately outputs `[apply seq/total] role @ company (location)|status: reason`, and **each line the agent shows to the user as-is immediately**, so the user always knows progress. **Never make the user say "check progress" to learn results**.
- **Filter announced first**: before actual delivery, the pipeline prints [Filter settings] and [Filter result: X matching roles found, starting delivery now], so the user knows the count immediately, then per-item delivery.
- **Progress file**: each application appends a line to `liepin_wizard_progress.jsonl`; when the user says "check progress" read this file for the latest (fallback only, normally not needed).
- Script auto: search → client hard filter (multi-city OR / industry OR / salary-parse-fail lets pass) → recruitment-type filter → recruiter detection sort → cross-session de-dup → daily quota check → first-item pre-check → **per-item delivery (1.5s interval, 429 auto backoff retry)** → write report.
- **Exit codes and proactive notice (agent must-do)**: on persistent rate-limit / interruption / circuit-break (exit code 3 / 130 / 2), the agent **must proactively explain the reason in text immediately** and state progress is saved and safe to resume (see Chapter 8 / references/errors.md).

### Stage 4: Result display (with failure reasons)
Read `liepin_wizard_summary.md` and clearly state: which roles applied this run, ✅ success X, ❌ fail Y + **each failure reason**, ⚠️ already Z, ❓ unknown W, **applied today (M+X)/cap N**.

---

## 5, Configuration Structure (liepin_wizard_config.json)

```json
{
  "keywords": ["HR Director", "Finance Manager"],
  "industry": ["__ALL__"],
  "location": "__ALL__",
  "salaryFloor": 30,
  "salaryCeil": 500,
  "recruitmentType": "nonRecruiter",
  "dailyCap": 50,
  "maxPages": 6
}
```
- `keywords`: job title (role + level combined), e.g. "HR Director, Finance Manager, Procurement Supervisor, IT Specialist"; multiple separated by comma / ideographic comma, script auto-splits and searches each.
- `recruitmentType`: `nonRecruiter` (direct only, recommended) / `recruiter` (recruiter only) / `all` (both, non-recruiter priority).
- `levels` field is deprecated (job title already includes level); script always processes fully, no separate level filter.
- Full field docs and valid values in repo `liepin_wizard_config.example.json`.

---

## 6, Script Notes (scripts/, zero external deps, really runnable)

- **wizard.js**: local HTTP server (random port, bound to 127.0.0.1), serves the web wizard form (single page); on submit writes config and exits. Zero deps (only Node stdlib http/fs/path).
- **wizard.html**: wizard frontend (clean Stripe-style form), loaded by wizard.js.
- **apply_pipeline.js**: delivery pipeline, calls official open-source liepin-cli (`job search` / `job apply --output json`) underneath, parses its raw JSON response.
  - **Recruitment-type filter**: `nonRecruiter` drops recruiters; `recruiter` keeps only recruiters; `all` keeps all with non-recruiter priority.
  - **Rate-limit guard**: built-in `isRateLimit()` detects 429, exponential backoff (15/30/45/60/90/120/180/240s, cumulative >1800s throws and stops).
  - **De-dup**: reads all historical reports and merges applied jobIds, cross-session permanent.
  - **Daily quota**: `liepin_daily_quota.json` records `{date,count}`, stops at `dailyCap`, resets at day change.
  - **Four-state result**: `success`/`already`/`fail`/`unknown`, never treat fail/unknown as success.
  - **Recruiter detection**: industry / company / JD heuristic against recruiter brand library.
  - **Interruption recovery**: catches SIGINT/SIGTERM, writes partial report and exits 130, progress not lost.
  - **Stability guardrail (v1.1.0)**: global runtime cap 45 min graceful stop (exit 0); 3 consecutive non-rate-limit hard failures circuit-break stop (exit 3), avoids wasted effort and account risk.
  - **setup_automation.js** (v1.2.0): automation-run setup helper. Reads config; if `unattended=true` generates `liepin_automation_spec.json` (name/rrule/prompt/cwd four elements) for the agent to register a periodic automation via `automation_update`, achieving "zero touch". Zero deps.

### 6.1 Capability mapping (doc promise ↔ script implementation, verifiable)
| Doc promise | Script implementation | Verification |
|---|---|---|
| Web wizard criteria collection | `wizard.js` local server + `wizard.html` form | `node --check` passes; zero deps (only http/fs/path) |
| Recruitment-type filter | `apply_pipeline.js` `recruitmentType` 3 branches | `nonRecruiter`/`recruiter`/`all` all implemented |
| Cross-session permanent de-dup | reads all historical `report.json` and merges jobId | applied auto-skipped, never repeated |
| Rate-limit guard | `isRateLimit()` + exponential backoff 15→240s | cumulative >1800s throws and stops |
| Daily quota cap | `liepin_daily_quota.json` | stops at `dailyCap`, day-change reset |
| Real four-state result | `success/already/fail/unknown` | never treat fail/unknown as success |
| Graceful interruption recovery | catches SIGINT/SIGTERM and persists | exit 130, rerun resumes |
| Stability guardrail | 45min cap + 3 consecutive failures circuit break | exit 0 / 3 |
| Token not persisted | inline only in this command | not written, not memorized, not logged |

### 6.2 Innovations and differentiation (why different)
- **Single-page wizard vs multi-turn chat**: collect all criteria (job title / industry / location / salary / recruitment type / daily cap) in one web form, no repeated Q&A.
- **Recruitment-type filter (industry first)**: `nonRecruiter/recruiter/all` three states, the first job skill to make "direct hiring only, no recruiters" a built-in capability.
- **Cross-session permanent de-dup**: reads all historical reports and merges jobIds, no repeated pestering of the same HR across runs.
- **Four-state transparent result**: success/already/fail/unknown clearly separated, failure with reason, unknown labeled unknown, never fake success.
- **Rate-limit + quota dual guardrail**: exponential backoff + daily cap, account safety as a hard constraint not an option.
- **Stability guardrail**: 45-minute global cap + consecutive-failure circuit break, avoids wasted effort and account risk.

---

## 7, Output and Result Display

- `liepin_wizard_report.json`: machine-readable, with summary four-state counts, dailyQuota, per-item results.
- `liepin_wizard_summary.md`: human-readable, lists role-level items grouped by "success / fail+reason / already / unknown".
- Full end-to-end example (search response, four-state judgment, report sample, rate-limit chain) in **references/examples.md**.

---

## 8, Exception Handling (exit codes + E-series error codes)

| Exit code | Meaning | Agent should proactively tell |
|---|---|---|
| 0 | Done / daily cap reached / timeout guardrail stop | proceed to Stage 4 on done; on cap say "rest left for tomorrow"; on timeout say "rerun resumes" |
| 2 | Pre-check 401 | "Token has no delivery permission, go back to Stage 0 to regenerate credentials" |
| 3 | Persistent rate-limit / consecutive-failure circuit break | "Auto-paused, de-dup guarantees safe resume later" |
| 130 | User interruption | "Interrupted, X applied, progress saved, rerun resumes" |
| 1 | Fatal error | report as-is |

Full E001~E013 error codes (trigger / script behavior / friendly phrasing) in **references/errors.md**. Principle: **never fake success, progress not lost, resumable, proactively told**.

### 8.1 Stability and recovery guardrails (account safety, v1.1.0 enhanced)
- **Rate-limit guard**: on detecting 429/"frequent" use exponential backoff (15/30/45/60/90/120/180/240s); cumulative backoff >1800s judged persistent rate-limit, auto-pause (exit 3), de-dup guarantees safe resume later.
- **Daily quota**: `liepin_daily_quota.json` records `{date,count}`, stops at `dailyCap`, resets at calendar-day 0:00, prevents over-apply in one day tripping risk control.
- **Global runtime guardrail**: runtime over 45 min graceful stop (exit 0), rerun resumes, avoids long idle waste.
- **Consecutive-failure circuit break**: 3 consecutive non-rate-limit hard failures (e.g. token invalid) circuit-break stop (exit 3), avoids blind retry and account risk.
- **Interruption recovery**: SIGINT/SIGTERM caught writes partial report and exits 130, progress not lost; rerun auto-skips applied and resumes rest.
  - **First-item pre-check**: before bulk, apply 1 item first to verify token/permission; 401 aborts immediately (exit 2), no wasted later requests.
  - **Subprocess hard timeout (v3.0.1 · fixes silent crash)**: `runCli` adds a **90s hard timeout** (`CLI_TIMEOUT_MS`) per `liepin-cli` call; on timeout `SIGKILL` the hung subprocess and degrade-retry; **a single role's delivery exception no longer breaks the whole run** - rewritten as "mark `fail` + resume rest", only persistent rate-limit (`RATE_LIMIT_PERSIST`) still breaks. Added global `uncaughtException` / `unhandledRejection` fallback: dump full stack to `liepin_wizard_crash.log` first then delayed exit, eliminating the "process exit 1 but no [FATAL] output" silent crash.

> 🐞 **Known failure case **(must remember): early `apply_pipeline.js` `runCli` **had no subprocess timeout**. When a role's (a "Overseas HR Director @ a Wuhan-based telecom equipment listed company") `liepin-cli` subprocess hung, `await applyJob` never returned → whole run froze; compounded by `process.exit()` truncating unflushed stderr, the crash showed "exit code 1, no [FATAL] in log". Three reinforcements (90s timeout + per-item fallback + global dump) landed in v3.0.1; on 2026-07-19 in practice 41/41 completed, 0 crashes, 10 new applies succeeded. Next time you see "whole run freezes / silent exit on a certain role", just confirm these three are in place.

> Any abnormal exit (non-0 / cap reached / circuit break / interruption), the agent **must proactively explain in text immediately** the reason + progress saved + safe to resume (see errors.md and Chapter 7).

---

## 9, Automation Run (Unattended)

> The name is the promise: this skill **can be scheduled and run unattended, zero touch**. Once enabled, periodic automation delivers on schedule per config, no popup, no attendance.

### 9.1 How to enable (three steps)
1. **Wizard enable**: at wizard step 6 choose "Enable unattended" and pick a frequency (daily 09:00 / 12:00 / 20:00 / every 6 hours / every 12 hours). Config written to `liepin_wizard_config.json` `unattended:true` and `schedule`.
2. **Generate automation spec**: agent runs `node scripts/setup_automation.js`, which reads config and writes `liepin_automation_spec.json` (name / rrule / prompt / cwd four elements).
3. **Register periodic automation**: agent uses `automation_update` (mode=create) to register per spec; then runs automatically on schedule.

### 9.2 Run rules (unattended mode)
- Agent reads saved config; if `unattended=true` and token configured (`LIEPIN_USER_TOKEN` or `~/.config/liepin-cli/config.json`), **skip Stage 2 daily confirmation**, go straight to Stage 3 full auto-run (zero touch).
- Still guarded by **dailyCap / backoff / 45-min guardrail / consecutive-failure circuit break** four protections, never unbounded mass-apply.
- If token missing or config absent, only text-report, no unauthorized action.
- At end read `liepin_wizard_summary.md` for a one-line result report.

### 9.3 spec example (setup_automation.js output)
```json
{
  "name": "Liepin Auto-Apply (Unattended)",
  "scheduleType": "recurring",
  "rrule": "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
  "cwds": "<workspace path>",
  "prompt": "Read workspace liepin_wizard_config.json; if unattended=true and token configured, directly run node scripts/apply_pipeline.js (no confirmation); at end read summary for a one-line report."
}
```

### 9.4 Disable / adjust
- Change wizard step 6 back to "disabled" → regenerate config; or `automation_update` (mode=update, status=PAUSED) to pause the periodic task.
- Frequency change: after changing `schedule` rerun `setup_automation.js` and re-register.

---

## 10, End-to-End Example

See **references/examples.md**: conversation trigger, config generation, search response, four-state judgment, success/fail/unknown report, rate-limit chain - 7 complete samples.

---

## 11, Reading Path (quick lookup by task)

### 11.1 Quick lookup (want X → which chapter)
| I want to... | Go to |
|---|---|
| Quickly judge if this skill fits me | One-line positioning + 0 TL;DR + Glossary |
| Know what it can/can't do | Section 1, Capability Boundaries (incl. special-scenario table) |
| Trigger it in plain words (what do I say to start) | Section 2, Trigger Conditions (lexicon + mapping + three-tier) |
| Get it running in 3 steps | Section 3, Quick Start |
| Understand how to get Token, is it safe | Stage 0 + references/token_setup.md + FAQ Q2~Q5 |
| How to use the criteria wizard | Stage 1 + Section 6 (script notes) |
| Apply to multiple role directions | Wizard keyword box comma/ideographic-comma separated, auto-split into independent keywords (v1.4.0 fix) |
| Apply nationwide | Wizard location "All" or blank, auto-normalized to `__ALL__` (v1.4.0 fix) |
| Direct hiring only, no recruiters | Section 5 (recruitmentType) + FAQ Q9 + Q13 |
| Prevent re-apply / rate-limit | Section 1, Capability Boundaries + 8.1 Stability Guardrail + FAQ Q14/Q18 |
| Understand results (success/fail/unknown) | Section 7, Output and Result Display + FAQ Q23~Q26 |
| Halfway broken / error how to resume | Section 8, Exception Handling + 8.1 + FAQ Q27~Q30 |
| Run unattended (no action) | Section 9, Automation Run (Unattended) |
| See real battle results and pitfall review | README.md |
| See full input/output samples | references/examples.md |
| Look up error-code phrasing | references/errors.md |
| High-frequency questions / anti-patterns | references/FAQ.md (45+ items) |
| Run quality gate / self-check | `npm test` + `node scripts/selfcheck.js` |

### 11.2 Progressive reading suggestion
- **30 seconds**: read "TL;DR" + "One-line positioning", confirm fit.
- **5 minutes**: read "Section 1, Capability Boundaries", "Section 2, Trigger Conditions", "Section 3, Quick Start", can start directly.
- **Deep**: read "Sections 4-8" execution flow and exception handling in order; on problems check `references/FAQ.md`, see `references/examples.md`, look up error codes in `references/errors.md`.

---

## 12, Reference Index

| File | Role |
|---|---|
| `SKILL.md` | This spec and execution flow (incl. glossary / quick lookup / changelog) |
| `README.md` | Real battle experience review and pitfall summary (incl. v1.1.0~v1.3.0 change highlights) |
| `scripts/wizard.js` + `wizard.html` | Web wizard criteria collection (really runnable, zero deps) |
| `scripts/apply_pipeline.js` | Delivery pipeline (really runnable, zero deps, 6 unit-testable pure functions) |
| `scripts/setup_automation.js` | Automation-run setup helper (generates periodic automation spec) |
| `scripts/selfcheck.js` | Pre-run self-check (Node version / token format / config validity / script existence / writability) |
| `tests/` | Unit tests (salary parse / four-state judgment / rate-limit detect / recruiter detect / de-dup / quota), `npm test` one-click |
| `liepin_wizard_config.example.json` | Config field examples and valid values |
| `package.json` | Runtime declaration (Node>=18, zero external deps, with test/selfcheck scripts) |
| `references/FAQ.md` | 51+ high-frequency Q&A, anti-patterns and boundary scenarios (incl. ambiguity resolution) |
| `references/examples.md` | Full-chain input/output examples |
| `references/errors.md` | E001~E013 error codes and friendly phrasing |
| `references/token_setup.md` | Step-by-step illustrated Token guide (lowers the token barrier) |

---

## Security & Compliance / Privacy Desensitization

- Token is inline only for this command, not persisted, not memorized, not printed.
- **Do not collect or store any user personal info** (name / phone / email / account / household / residence etc.); the skill package, reports, wizard form, and chat display **contain no** personal info.
- **Runtime hard rule (prevent personal-info leak)**: the agent in wizard hints, fallback Q&A, or any chat output, **must never display or infer user personal info** (e.g. "your household is XX, current residence XX"); all locations and contacts must be filled by the user, never auto-filled from user profile or inferred.
- Outbound delivery is a sensitive action; scope/caliber changes should be confirmed with the user first (but the normal post-submit delivery flow needs no further asking).
- Obey Liepin rate limits, no brute-force mass-apply; default daily cap protects account health.
- Relies only on official open-source liepin-cli (domestic direct connection), no GitHub, no overseas dependency.

---

> 🗃️ The changelog below is for skill maintainers only; ordinary users can skip.
>
> ## 13, Changelog (maintainer reference)

| Version | Date | Core change |
|---|---|---|
| **v3.0.1** | 2026-07-19 | **Fix silent crash in delivery pipeline **(must-hit in real use): `scripts/apply_pipeline.js` three reinforcements - ① `runCli` adds 90s subprocess hard timeout (`CLI_TIMEOUT_MS`), on timeout `SIGKILL` the hung subprocess and degrade-retry; ② bulk-delivery loop per-item exception fallback: a single role failure marked `fail` and resume rest, no longer breaks the whole run (persistent rate-limit still breaks); ③ global `uncaughtException`/`unhandledRejection` fallback: dump full stack to `liepin_wizard_crash.log` first then delayed exit, curing "exit 1 but no [FATAL] output". Root cause: old `runCli` had no timeout; a role (a "Overseas HR Director @ a Wuhan-based telecom equipment listed company") CLI subprocess hung froze the whole run, compounded by `process.exit` truncating stderr. In practice 41/41 completed, 0 crashes, 10 new applies succeeded. |
| **v2.3.0** | 2026-07-18 | **Thoroughly fix two core UX problems "no auto-start after submit / no progress in foreground"**: ① rewrote all SKILL.md "start wizard in background" → "foreground run + keep connection" - line 126 hard rule, Stage 1, recommended flow, Stage 3 all corrected; ② explicitly require the agent to "read stdout line-by-line, show each `[apply]` line to the user as-is, never make the user say 'check progress'"; ③ fallback "check progress" labeled as fallback (normal use should use foreground output instead); ④ wizard.js code unchanged (`spawn` + `stdio:inherit` was already correct), this fix focused on correcting the agent's wrong execution pattern |
| **v2.2.0** | 2026-07-18 | **Full doc and UX remediation (fix issues raised by evaluation)**: ① **Recruiter detection v2 (three-layer)**: added 50+ known direct-hire enterprise whitelist (layer 1 instant non-recruiter) + 50+ known recruiter brand library (layer 2 instant match) + layer 3 weighted scoring engine (industry/company/JD feature fusion, much higher accuracy); ② **liepin-cli auto-install**: `selfcheck.js --auto-install` one-click install into managed Python venv, added `quickstart.js` one-click init script, user only provides Token; ③ **Doc slimming**: top-level added "5-minute quick start" minimal version, verbose docs folded into "📚 Deep reference" area, each chapter added ⏱️ hint; **④ First-use UX optimization**: README first-screen 5-second banner, FAQ expanded to 70+ items; ⑤ three-layer algorithm + auto-install + quickstart + full doc restructure; 57 unit tests all pass. |
| **v2.1.0** | 2026-07-18 | Thoroughly fix five real-use UX problems (user screenshot feedback): ①**Full personal-info desensitization**: added runtime hard rule, wizard hints / fallback Q&A / chat must never show or infer user personal info (household / residence / name etc.), all locations filled by user; ②**Wizard auto-pop **(not popup): after trigger the agent immediately runs `wizard.js` in foreground and proactively pops preview panel opening the page, never wait for "I want WEB wizard", nor use a dialog popup; ③**Submit-and-auto-run**: after `wizard.js` submits it internally auto-spawns `apply_pipeline.js`, zero touch (except rate-limit / interruption), no longer wait for user to say "I've filled"; ④**Foreground per-item display**: each apply outputs real-time `[apply seq/total] role@company (location)|status: reason`, and writes `liepin_wizard_progress.jsonl` progress file, user can "check progress" anytime; ⑤**Job title merges role+level**: wizard removed the separate "position level" field, changed to "job title (e.g. HR Director, Finance Manager, Procurement Supervisor, IT Specialist)" combined; ⑥**Filter method fix**: location supports multi-city OR, industry multi-keyword OR, salary-parse-fail lets pass without false kill, after filter announces "X matching roles found, starting delivery now". |
| **v2.0.0** | 2026-07-17 | **Underlying architecture rewrite (based on official liepin-cli)**: ① delivery pipeline `apply_pipeline.js` underlying changed from directly calling `https://open-agent.liepin.com/mcp/user` JSON-RPC to calling official open-source `liepin-cli` (`job search` / `job apply --output json`); ② Token source corrected to `LIEPIN_USER_TOKEN` env or `~/.config/liepin-cli/config.json` (dropped old `LIEPIN_TOKEN`+`x-user-token` header wrong approach); ③ added `adaptCliResult()` adapter layer to adapt CLI's raw JSON echo into the old `result.content[0].text` shape, keeping `npm test` 57 unit tests intact; ④ response fields multi-candidate tolerant parse (`data.list`/`list`/`jobs`/Array) + field-alias normalization (jobId/id, jobName/title etc.); ⑤ first real call dumps `liepin_schema_probe_*.json` probe for manual field-name verification (marked [needs verification]); ⑥ `selfcheck.js` changed to probe liepin-cli availability first then report token/config. |
| **v1.3.0** | 2026-07-17 | **Quality gate and doc spec dual uplift**: ① added `tests/` (6 files 40 unit tests, covering salary parse / four-state judgment / rate-limit detect / recruiter detect / de-dup / quota), `npm test` one-click gate; ② `apply_pipeline.js` extracted 6 pure-function exports (with optional workdir param) for unit testing; ③ added `scripts/selfcheck.js` pre-run self-check; ④ added `references/token_setup.md` token illustrated guide (lower barrier); ⑤ added glossary / quick lookup / this changelog; ⑥ fixed `evalResult` missing English `success` mis-judgment, `isRecruiterJob` company name containing "labor dispatch / HR" mis-judgment two boundary cases; ⑦ revised FAQ Q33 and unattended-mode wording consistency. |
| **v1.4.0** | 2026-07-18 | **Fix three real-use UX incidents (found by user testing)**: ① wizard doesn't auto-pop → added "trigger auto-launches wizard + proactively pops preview panel" hard rule, and "preference memory and proactive reuse" protocol (check history config → proactively show last preference → ask reuse); ② keywords merged into one string → wizard keyword box supports comma/ideographic-comma/space split into independent keywords, both submit and `apply_pipeline.js` do defensive split; ③ location "All" treated as a real place name causing 0 results → both wizard and `apply_pipeline.js` normalize "All"/blank to `__ALL__` (same for industry/level). Added `tests/test_normalize.js` (17 normalization unit tests), package unit tests up to 57 all pass. |
| v1.2.0 | 2026-07-16 | Restored public display name; added real "schedulable unattended" capability (wizard step 7 + setup_automation.js + Chapter 9); config example added `unattended`/`schedule`. |
| v1.1.2 | 2026-07-15 | Full quantified trigger lexicon (50+ phrasings); boundary scenarios expanded to 15 rows; capability mapping 6.1; innovations 6.2; stability guardrail dedicated chapter 8.1; anti-pattern FAQ expanded to 45 items. |
| v1.1.1 | 2026-07-14 | Wizard form de-HR-specific (generic level + 20+ industry multi-select); keywords no longer pre-filled example. |
| v1.1.0 | 2026-07-13 | Fixed publish package missing slug/displayName; added FAQ/examples/errors three references; added stability guardrail (45min cap + consecutive-failure circuit break); added package.json + config example. |
