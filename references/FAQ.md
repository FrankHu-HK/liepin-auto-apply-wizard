# Liepin Fully-Automated Delivery Wizard · FAQ (51 items)

> Covers high-frequency questions and boundary scenarios. When unsure, check this table first; if still unsure, handle by the corresponding error code in errors.md or go back to Stage 0 to re-fetch Token.

## 1. Preparation and Token

**Q1: What environment do the scripts need?**
A: Node.js 18+. The WorkBuddy managed runtime includes it, no extra install; on a normal PC with Node you can also directly run `node scripts/apply_pipeline.js`.

**Q2: What is x-user-token and where does it come from?**
A: After logging in to https://www.liepin.com/mcp/server and clicking "Generate credentials", you get a JWT string (starts with `eyJ`). It is the auth token for Liepin OpenAPI, passed inline in a single command via env `LIEPIN_TOKEN`.

**Q3: How long is the Token valid?**
A: Nominal 90 days, but high-frequency bulk requests may trigger early server revocation. If delivery returns 401, go back to Stage 0 and regenerate one.

**Q4: Why does search work but apply returns 401?**
A: Liepin may separate authorization for search-job and apply-job. When generating credentials confirm apply permission is checked; first-item pre-check failure aborts and prompts regeneration.

**Q5: Will the Token be saved?**
A: No. Only inline for this command (`$env:LIEPIN_TOKEN=...`), not persisted, not memorized, not logged.

**Q6: Can I use it without a Liepin account?**
A: No. This skill only connects to your own Liepin account; it cannot register on your behalf or bypass auth.

## 2. Config and Wizard

**Q7: What if the web wizard page won't open?**
A: Auto-degrades to AskUserQuestion step-by-step collection (still includes "recruitment type"); functionality unaffected.

**Q8: Do I have to fill all config items?**
A: All have defaults. Leave defaults if unsure: keyword defaults to HR direction, industry/location "All", salary floor 25K, daily cap 50.

**Q9: How to choose among the three recruitmentType values?**
A: `nonRecruiter` keeps only enterprise direct hiring (recommended, highest response rate); `recruiter` keeps only recruiter / HR-service-firm roles; `all` keeps both but prioritizes non-recruiters.

**Q10: What unit are salaryFloor/ceil?**
A: K/month. Floor 0 means no limit; ceiling 999 means no limit. The script multiplies by 1000 to convert to yuan for the API and re-validates.

**Q11: Can I apply to multiple keywords at once?**
A: Yes. In the wizard separate multiple directions by comma; the script searches each keyword across pages then merges and de-dups.

**Q12: If location is "All", does it apply nationwide?**
A: Yes. In the wizard set location to "All" or leave blank; on submit the script auto-normalizes to `__ALL__` (nationwide); `apply_pipeline.js` also defensively normalizes ("All"/blank all treated as `__ALL__`), **never treated as a real place name for filtering**. Fill a specific city (e.g. "Shenzhen") to keep only that city's roles.

**Q51: I filled several roles like "HR, Admin, HRBP, Org Development" — how will it search?**
A: The wizard splits comma/ideographic-comma/space separated directions into **independent keywords** and searches each then merges de-dup; it won't treat the whole string as one phrase (this was a bug before v1.4.0, now fixed). Suggest separating multiple directions with comma or ideographic comma.

## 3. Filtering and De-duplication

**Q13: Is recruiter detection accurate?**
A: Heuristic — industry contains "HR service / labor dispatch / outsourcing / recruiter / consulting", company hits the recruiter brand library (Career International / ManpowerGroup / RyanTech etc.), or JD contains "recruiter / proxy-hire" any one → flagged. Not 100% precise, hence the "both" option as fallback.

**Q14: How does cross-session de-dup work?**
A: Reads all historical reports in the workspace (`liepin_wizard_report.json` etc.) and merges the applied jobId set; this run auto-skips, never re-pestering the same HR.

**Q15: First run in a fresh env, will it re-apply?**
A: No. With no history it starts from an empty set, but this run's applied jobs are recorded, rerun won't repeat.

