# 🤖 Liepin Auto-Apply Wizard · Fully-Automated Resume Delivery

> A **web-wizard** skill that delivers your resume on **Liepin (猎聘)** — China's premier mid-to-senior job platform — automatically. Collect job criteria once, then it searches, filters, de-duplicates, rate-limit-guards, and applies for you, showing real-time results. Supports **scheduled / unattended** runs.

> 🛡️ Built by a 22-year HR veteran with 100k+ user sessions. Designed to respect platform rate limits — it protects your account, it doesn't spam.

---

## ✨ Why this exists

Applying to dozens of Liepin roles by hand is tedious and error-prone. This wizard turns "I want these kinds of jobs" into "applied, with a clean log" — while staying inside safe pacing so the platform doesn't throttle you.

---

## 🎯 Key Features

1. **Web wizard** — Opens a preview panel (not a chat popup); fill criteria once.
2. **Submit → auto-apply, zero touch** — Runs in the foreground and applies automatically (except on limit / interruption).
3. **Job title = role + level** — Enter the position and seniority together for better matching.
4. **Recruitment-type filter** — Full-time / contract / etc.
5. **Cross-session permanent de-duplication** — Never re-applies to the same posting.
6. **Rate-limit guard + auto-recovery** — Paces delivery and resumes safely.
7. **Daily quota cap** — Set a max per day.
8. **Real four-state results** — Applied / Skipped / Limited / Failed, shown per item in real time.
9. **Interruption self-report** — Tells you immediately if it stops; stability guardrails throughout.
10. **Scheduled automation** — Set it to run unattended on a timer.

---

## 🚀 How to use

This is an **AI-agent skill** (runs inside the WorkBuddy agent platform) and depends on the `liepin-cli` + `node` runtime.

1. Load the skill in WorkBuddy and say *"help me apply on Liepin"*.
2. The wizard panel opens — fill in: job title (+ level), industry, city, salary, recruitment type, daily cap, unattended?.
3. Submit. The agent installs/delegates and starts delivering; watch live results, or *"check progress"* anytime.

> **Requirements:** `liepin-cli`, `node`, and an authenticated Liepin session. The skill handles install automatically.

---

## 🧩 What's inside

| Path | Purpose |
|------|---------|
| `SKILL.md` | Wizard flow + delivery logic + guardrails |
| `scripts/` | Apply / filter / dedupe / rate-limit modules |
| `references/` | Field mapping, quota rules, error handling |
| `README.md` | This document |

---

## 🌍 Who it's for

- **Job seekers** on Liepin who want breadth without the busywork.
- **Career switchers** applying across many similar roles.
- **Anyone** who'd rather review results than click "apply" 50 times.

---

## 💖 Sponsor

If the wizard lands you interviews while you sleep, consider sponsoring its development. Sponsorship keeps it **free and rate-limit-safe**.

[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-brightgreen)](https://github.com/sponsors/FrankHu-HK)

> GitHub Sponsors is the only official donation channel for this project.

---

## 📄 License

Released under the [MIT License](./LICENSE). Authored by 胡景堃 (Frank Hu) — 22-year world-500-firm HRVP.
