// scripts/selfcheck.js  (v2.2.0)
// 运行前自检：Node 版本 / liepin-cli 可用性（自动安装支持）/ Token / 配置合法性 / 脚本存在 / 工作区可写
// 零外部依赖，失败时返回非 0。
//
// --auto-install : 如 liepin-cli 未安装则自动安装到受管 Python venv
// --install-only : 仅安装 liepin-cli 后退出（给一键初始化脚本调用）
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const WORKDIR = process.cwd();
const AUTO_INSTALL = process.argv.includes('--auto-install') || process.argv.includes('--install-only');
const INSTALL_ONLY = process.argv.includes('--install-only');
const checks = [];
function check(name, fn) {
  try {
    const ok = fn();
    checks.push({ name, ok, msg: ok ? '通过' : '未通过' });
    return ok;
  } catch (e) {
    checks.push({ name, ok: false, msg: `异常：${e.message}` });
    return false;
  }
}

// ----- 自动安装 liepin-cli 到受管 Python venv -----
const MANAGED_PY = 'C:\\Users\\hu_ji\\.workbuddy\\binaries\\python\\versions\\3.13.12\\python.exe';
const VENV_DIR = path.join(os.homedir(), '.workbuddy', 'binaries', 'python', 'envs', 'liepin-cli');
const BIN_DIR = process.platform === 'win32' ? path.join(VENV_DIR, 'Scripts') : path.join(VENV_DIR, 'bin');
const CLI_EXE = path.join(BIN_DIR, process.platform === 'win32' ? 'liepin-cli.exe' : 'liepin-cli');

function isCliInstalled() {
  try {
    const r = spawnSync(CLI_EXE, ['--help'], { windowsHide: true, timeout: 5000 });
    return r.status === 0 || r.status === null;
  } catch (e) { return false; }
}

function installLiepinCli() {
  if (isCliInstalled()) {
    console.log('[安装] liepin-cli 已在 ' + CLI_EXE + '，跳过安装');
    return true;
  }
  console.log('[安装] liepin-cli 未安装，开始自动安装到受管 Python venv…');
  // 1. 确保受管 Python 存在
  if (!fs.existsSync(MANAGED_PY)) {
    console.error('[安装] 受管 Python 不存在：' + MANAGED_PY + '，请在 WorkBuddy 中配置 Python 环境');
    // 尝试系统 python
    const sysPy = spawnSync('python', ['--version'], { windowsHide: true, timeout: 5000 });
    if (sysPy.status !== 0) {
      console.error('[安装] 系统中也未找到 python，请先安装 Python 3.11+');
      return false;
    }
    console.log('[安装] 使用系统 python 作为备选');
  }
  const python = fs.existsSync(MANAGED_PY) ? MANAGED_PY : 'python';

  // 2. 创建/复用 venv
  if (!fs.existsSync(path.join(VENV_DIR, 'pyvenv.cfg'))) {
    console.log('[安装] 创建 venv 到 ' + VENV_DIR + '…');
    const r = spawnSync(python, ['-m', 'venv', VENV_DIR], { windowsHide: true, timeout: 30000 });
    if (r.status !== 0) {
      console.error('[安装] venv 创建失败：' + (r.stderr + '').slice(0, 200));
      return false;
    }
  }

  // 3. pip install liepin-cli
  const pip = path.join(BIN_DIR, 'pip');
  console.log('[安装] pip install liepin-cli…（可能需要 1~2 分钟）');
  const r = spawnSync(pip, ['install', 'liepin-cli'], { windowsHide: true, timeout: 120000 });
  if (r.status !== 0) {
    const err = (r.stderr + '').slice(0, 300);
    console.error('[安装] pip install liepin-cli 失败：' + err);
    // 尝试从源码安装
    console.log('[安装] 尝试从源码安装…');
    const r2 = spawnSync(pip, ['install', 'git+https://github.com/liepin-tech-2026/liepin-cli.git'], { windowsHide: true, timeout: 120000 });
    if (r2.status !== 0) {
      console.error('[安装] 源码安装也失败：' + (r2.stderr + '').slice(0, 300));
      return false;
    }
  }

  // 4. 验证安装
  if (!isCliInstalled()) {
    console.error('[安装] 安装完成但 CLI 不可用（文件未找到）');
    return false;
  }

  // 5. 尝试加入用户 PATH（非必须，靠 LIEPIN_CLI_BIN 兜底）
  // 设置 LIEPIN_CLI_BIN 环境变量确保脚本能找到
  process.env.LIEPIN_CLI_BIN = CLI_EXE;
  console.log('[安装] ✅ liepin-cli 安装成功：' + CLI_EXE);
  console.log('[安装] 已将 LIEPIN_CLI_BIN 设为此路径，脚本可直接使用');
  return true;
}

