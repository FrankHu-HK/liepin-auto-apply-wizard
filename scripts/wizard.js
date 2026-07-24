// Liepin Delivery Wizard · Web criteria collector (single popup, fill once)
// Zero external deps: only Node stdlib http + fs + path
// Usage: node scripts/wizard.js  →  prints WIZARD_URL=http://127.0.0.1:PORT
//        User opens that URL in browser, fills form, submits → writes liepin_wizard_config.json → server closes and exits
// Preference memory: on startup, if liepin_wizard_config.json already exists in the workspace, auto-pre-fills the form with last values.

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const WORKDIR = process.cwd();
const HTML_PATH = path.join(__dirname, 'wizard.html');
const CONFIG_PATH = path.join(WORKDIR, 'liepin_wizard_config.json');

let hasResume = false; // assume no resume by default

// ---------------- Check whether the Liepin user has a resume ----------------
// Call `liepin-cli resume get`: success = has resume; failure = no resume / token invalid
function checkResumeExists() {
  // Find CLI binary (same logic as apply_pipeline.js)
  const home = os.homedir();
  const cands = [
    process.env.LIEPIN_CLI_BIN,
    path.join(home, '.local', 'bin', 'liepin-cli'),
    path.join(home, '.npm-global', 'bin', 'liepin-cli'),
    'liepin-cli',
  ].filter(Boolean);
  for (const bin of cands) {
    try {
      const r = spawnSync(bin, ['resume', 'get', '--output', 'json'], { windowsHide: true, timeout: 10000, encoding: 'utf8' });
      if (r.status === 0) {
        try {
          const data = JSON.parse(r.stdout);
          if (data && (data.resumeId || data.baseInfo || data.name || JSON.stringify(data).length > 50)) {
            return true; // has resume
          }
        } catch (e) {}
        return false; // empty response = no resume
      }
      if (r.stderr && r.stderr.includes('token')) return false; // token problem, assume no resume
    } catch (e) { continue; }
  }
  return false; // can't get CLI, also assume no resume
}

const html = fs.readFileSync(HTML_PATH, 'utf8');

// ---------------- Input normalization (same rules as apply_pipeline.js) ----------------
const KEYWORD_SEP = /[,，、;；\s]+/;
function splitKeywords(v) {
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(KEYWORD_SEP).map((s) => s.trim()).filter(Boolean);
  return [];
}
function normalizeLocation(v) {
  if (v === undefined || v === null) return '__ALL__';
  const s = String(v).trim();
  if (s === '' || s === '__ALL__' || s === 'all') return '__ALL__';
  return s;
}
function normalizeMulti(v) {
  if (Array.isArray(v)) {
    const a = v.map((s) => String(s).trim()).filter(Boolean);
    if (!a.length || a.includes('__ALL__') || a.includes('all')) return ['__ALL__'];
    return a;
  }
  if (typeof v === 'string') {
    const a = v.split(KEYWORD_SEP).map((s) => s.trim()).filter(Boolean);
    if (!a.length || a.includes('__ALL__') || a.includes('all')) return ['__ALL__'];
    return a;
  }
  return ['__ALL__'];
}

// ---------------- Read existing config, build pre-fill data (preference memory) ----------------
function buildPrefill() {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const kw = splitKeywords(c.keywords).join(',');
    return {
      keywords: kw,
      industry: Array.isArray(c.industry) ? c.industry : ['__ALL__'],
      location: (c.location && c.location !== '__ALL__') ? c.location : 'all',
      salaryFloor: (c.salaryFloor != null) ? c.salaryFloor : 25,
      salaryCeil: (c.salaryCeil != null) ? c.salaryCeil : 500,
      recruitmentType: ['nonRecruiter', 'recruiter', 'all'].includes(c.recruitmentType) ? c.recruitmentType : 'nonRecruiter',
      dailyCap: (c.dailyCap && c.dailyCap >= 1) ? c.dailyCap : 50,
      unattended: c.unattended === true,
      schedule: c.schedule || '0 9 * * *',
    };
  } catch (e) {
    return null; // no history config: blank form
  }
}

// Check resume + pre-fill data
const prefill = buildPrefill();
hasResume = checkResumeExists();

// Inject resume status + pre-fill data into HTML
let injectScript = '<script>window.__HAS_RESUME__=' + hasResume + ';';
if (prefill) injectScript += 'window.__PREFILL__=' + JSON.stringify(prefill).replace(/</g, '\\u003c') + ';';
injectScript += '</script>';
const servedHtml = html.replace('</head>', injectScript + '</head>');

if (hasResume) console.log('HAS_RESUME=true (resume detected, resume fields hidden)');
else console.log('HAS_RESUME=false (no resume detected, resume fields shown in wizard)');

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(servedHtml);
    return;
  }
  if (req.method === 'POST' && req.url === '/submit') {
    let buf = '';
    req.on('data', (c) => (buf += c));
    req.on('end', () => {
      let cfg;
      try { cfg = JSON.parse(buf); } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: 'Config is not valid JSON' }));
        return;
      }
      // Keywords: must split at least one (defensive against string/array mix)
      const kws = splitKeywords(cfg.keywords);
      if (!kws.length) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: 'Missing job keyword' }));
        return;
      }
      const safe = {
        keywords: kws,
        industry: normalizeMulti(cfg.industry),
        location: normalizeLocation(cfg.location),
        salaryFloor: Number(cfg.salaryFloor) || 0,
        salaryCeil: Number(cfg.salaryCeil) || 999,
        // Job title already merges "role+level", level no longer filtered separately, always full
        levels: ['__ALL__'],
        recruitmentType: ['nonRecruiter', 'recruiter', 'all'].includes(cfg.recruitmentType) ? cfg.recruitmentType : 'nonRecruiter',
        dailyCap: Math.max(1, parseInt(cfg.dailyCap, 10) || 50),
        maxPages: parseInt(cfg.maxPages, 10) || 6,
        runMode: ['foreground', 'background'].includes(cfg.runMode) ? cfg.runMode : 'foreground',
      };
      // Automation-run fields (if any)
      if (cfg.unattended === true) {
        safe.unattended = true;
        safe.schedule = cfg.schedule || '0 9 * * *';
      } else {
        safe.unattended = false;
      }
      try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(safe, null, 2), 'utf8');
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: 'Config write failed: ' + e.message }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: CONFIG_PATH, autoRun: true }));
      console.log('CONFIG_WRITTEN=' + CONFIG_PATH);
      console.log('AUTO_RUN_START=requirements submitted, immediately auto-run apply_pipeline.js (zero user action needed)');
      // Response already sent to frontend; keep server alive, start delivery pipeline in foreground and stream output, exit when done
      const child = spawn(process.execPath, [path.join(__dirname, 'apply_pipeline.js')], {
        cwd: WORKDIR,
        stdio: 'inherit',
        env: process.env,
      });
      child.on('error', (e) => {
        console.error('Delivery process failed to start: ' + e.message);
        server.close();
        process.exit(1);
      });
      child.on('exit', (code) => {
        console.log('PIPELINE_DONE=apply_pipeline.js exited with code ' + (code || 0));
        server.close();
        process.exit(code || 0);
      });
    });
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, message: 'not found' }));
});

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const url = 'http://127.0.0.1:' + port;
  console.log('WIZARD_URL=' + url);
  if (prefill) console.log('PREFILL=last preference loaded (' + prefill.keywords + ')');
});
