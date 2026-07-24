<div align="center">
  <img src="banner.svg" alt="猎聘自动投递向导横幅" width="100%" />
  <h1>猎聘自动投递向导</h1>
  <p><b>全自动化、防限流的简历投递</b> —— 跑在猎聘（Liepin）平台上。</p>
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
  <img src="https://img.shields.io/badge/平台-猎聘-0ea5e9?style=flat-square" alt="Liepin">
  <img src="https://img.shields.io/badge/防限流-是-22c55e?style=flat-square" alt="Rate-limit safe">
  <img src="https://img.shields.io/github/languages/top/FrankHu-HK/liepin-auto-apply-wizard?style=flat-square" alt="Language">
</p>

<p align="center">
  [简体中文] | <a href="README.md">English</a>
</p>

---

## 猎聘自动投递向导是什么？

一个 **Web 向导式技能**，在 **猎聘（Liepin）** —— 中国中高端招聘平台 —— 上自动投递简历。一次性收集求职条件，随后自动搜索、筛选、去重、防限流并投递，实时展示结果。支持 **定时/无人值守** 运行。

> 🛡️ 由 22 年 HR 老兵、10 万+ 用户体验打磨。设计上尊重平台限流 —— 保护你的账号，不刷屏。

## 为什么选它？

### 痛点

- 手动投几十个猎聘岗位，繁琐且易错。
- 手动批量投，容易重复投递同一岗位或触发限流。
- 你想要广度，又不想把"投递"按钮点 50 次。

### 核心思路：一次收集，安全投递

Web 向导收集条件；随后 Agent 跑一条自动化、**防限流**的投递循环，永久去重，并给出清晰的四态结果日志。

## 核心特性

1. **Web 向导** —— 弹出预览面板（非对话框弹窗），一次填好条件。
2. **提交即自动投递、全程无干预** —— 前台运行并自动投递（限流/中断除外）。
3. **岗位名称 = 岗位 + 职级** —— 合并填写，匹配更准。
4. **招聘类型筛选** —— 全职 / 合同等。
5. **跨会话永久去重** —— 绝不重复投递同一岗位。
6. **限流护栏 + 自动恢复** —— 控制节奏，安全续跑。
7. **每日配额上限** —— 设每日上限。
8. **真实四态结果** —— 已投 / 跳过 / 限流 / 失败，逐条实时展示。
9. **中断主动告知** —— 一旦停下立即告诉你；全程稳定护栏。
10. **定时自动化** —— 可设无人值守定时运行。

## 快速开始

这是一个 **AI Agent 技能**（运行于 WorkBuddy 平台），依赖 `liepin-cli` + `node`。

```
1. 在 WorkBuddy 加载技能，说"帮我在猎聘投简历"。
2. 向导面板打开 —— 填写：岗位（+职级）、行业、城市、薪资、类型、每日上限、是否无人值守？
3. 提交。Agent 自动安装/委派并开始投递；实时看结果，或随时"查进度"。
```

## 开发

`scripts/` 含投递管线、向导 UI 与自检；`tests/` 含单元测试。提交 PR 前运行 `node scripts/selfcheck.js`（见 [CONTRIBUTING.md](CONTRIBUTING.md)）。贡献中 **不得关闭限流护栏**。

## 路线图

见 [ROADMAP.md](ROADMAP.md)。

## 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。筛选 / 配额 / 限流逻辑的测试覆盖尤其有价值。

<a href="https://github.com/FrankHu-HK/liepin-auto-apply-wizard/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=FrankHu-HK/liepin-auto-apply-wizard" />
</a>

## 💖 赞助

如果向导让你睡着也能拿到面试，欢迎赞助其开发。赞助让它保持 **免费、防限流**。

[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-brightgreen)](https://github.com/sponsors/FrankHu-HK)

## 许可证

[MIT](LICENSE) — Copyright 2026 Frank Hu（胡景堃）。
