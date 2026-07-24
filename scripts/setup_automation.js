// 猎聘自动投递 · 自动化运行设置助手（v1.2.0）
// 零外部依赖：仅 Node 标准库 fs/path
// 作用：读取 liepin_wizard_config.json，当 unattended=true 时，生成一份
//       WorkBuddy 周期性自动化（automation）规格 spec，供 AI 代理用 automation_update 注册，
//       从而实现「全程无需干预」的定时自动投递。
//
// 用法（由 AI 代理执行）：
//   node scripts/setup_automation.js
// 脚本会写出 liepin_automation_spec.json，并打印给代理的注册提示。

'use strict';
const fs = require('fs');
const path = require('path');

const WORKDIR = process.cwd();
const CONFIG_PATH = path.join(WORKDIR, 'liepin_wizard_config.json');
const SPEC_PATH = path.join(WORKDIR, 'liepin_automation_spec.json');

// cron(5段) -> WorkBuddy RRULE(RFC5545) 的尽力映射
function cronToRRule(cron) {
  const p = String(cron || '').trim().split(/\s+/);
  if (p.length !== 5) return null;
  const [min, hour, dom, mon, dow] = p;
  if (hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    // 每 N 小时：0 */6 * * *  -> FREQ=HOURLY;INTERVAL=6
    if (min !== '*' && /^(?:\*\/)?\d+$/.test(min)) {
      const m = min.startsWith('*/') ? min.slice(2) : min;
      return `FREQ=HOURLY;INTERVAL=${m}`;
    }
    return 'FREQ=HOURLY;INTERVAL=6';
  }
  // 每天某时刻：0 9 * * * -> FREQ=DAILY;BYHOUR=9;BYMINUTE=0
  const hh = parseInt(hour, 10);
  const mm = parseInt(min, 10);
  if (!isNaN(hh) && dom === '*' && mon === '*' && dow === '*') {
    return `FREQ=DAILY;BYHOUR=${hh};BYMINUTE=${isNaN(mm) ? 0 : mm}`;
  }
  return null; // 复杂 cron 交给代理手动构造
}

function main() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('缺少 liepin_wizard_config.json（请先完成弹窗向导收集需求）');
    process.exit(3);
  }
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (cfg.unattended !== true) {
    console.log('ℹ️ 当前配置未开启「无人值守」（unattended=false）。');
    console.log('   如需设置自动化运行：回到向导第 7 步选择「开启无人值守」，或把配置里的 unattended 改为 true，再运行本脚本。');
    process.exit(0);
  }

  const cron = cfg.schedule || '0 9 * * *';
  const rrule = cronToRRule(cron) || 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0';
  const cap = cfg.dailyCap && cfg.dailyCap < 999 ? cfg.dailyCap : 50;

  const spec = {
    name: '猎聘自动投递（无人值守）',
    scheduleType: 'recurring',
    rrule: rrule,
    cwds: WORKDIR,
    prompt:
      `读取工作区 liepin_wizard_config.json；若其中 unattended=true 且已配置 Token（LIEPIN_USER_TOKEN 或 ~/.config/liepin-cli/config.json），则直接运行 ` +
      '`node scripts/apply_pipeline.js`（无需弹窗确认，全程无需干预）；' +
      `运行结束后读取 liepin_wizard_summary.md，用一句话向用户汇报本次成功/失败/已投过数量。` +
      `若 Token 缺失或配置不存在，仅文字报告原因，不擅自操作。`,
    note: `本自动化由「猎聘全自动简历投递」技能生成；每日上限 ${cap}，受频控/熔断护栏保护。`,
  };

  fs.writeFileSync(SPEC_PATH, JSON.stringify(spec, null, 2), 'utf8');

  console.log('✅ 已生成自动化规格：' + SPEC_PATH);
  console.log('--- spec ---');
  console.log(JSON.stringify(spec, null, 2));
  console.log('--- 给 AI 代理的注册提示 ---');
  console.log('请用 automation_update（mode=create）注册以上周期自动化：');
  console.log('  name   =', spec.name);
  console.log('  rrule  =', spec.rrule, '(源自配置 schedule:', cron + ')');
  console.log('  cwds   =', spec.cwds);
  console.log('  prompt =', spec.prompt);
}

main();
