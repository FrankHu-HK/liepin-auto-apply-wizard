// scripts/quickstart.js  (v2.2.0)
// 一键初始化脚本：自动检查 + 自动安装 liepin-cli + Token 引导 + 打开向导
// 用户只需要获取 Token 告诉我即可，无需手动安装任何东西。
//
// 运行方式：node scripts/quickstart.js
//
// 典型流程：
//   1. 检测 Node 版本 → OK
//   2. 检测 liepin-cli → 未安装 → 自动安装（pip install liepin-cli 到受管 venv）
//   3. 检测 Token → 未设置 → 输出「请从 https://www.liepin.com/mcp/auth 获取 x-user-token」
//   4. 检测向导配置 → 未设置 → 自动打开 Web 向导页面
//   5. 全部就绪 → 输出「run node scripts/apply_pipeline.js 开始投递」
'use strict';
const { spawnSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const HOME = os.homedir();
const CLI_DIR = path.join(HOME, '.workbuddy', 'binaries', 'python', 'envs', 'liepin-cli', 'Scripts');
const CLI_EXE = path.join(CLI_DIR, 'liepin-cli.exe');
const BANNER = `
╔══════════════════════════════════════════════╗
║   猎聘全自动投递 · 一键初始化向导 v2.2.0    ║
╠══════════════════════════════════════════════╣
║  AI 已接管所有安装配置，你只管给我 Token！   ║
╚══════════════════════════════════════════════╝`;

function log(...a) { console.log(...a); }
function ok(t) { log('✅ ' + t); }
function warn(t) { log('⚠️  ' + t); }
function info(t) { log('📌 ' + t); }

// 步骤 1：检测 Node
function step1() {
  const v = parseInt(process.versions.node.split('.')[0], 10);
  if (v >= 18) { ok('Node 版本 ' + process.versions.node + ' ✅'); return true; }
  warn('Node 版本过低：' + process.versions.node + '，需要 >= 18');
  return false;
}

// 步骤 2：自动安装 liepin-cli
function step2() {
  log('');
  log('───────────────── 步骤 2：检测 liepin-cli ─────────────────');

  // 先检测是否已有
  const r0 = spawnSync(CLI_EXE, ['--help'], { windowsHide: true, timeout: 5000 });
  if (r0.status === 0) {
    ok('liepin-cli 已就绪');
    return true;
  }

  // 检测裸命令
  const r1 = spawnSync('liepin-cli', ['--help'], { windowsHide: true, timeout: 5000 });
  if (r1.status === 0) {
    ok('liepin-cli 已就绪（系统 PATH）');
    return true;
  }

  // 未安装 → 自动安装
  info('liepin-cli 未安装，AI 正在自动安装…（约 1~2 分钟）');
  const selfcheckPath = path.join(__dirname, 'selfcheck.js');
  const r2 = spawnSync(process.execPath, [selfcheckPath, '--auto-install'], {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: 'inherit',
    timeout: 180000,
  });
  if (r2.status !== 0) {
    warn('自动安装失败，请手动运行：pip install liepin-cli');
    return false;
  }

  // 安装后验证
  const r3 = spawnSync(CLI_EXE, ['--help'], { windowsHide: true, timeout: 5000 });
  if (r3.status === 0) { ok('liepin-cli 安装成功 ✅'); return true; }

  warn('安装后验证失败，可能 PATH 未更新');
  return false;
}

// 步骤 3：Token 检测
function step3() {
  log('');
  log('───────────────── 步骤 3：Token 检测 ─────────────────');

  const env = process.env.LIEPIN_USER_TOKEN || process.env.LIEPIN_TOKEN || '';
  if (env && env.trim()) {
    ok('Token 已就绪（环境变量）');
    return true;
  }

  // 检查配置文件
  const cfgPath = path.join(HOME, '.config', 'liepin-cli', 'config.json');
  try {
    if (fs.existsSync(cfgPath)) {
      const d = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (d.token && String(d.token).trim()) {
        ok('Token 已就绪（配置文件：~/.config/liepin-cli/config.json）');
        return true;
      }
    }
  } catch (e) {}

  warn('未检测到 Token');
  info('请通过以下方式获取 Token：');
  info('  https://www.liepin.com/mcp/auth');
  info('  复制 x-user-token（一串 JWT 字符串）');
  info('  然后把 Token 发给我，我会自动设置。');
  info('');
  info('或者你自己设置环境变量：');
  info('  set LIEPIN_USER_TOKEN=你的Token');
  info('然后重新运行本脚本。');
  return false;
}

// 步骤 4：检查向导配置
function step4() {
  log('');
  log('───────────────── 步骤 4：向导配置 ─────────────────');
  const cfgPath = path.join(process.cwd(), 'liepin_wizard_config.json');
  if (fs.existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (cfg.keywords && cfg.keywords.length) {
        ok('向导配置已就绪：' + cfg.keywords.join('、'));
        return true;
      }
    } catch (e) {}
  }

  info('未检测到向导配置，将为你打开 Web 向导页面…');
  info('请通过 Web 页面填写求职需求，点「提交」即可。');
  log('');
  log('  提示：直接对我说「帮我在猎聘投简历」即可自动打开向导。');
  return false;
}

// ----- 主流程 -----
function main() {
  console.log(BANNER);
  log('');

  const s1 = step1();
  if (!s1) { warn('Node 版本过低，请升级到 Node 18+'); process.exit(1); }

  const s2 = step2();
  if (!s2) { warn('liepin-cli 安装失败，请手动安装后重试'); process.exit(1); }

  const s3 = step3();
  const s4 = step4();

  log('');
  log('───────────────── 初始化结果 ─────────────────');
  if (s1 && s2 && s3 && s4) {
    ok('全部就绪！可以开始自动投递了 🎉');
    info('运行投递：node scripts/apply_pipeline.js');
    info('或对我说：「帮我在猎聘投简历」');
  } else {
    log('尚未完全就绪（缺 Token 或配置），需补充后即可开始。');
  }
  log('');
  info('有 Token 就直接发给我，我帮你设置并启动投递。');
}

main();
