<div align="center">
  <img src="banner.svg" alt="Liepin Auto-Apply Wizard banner" width="100%" />
  <h1>Liepin Auto-Apply Wizard</h1>
  <p><b>Fully-automated, rate-limit-safe resume delivery</b> on the Liepin job platform.</p>
</div>

<p align="center">
  <a href="https://github.com/FrankHu-HK/liepin-auto-apply-wizard/stargazers"><img src="https://img.shields.io/github/stars/FrankHu-HK/liepin-auto-apply-wizard?style=flat-square" alt="Stars"></a>
  <a href="https://github.com/FrankHu-HK/liepin-auto-apply-wizard/network/members"><img src="https://img.shields.io/github/forks/FrankHu-HK/liepin-auto-apply-wizard?style=flat-square" alt="Forks"></a>
  <a href="https://github.com/FrankHu-HK/liepin-auto-apply-wizard/issues"><img src="https://img.shields.io/github/issues/FrankHu-HK/liepin-auto-apply-wizard?style=flat-square" alt="Issues"></a>
  <a href="https://github.com/FrankHu-HK/liepin-auto-apply-wizard/blob/master/LICENSE"><img src="https://img.shields.io/github/license/FrankHu-HK/liepin-auto-apply-wizard?style=flat-square" alt="License"></a>
  <a href="https://img.shields.io/github/last-commit/FrankHu-HK/liepin-auto-apply-wizard?style=flat-square"><img src="https://img.shields.io/github/last-commit/FrankHu-HK/liepin-auto-apply-wizard?style=flat-square" alt="Last commit"></a>
  <a href="https://github.com/sponsors/FrankHu-HK"><img src="https://img.shields.io/badge/Sponsor-%E2%9D%A4-brightgreen" alt="Sponsor"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Liepin-0ea5e9?style=flat-square" alt="Liepin">
  <img src="https://img.shields.io/badge/Rate--limit-Safe-22c55e?style=flat-square" alt="Rate-limit safe">
  <img src="https://img.shields.io/github/languages/top/FrankHu-HK/liepin-auto-apply-wizard?style=flat-square" alt="Language">
</p>

<p align="center">
  English
</p>

---

## What is Liepin Auto-Apply Wizard?

A **web-wizard skill** that delivers your resume on **Liepin** — China's premier mid-to-senior job platform — automatically. Collect job criteria once, then it searches, filters, de-duplicates, rate-limit-guards, and applies for you, showing real-time results. Supports **scheduled / unattended** runs.

> 🛡️ Built by a 22-year HR veteran with 100k+ user sessions. Designed to respect platform rate limits — it protects your account, it doesn't spam.

## Why Liepin Auto-Apply Wizard?

### The problem

- Applying to dozens of Liepin roles by hand is tedious and error-prone.
- Manual batch apply risks re-applying to the same post or tripping rate limits.
- You want breadth without babysitting the "apply" button 50 times.

### Core approach: collect once, deliver safely

A web wizard captures your criteria; the agent then runs an automated, **rate-limit-aware** delivery loop with permanent de-duplication and a clear four-state result log.

## Features

1. **Web wizard** — opens a preview panel (not a chat popup); fill criteria once.
2. **Submit → auto-apply, zero touch** — runs in the foreground and applies automatically (except on limit / interruption).
3. **Job title = role + level** — enter the position and seniority together for better matching.
4. **Recruitment-type filter** — full-time / contract / etc.
5. **Cross-session permanent de-duplication** — never re-applies to the same posting.
6. **Rate-limit guard + auto-recovery** — paces delivery and resumes safely.
7. **Daily quota cap** — set a max per day.
8. **Real four-state results** — Applied / Skipped / Limited / Failed, shown per item in real time.
9. **Interruption self-report** — tells you immediately if it stops; stability guardrails throughout.
10. **Scheduled automation** — set it to run unattended on a timer.

## Quick Start

This is an **AI-agent skill** (runs inside the WorkBuddy agent platform) and depends on `liepin-cli` + `node`.

```
1. Load the skill in WorkBuddy and say "help me apply on Liepin".
2. The wizard panel opens — fill: job title (+ level), industry, city, salary, type, daily cap, unattended?
3. Submit. The agent installs/delegates and starts delivering; watch live results, or "check progress" anytime.
```

## Development

`scripts/` holds the apply pipeline, wizard UI, and self-checks; `tests/` holds the unit tests. Run `node scripts/selfcheck.js` before opening a PR (see [CONTRIBUTING.md](CONTRIBUTING.md)). Never disable the rate-limit guard in a contribution.

## Roadmap

See [ROADMAP.md](ROADMAP.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Test coverage for filtering / quota / rate-limit logic is especially valued.

<a href="https://github.com/FrankHu-HK/liepin-auto-apply-wizard/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=FrankHu-HK/liepin-auto-apply-wizard" />
</a>

## 💖 Sponsor

If the wizard lands you interviews while you sleep, consider sponsoring its development. Sponsorship keeps it **free and rate-limit-safe**.

[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-brightgreen)](https://github.com/sponsors/FrankHu-HK)

## License

[MIT](LICENSE) — Copyright 2026 Frank Hu (Hu Jingkun).