**Q16: Why do some searched roles show very low salary?**
A: Liepin server doesn't hard-filter salary; the script does client-side re-validation (floor/ceiling), dropping those that don't qualify.

**Q17: Function drift (e.g. searched out Finance COE)?**
A: Use more precise keywords (e.g. "compensation" "performance" "HR"), or narrow by level filter.

## 4. Rate-limit and Quota

**Q18: What is 429 rate-limit?**
A: Overly frequent requests throttled by server (HTTP still 200, but response says "too frequent"). The built-in `isRateLimit()` detects and retries with exponential backoff (15→240s).

**Q19: Will rate-limit get stuck forever?**
A: Cumulative backoff over 30 minutes is judged "persistent rate-limit", auto-pauses (exit code 3); de-dup guarantees safe resume later.

**Q20: What is the daily cap for?**
A: Protects the account from risk control. Stops at `dailyCap`, rest left for tomorrow; calendar-day 0:00 resets the counter.

**Q21: Applied 30 today, cap 50, can I apply more?**
A: Yes. The log shows "Applied 30 today / cap 50, max applicable this run 20".

**Q22: Can I set the cap very high to finish fast?**
A: Not recommended. Too high easily trips risk control or even ban; default 30~50 is the safe range.

## 5. Results and Failures

**Q23: What do the four-state results mean?**
A: `success` applied / `already` already applied (skipped) / `fail` failed (with reason) / `unknown` unknown (needs manual check). Never treat fail/unknown as success.

**Q24: What are common failure reasons?**
A: Daily cap reached, position closed, account rate-limited, token invalid (401), API anomaly, etc.; each failure lists the specific reason.

**Q25: Why does it show "Unknown"?**
A: The API returned undeterminable success/failure (e.g. empty return, non-standard text); you need to verify manually in the Liepin App, never faked.

**Q26: Where do I see the results?**
A: Generates `liepin_wizard_summary.md` (human-readable, with success/fail+reason list) and `liepin_wizard_report.json` (machine-readable).

## 6. Interruption and Resume

**Q27: I pressed Ctrl+C halfway, what happens?**
A: Catches SIGINT/SIGTERM, writes partial report and exits 130, progress not lost; rerun auto-skips applied and resumes rest.

**Q28: After a break, will rerun re-apply?**
A: No. Applied jobIds are recorded; de-dup guarantees no repeat.

**Q29: Will it auto-stop if running over 45 minutes?**
A: Yes (global runtime guardrail). Safe stop and persist, exit code 0, rerun resumes.

**Q30: Will consecutive failures trigger circuit break?**
A: Yes. 3 consecutive non-rate-limit hard failures (e.g. token invalid) circuit-break stop (exit code 3), avoiding wasted effort and account risk.

## 7. Privacy and Security

**Q31: Does the skill collect my personal info?**
A: No. The skill package and reports only contain role data (company / role / salary / location), no name / phone / email / account.

**Q32: How is it different from brute-force mass-apply tools?**
A: This skill obeys Liepin rate limits, has built-in daily cap and rate-limit guard, explicitly "no brute-force mass-apply bypassing rate limits", protecting account health.

## 8. Anti-patterns and Common Misuse (must-read, don't use this way)

**Q33: Can it apply fully automatically without a confirmation popup?**
A: Two cases, **both need no manual confirmation**. **Manual mode (default)**: after submit auto-applies, the system broadcasts the daily cap and applied-today in the log, no waiting for user confirmation. **Unattended mode**: if you explicitly enable "Unattended" at wizard step 6 and authorize periodic automation, it delivers on schedule, zero touch (see Q41). Both need no manual confirmation and are still guarded by dailyCap / rate-limit / circuit-break, never unbounded mass-apply.

**Q34: Can I bypass rate-limit to finish fast?**
A: No. The rate-limit guard is the core mechanism protecting the account from ban; bypassing is suicidal mass-apply, explicitly not done by this skill.

**Q35: Can I set the daily cap to 500?**
A: Can set but not recommended. Beyond the safe range (30~50) easily trips risk control or even ban; default 30~50 is the empirical safe value.

**Q36: Can it apply to BOSS / Zhaopin / 51job?**
A: No. This skill only connects to Liepin OpenAPI; other platforms are handled by their own skills, don't mix.

