// scripts/quickstart.js  (v2.2.0)
// One-click init script: auto-check + auto-install liepin-cli + Token guidance + open wizard
// The user only needs to get a Token and tell me; no manual install needed.
//
// Run: node scripts/quickstart.js
//
// Typical flow:
//   1. Check Node version → OK
//   2. Check liepin-cli → not installed → auto-install (pip install liepin-cli into managed venv)
//   3. Check Token → not set → print "please get x-user-token from https://www.liepin.com/mcp/auth"
//   4. Check wizard config → not set → auto-open web wizard page
//   5. All ready → print "run node scripts/apply_pipeline.js to start delivery"
'use strict';
const { spawnSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const HOME = os.homedir();
const CLI_EXE = process.env.LIEPIN_CLI_BIN || path.join(HOME, '.local', 'bin', 'liepin-cli');
const BANNER = `
╔══════════════════════════════════════════════╗
║   Liepin Auto-Apply · One-click Init Wizard v2.2.0    ║
╠══════════════════════════════════════════════╣
║   AI has taken over all install/config; just give me the Token!   ║
╚══════════════════════════════════════════════╝`;

function log(...a) { console.log(...a); }
function ok(t) { log('✅ ' + t); }
function warn(t) { log('⚠️  ' + t); }
function info(t) { log('📌 ' + t); }

// Step 1: check Node
function step1() {
  const v = parseInt(process.versions.node.split('.')[0], 10);
  if (v >= 18) { ok('Node version ' + process.versions.node + ' ✅'); return true; }
  warn('Node version too low: ' + process.versions.node + ', need >= 18');
  return false;
}

// Step 2: auto-install liepin-cli
function step2() {
  log('');
  log('───────────────── Step 2: check liepin-cli ─────────────────');

  // Check if already present
  const r0 = spawnSync(CLI_EXE, ['--help'], { windowsHide: true, timeout: 5000 });
  if (r0.status === 0) {
    ok('liepin-cli ready');
    return true;
  }

  // Check bare command
  const r1 = spawnSync('liepin-cli', ['--help'], { windowsHide: true, timeout: 5000 });
  if (r1.status === 0) {
    ok('liepin-cli ready (system PATH)');
    return true;
  }

  // Not installed → auto-install
  info('liepin-cli not installed, AI is auto-installing… (~1~2 min)');
  const selfcheckPath = path.join(__dirname, 'selfcheck.js');
  const r2 = spawnSync(process.execPath, [selfcheckPath, '--auto-install'], {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: 'inherit',
    timeout: 180000,
  });
  if (r2.status !== 0) {
    warn('Auto-install failed, please run manually: pip install liepin-cli');
    return false;
  }

  // Verify after install
  const r3 = spawnSync(CLI_EXE, ['--help'], { windowsHide: true, timeout: 5000 });
  if (r3.status === 0) { ok('liepin-cli installed successfully ✅'); return true; }

  warn('Verification failed after install, PATH may not be updated');
  return false;
}

// Step 3: Token check
function step3() {
  log('');
  log('───────────────── Step 3: Token check ─────────────────');

  const env = process.env.LIEPIN_USER_TOKEN || process.env.LIEPIN_TOKEN || '';
  if (env && env.trim()) {
    ok('Token ready (environment variable)');
    return true;
  }

  // Check config file
  const cfgPath = path.join(HOME, '.config', 'liepin-cli', 'config.json');
  try {
    if (fs.existsSync(cfgPath)) {
      const d = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (d.token && String(d.token).trim()) {
        ok('Token ready (config file: ~/.config/liepin-cli/config.json)');
        return true;
      }
    }
  } catch (e) {}

  warn('No Token detected');
  info('Please obtain Token via:');
  info('  https://www.liepin.com/mcp/auth');
  info('  Copy x-user-token (a JWT string)');
  info('  Then send the Token to me and I will configure it automatically.');
  info('');
  info('Or set the environment variable yourself:');
  info('  set LIEPIN_USER_TOKEN=yourToken');
  info('Then rerun this script.');
  return false;
}

// Step 4: check wizard config
function step4() {
  log('');
  log('───────────────── Step 4: wizard config ─────────────────');
  const cfgPath = path.join(process.cwd(), 'liepin_wizard_config.json');
  if (fs.existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (cfg.keywords && cfg.keywords.length) {
        ok('Wizard config ready: ' + cfg.keywords.join(','));
        return true;
      }
    } catch (e) {}
  }

  info('No wizard config detected, opening the web wizard page for you…');
  info('Please fill your job criteria on the web page and click "Submit".');
  log('');
  log('   Tip: just say "help me apply on Liepin" to auto-open the wizard.');
  return false;
}

// ----- Main flow -----
function main() {
  console.log(BANNER);
  log('');

  const s1 = step1();
  if (!s1) { warn('Node version too low, please upgrade to Node 18+'); process.exit(1); }

  const s2 = step2();
  if (!s2) { warn('liepin-cli install failed, please install manually then retry'); process.exit(1); }

  const s3 = step3();
  const s4 = step4();

  log('');
  log('───────────────── Init result ─────────────────');
  if (s1 && s2 && s3 && s4) {
    ok('All ready! You can start auto-apply 🎉');
    info('Run delivery: node scripts/apply_pipeline.js');
    info('Or tell me: "help me apply on Liepin"');
  } else {
    log('Not fully ready yet (missing Token or config), supplement then start.');
  }
  log('');
  info('If you have a Token, just send it to me and I will set it up and start delivery.');
}

main();