// 探测 liepin-cli 是否可用：依次尝试 PATH / LIEPIN_CLI_BIN / 已知 venv 路径
function cliUsable() {
  const cands = [];
  if (process.env.LIEPIN_CLI_BIN) cands.push(process.env.LIEPIN_CLI_BIN);
  cands.push('liepin-cli');
  cands.push(CLI_EXE);
  for (const c of cands) {
    try {
      const r = spawnSync(c, ['--help'], { windowsHide: true, timeout: 5000 });
      if (r.status === 0 || r.status === null) return true;
    } catch (e) { /* 尝试下一个 */ }
  }
  return false;
}

// ----- Token 来源检测 -----
function tokenAvailable() {
  if (process.env.LIEPIN_USER_TOKEN && process.env.LIEPIN_USER_TOKEN.trim()) return { ok: true, src: '环境变量 LIEPIN_USER_TOKEN' };
  if (process.env.LIEPIN_TOKEN && process.env.LIEPIN_TOKEN.trim()) return { ok: true, src: '环境变量 LIEPIN_TOKEN（已兼容，建议改 LIEPIN_USER_TOKEN）' };
  try {
    const cfgPath = path.join(os.homedir(), '.config', 'liepin-cli', 'config.json');
    if (fs.existsSync(cfgPath)) {
      const d = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (d.token && String(d.token).trim()) return { ok: true, src: '配置文件 ~/.config/liepin-cli/config.json' };
    }
  } catch (e) {}
  return { ok: false, src: '' };
}

// ----- 自动安装流程（如有 --auto-install 或 --install-only）-----
if (AUTO_INSTALL) {
  const installed = installLiepinCli();
  if (!installed) {
    console.error('[安装] ❌ 自动安装失败，请手动安装后重试');
    console.error('[安装] 手动安装：pip install liepin-cli');
    process.exit(1);
  }
  console.log('[安装] ✅ liepin-cli 已就绪');
}
if (INSTALL_ONLY) {
  process.exit(0);
}

// ----- 运行检查 -----
const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
check('Node 版本 >= 18', () => nodeMajor >= 18);

const cliOk = check('liepin-cli 已安装且可用', () => cliUsable());
if (!cliOk) {
  checks.push({ name: '→ 自动安装指引', ok: true, msg: '运行此脚本加 --auto-install 即可自动安装；或手动 pip install liepin-cli' });
}

const tok = tokenAvailable();
const tokOk = check('Token 已就绪（LIEPIN_USER_TOKEN 或配置文件）', () => tok.ok);
if (!tokOk) {
  checks.push({ name: '→ 获取 Token', ok: true, msg: '请通过 https://www.liepin.com/mcp/auth 获取 x-user-token 并设为 LIEPIN_USER_TOKEN 环境变量' });
}

check('配置文件 liepin_wizard_config.json 存在', () => fs.existsSync(path.join(WORKDIR, 'liepin_wizard_config.json')));

let cfg = null;
try {
  cfg = JSON.parse(fs.readFileSync(path.join(WORKDIR, 'liepin_wizard_config.json'), 'utf8'));
} catch (e) { cfg = null; }

check('配置文件可解析为 JSON', () => cfg !== null);
check('配置含 keywords 数组', () => cfg && Array.isArray(cfg.keywords) && cfg.keywords.length > 0);
check('recruitmentType 合法', () => cfg && ['nonRecruiter', 'recruiter', 'all'].includes(cfg.recruitmentType));
check('dailyCap 在 1~999 之间', () => cfg && cfg.dailyCap >= 1 && cfg.dailyCap <= 999);

check('投递管道脚本存在', () => fs.existsSync(path.join(WORKDIR, 'scripts', 'apply_pipeline.js')));
check('向导脚本存在', () => fs.existsSync(path.join(WORKDIR, 'scripts', 'wizard.js')));
check('工作区可写', () => {
  const probe = path.join(WORKDIR, `.selfcheck_probe_${Date.now()}`);
  try { fs.writeFileSync(probe, 'ok'); fs.rmSync(probe); return true; } catch (e) { return false; }
});

let allOk = true;
console.log('==================================================');
console.log(' 🔍 猎聘投递技能·安装环境自检报告（v3.0.0）');
console.log('==================================================');
for (const c of checks) {
  console.log(`${c.ok ? '✅' : '❌'} ${c.name}：${c.msg}`);
  if (!c.ok && !c.name.startsWith('→')) allOk = false;
}
console.log('==================================================');

if (!allOk) {
  console.log('');
  console.log('⚠️  部分检查未通过，但已尽量自动修复。');
  console.log('   - liepin-cli：' + (cliOk ? '✅ 已就绪' : '❌ 安装失败，请手动运行 pip install liepin-cli'));
  console.log('   - Token：' + (tokOk ? '✅ 已就绪' : '❌ 未设置，请通过 https://www.liepin.com/mcp/auth 获取'));
  console.log('   - 配置：' + (fs.existsSync(path.join(WORKDIR, 'liepin_wizard_config.json')) ? '✅ 已就绪' : '⏳ 将通过向导填写'));
  console.log('');
  process.exit(1);
}
console.log('✅ 所有检查通过，可以开始投递。');
console.log('==================================================');
