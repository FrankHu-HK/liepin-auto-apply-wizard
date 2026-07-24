// scripts/selfcheck.js  (v2.2.0)
// Pre-run self-check: Node version / liepin-cli availability (auto-install supported) / Token / config validity / script existence / workspace writable
// Zero external deps, returns non-zero on failure.
//
// --auto-install : if liepin-cli not installed, auto-install into managed Python venv
// --install-only : only install liepin-cli then exit (called by one-click init script)
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
    checks.push({ name, ok, msg: ok ? 'Pass' : 'Fail' });
    return ok;
  } catch (e) {
    checks.push({ name, ok: false, msg: `Exception: ${e.message}` });
    return false;
  }
}

// ----- Auto-install liepin-cli into managed Python venv -----
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
    console.log('[install] liepin-cli already at ' + CLI_EXE + ', skip install');
    return true;
  }
  console.log('[install] liepin-cli not installed, start auto-install into managed Python venv…');
  // 1. Ensure managed Python exists
  if (!fs.existsSync(MANAGED_PY)) {
    console.error('[install] managed Python not found: ' + MANAGED_PY + ', please configure Python env in WorkBuddy');
    // Try system python
    const sysPy = spawnSync('python', ['--version'], { windowsHide: true, timeout: 5000 });
    if (sysPy.status !== 0) {
      console.error('[install] python not found in system either, please install Python 3.11+');
      return false;
    }
    console.log('[install] using system python as fallback');
  }
  const python = fs.existsSync(MANAGED_PY) ? MANAGED_PY : 'python';

  // 2. Create/reuse venv
  if (!fs.existsSync(path.join(VENV_DIR, 'pyvenv.cfg'))) {
    console.log('[install] creating venv at ' + VENV_DIR + '…');
    const r = spawnSync(python, ['-m', 'venv', VENV_DIR], { windowsHide: true, timeout: 30000 });
    if (r.status !== 0) {
      console.error('[install] venv creation failed: ' + (r.stderr + '').slice(0, 200));
      return false;
    }
  }

  // 3. pip install liepin-cli
  const pip = path.join(BIN_DIR, 'pip');
  console.log('[install] pip install liepin-cli… (may take 1~2 min)');
  const r = spawnSync(pip, ['install', 'liepin-cli'], { windowsHide: true, timeout: 120000 });
  if (r.status !== 0) {
    const err = (r.stderr + '').slice(0, 300);
    console.error('[install] pip install liepin-cli failed: ' + err);
    // Try install from source
    console.log('[install] trying install from source…');
    const r2 = spawnSync(pip, ['install', 'git+https://github.com/liepin-tech-2026/liepin-cli.git'], { windowsHide: true, timeout: 120000 });
    if (r2.status !== 0) {
      console.error('[install] source install also failed: ' + (r2.stderr + '').slice(0, 300));
      return false;
    }
  }

  // 4. Verify install
  if (!isCliInstalled()) {
    console.error('[install] install completed but CLI unavailable (file not found)');
    return false;
  }

  // 5. Try adding to user PATH (optional, LIEPIN_CLI_BIN is the fallback)
  // Set LIEPIN_CLI_BIN env so scripts can find it
  process.env.LIEPIN_CLI_BIN = CLI_EXE;
  console.log('[install] ✅ liepin-cli installed successfully: ' + CLI_EXE);
  console.log('[install] set LIEPIN_CLI_BIN to this path, scripts can use it directly');
  return true;
}

// Probe liepin-cli usability: try PATH / LIEPIN_CLI_BIN / known venv path in order
function cliUsable() {
  const cands = [];
  if (process.env.LIEPIN_CLI_BIN) cands.push(process.env.LIEPIN_CLI_BIN);
  cands.push('liepin-cli');
  cands.push(CLI_EXE);
  for (const c of cands) {
    try {
      const r = spawnSync(c, ['--help'], { windowsHide: true, timeout: 5000 });
      if (r.status === 0 || r.status === null) return true;
    } catch (e) { /* try next */ }
  }
  return false;
}