**Q37: Can it rewrite my resume / fake experience?**
A: No. No fabrication or tampering with resume content or delivery info.

**Q38: Can it apply with multiple accounts at once?**
A: No. Only your own single token single account; no matrix / side-account bulk.

**Q39: Can it apply to overseas roles?**
A: No. Only domestic Liepin OpenAPI; overseas / HK-Macau-Taiwan out of scope.

**Q40: Will it fake success if delivery fails?**
A: Never. Four-state results shown truthfully; unknown is labeled unknown, never treat fail/unknown as success.

**Q41: Can it run unattended on a schedule daily?**
A: Yes. At wizard step 6 choose "Enable unattended" and pick a frequency → agent runs `node scripts/setup_automation.js` to generate spec → register periodic automation via `automation_update`. Then delivers on schedule, **zero touch, skips daily confirmation**, but still guarded by dailyCap / rate-limit / circuit-break; missing token only text-reports, no unauthorized action.

**Q42: Is it a bug when no roles are found?**
A: Mostly keywords / industry too narrow or recruiter filter too strict; relax criteria; not a script fault. Try "both / all" first.

**Q43: Can it apply only to "urgent / high-paying"?**
A: Approximate with "salary floor + keyword" combination; Liepin has no dedicated "urgent" tag, narrow by salary + keyword.

**Q44: Can it run on mobile?**
A: Needs Node 18+ runtime; mobile generally can't; run on desktop / server.

**Q45: Can it negotiate salary / communicate with recruiters for me?**
A: No. This skill only does the "apply" action; follow-up communication is done by you.

## 9. Ambiguity Resolution (judgment priority and heuristic boundaries)

> Many judgments here are **heuristic + priority rules**, not 100% precise. Below explains "how to judge when unsure" to avoid misuse.

**Q46: API returned non-standard text, can't tell success/failure — what is it?**
A: Always judged as `unknown` (unknown), **never fake success**. Typical triggers: empty return, non-JSON, can't match any keyword. Unknown roles listed separately in the result summary with "needs manual verification in Liepin App". Four-state priority see Q50.

**Q47: Recruiter detection mis-judged (flagged direct as recruiter / missed a real recruiter)?**
A: Recruiter detection is **heuristic** (industry keyword + company brand library + JD keyword), not 100% precise. Two fallbacks: ① choose `recruitmentType=all` (both, non-recruiter priority), not relying on detection; ② if you want to avoid recruiters but fear misses, use `nonRecruiter` + manually spot-check roles flagged nonRecruiter in the summary. Detection rules see Q13.

**Q48: Salary written in all sorts of ways ("20-35K·14 months" "negotiable" "20-30k") — how is it parsed?**
A: `parseSalary()` rules: ① contains "negotiable / negotiable / negotiab" → treated as no limit (floor/ceil=null); ② contains "wan" (ten-thousand) → value ×10 converted to K (e.g. "2 wan"=20K); ③ multiple numbers take first as floor, last as ceiling (e.g. "20-35K" → floor=20,ceil=35); ④ client then re-validates with `salaryFloor/salaryCeil` (unit K), dropping those that don't qualify. Salary unit unified as "K/month".

**Q49: What is the basis for "already applied", and why is the same role sometimes not skipped?**
A: Cross-session de-dup uses **jobId** as the unique key. Only when a jobId's status in history is `success` or `already` is it counted into the de-dup set; `fail`/`unknown` are not (allowed to retry). If a role isn't skipped, its jobId isn't in the historical applied set (maybe the role changed, or last time was fail/unknown).

**Q50: What is the priority of four-state judgment?**
A: Strict short-circuit by order (return on hit): ① already applied ("already applied / you have applied") → `already`; ② 401/unauthorized/not authorized, or errCode non-zero → `fail`; ③ contains failure words (failed / cap reached / too frequent / restricted / denied / invalid / error etc.) → `fail`; ④ contains success words (application succeeded / delivery succeeded / success / ok / true / success / delivery complete) → `success`; ⑤ rest → `unknown`. **Failure words take priority over success words**, eliminating the mis-judgment of "contains success text but actually failed".