// ----- Token source detection -----
function tokenAvailable() {
  if (process.env.LIEPIN_USER_TOKEN && process.env.LIEPIN_USER_TOKEN.trim()) return { ok: true, src: 'env LIEPIN_USER_TOKEN' };
  if (process.env.LIEPIN_TOKEN && process.env.LIEPIN_TOKEN.trim()) return { ok: true, src: 'env LIEPIN_TOKEN (compatible, recommend switching to LIEPIN_USER_TOKEN)' };
  try {
    const cfgPath = path.join(os.homedir(), '.config', 'liepin-cli', 'config.json');
    if (fs.existsSync(cfgPath)) {
      const d = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (d.token && String(d.token).trim()) return { ok: true, src: 'config file ~/.config/liepin-cli/config.json' };
    }
  } catch (e) {}
  return { ok: false, src: '' };
}

// ----- Auto-install flow (if --auto-install or --install-only) -----
if (AUTO_INSTALL) {
  const installed = installLiepinCli();
  if (!installed) {
    console.error('[install] ❌ auto-install failed, please install manually then retry');
    console.error('[install] manual install: pip install liepin-cli');
    process.exit(1);
  }
  console.log('[install] ✅ liepin-cli ready');
}
if (INSTALL_ONLY) {
  process.exit(0);
}

// ----- Run checks -----
const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
check('Node version >= 18', () => nodeMajor >= 18);

const cliOk = check('liepin-cli installed and usable', () => cliUsable());
if (!cliOk) {
  checks.push({ name: '→ auto-install guide', ok: true, msg: 'run this script with --auto-install to auto-install; or manually pip install liepin-cli' });
}

const tok = tokenAvailable();
const tokOk = check('Token ready (LIEPIN_USER_TOKEN or config file)', () => tok.ok);
if (!tokOk) {
  checks.push({ name: '→ get Token', ok: true, msg: 'please get x-user-token from https://www.liepin.com/mcp/auth and set it as LIEPIN_USER_TOKEN env' });
}

check('config file liepin_wizard_config.json exists', () => fs.existsSync(path.join(WORKDIR, 'liepin_wizard_config.json')));

let cfg = null;
try {
  cfg = JSON.parse(fs.readFileSync(path.join(WORKDIR, 'liepin_wizard_config.json'), 'utf8'));
} catch (e) { cfg = null; }

check('config parseable as JSON', () => cfg !== null);
check('config has keywords array', () => cfg && Array.isArray(cfg.keywords) && cfg.keywords.length > 0);
check('recruitmentType valid', () => cfg && ['nonRecruiter', 'recruiter', 'all'].includes(cfg.recruitmentType));
check('dailyCap between 1~999', () => cfg && cfg.dailyCap >= 1 && cfg.dailyCap <= 999);

check('delivery pipeline script exists', () => fs.existsSync(path.join(WORKDIR, 'scripts', 'apply_pipeline.js')));
check('wizard script exists', () => fs.existsSync(path.join(WORKDIR, 'scripts', 'wizard.js')));
check('workspace writable', () => {
  const probe = path.join(WORKDIR, `.selfcheck_probe_${Date.now()}`);
  try { fs.writeFileSync(probe, 'ok'); fs.rmSync(probe); return true; } catch (e) { return false; }
});

let allOk = true;
console.log('==================================================');
console.log(' 🔍 Liepin Delivery Skill · Install/Env Self-Check Report (v3.0.0)');
console.log('==================================================');
for (const c of checks) {
  console.log(`${c.ok ? '✅' : '❌'} ${c.name}: ${c.msg}`);
  if (!c.ok && !c.name.startsWith('→')) allOk = false;
}
console.log('==================================================');

if (!allOk) {
  console.log('');
  console.log('⚠️  Some checks failed, but auto-fix was attempted where possible.');
  console.log('   - liepin-cli: ' + (cliOk ? '✅ ready' : '❌ install failed, please run pip install liepin-cli manually'));
  console.log('   - Token: ' + (tokOk ? '✅ ready' : '❌ not set, please get from https://www.liepin.com/mcp/auth'));
  console.log('   - Config: ' + (fs.existsSync(path.join(WORKDIR, 'liepin_wizard_config.json')) ? '✅ ready' : '⏳ will be filled via wizard'));
  console.log('');
  process.exit(1);
}
console.log('✅ All checks passed, you can start delivery.');
console.log('==================================================');
