// Liepin fully-automated delivery pipeline (popup wizard edition · v2.0.0, based on official open-source liepin-cli)
// Underlying calls: spawn `liepin-cli job search / job apply --output json`, parse raw JSON from stdout
// Upper-layer logic (cross-session de-dup / daily quota / recruitment-type filter / recruiter detection / rate-limit guard / real four-state / result display / stability guardrail) all preserved
// Zero external deps: only Node stdlib child_process / fs / path / os
//
// ⚠️ Response field names [needs verification]: liepin-cli talks directly to /mcp/search-job, /mcp/apply-job and echoes the server's raw JSON,
//   the official repo does not document the response structure. This file does "multi-candidate tolerant parsing" for the search list and job fields,
//   and on first real call dumps the raw response to liepin_schema_probe_search.json / liepin_schema_probe_apply.json for manual verification and calibration.

'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const WORKDIR = process.cwd();

const CONFIG_PATH = path.join(WORKDIR, 'liepin_wizard_config.json');
const QUOTA_PATH = path.join(WORKDIR, 'liepin_daily_quota.json');
const REPORT_PATH = path.join(WORKDIR, 'liepin_wizard_report.json');
const SUMMARY_PATH = path.join(WORKDIR, 'liepin_wizard_summary.md');
const PROBE_SEARCH = path.join(WORKDIR, 'liepin_schema_probe_search.json');
const PROBE_APPLY = path.join(WORKDIR, 'liepin_schema_probe_apply.json');
const PROGRESS_PATH = path.join(WORKDIR, 'liepin_wizard_progress.jsonl'); // real-time per-item progress, for "check progress" / monitoring
const CRASH_PATH = path.join(WORKDIR, 'liepin_wizard_crash.log'); // fatal exception dump (avoid process.exit truncating stderr and losing [FATAL] output)
const CLI_TIMEOUT_MS = 90000; // hard timeout per single CLI call (prevent subprocess hang freezing the whole run)

// Fatal-exception safe exit: dump full stack first, then give stderr a flush window, avoid process.exit truncating [FATAL] output
function flushExit(code, msg) {
  try { fs.appendFileSync(CRASH_PATH, (msg || '') + '\n'); } catch (e) {}
  try { console.error(msg || ''); } catch (e) {}
  const t = setTimeout(() => process.exit(code), 80);
  if (t && typeof t.unref === 'function') t.unref();
}

// Historical reports (for cross-session permanent de-dup)
const HISTORY_REPORTS = [
  'liepin_apply_report.json',
  'liepin_apply_report_deep.json',
  'liepin_apply_report_full.json',
  'liepin_redeliver_report.json',
  'liepin_realestate_report.json',
  'liepin_wizard_report.json',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function log(...a) { console.error('[progress]', ...a); }
// Application status display mapping, for real-time logs and progress file
function statusZh(s) { return ({ success: 'Success', already: 'Already applied', fail: 'Failed', unknown: 'Unknown' })[s] || s; }
// Real-time per-item progress dump (JSONL), one line appended per application, readable anytime via "check progress"
function appendProgress(seq, job, ev) {
  try {
    const line = JSON.stringify({ seq, ts: Date.now(), jobId: job.jobId, jobName: job.jobName, company: job.company, location: job.location, status: ev.status, message: ev.message }) + '\n';
    fs.appendFileSync(PROGRESS_PATH, line, 'utf8');
  } catch (e) { /* progress file is non-critical, ignore on failure */ }
}

// ---------------- Stability guardrail ----------------
const MAX_RUNTIME_MS = 45 * 60 * 1000;
const CIRCUIT_FAIL_LIMIT = 3;
const RUN_START = Date.now();
function overRuntime() { return (Date.now() - RUN_START) > MAX_RUNTIME_MS; }

const runState = { toApply: [], results: [], counts: { success: 0, already: 0, fail: 0, unknown: 0 }, quota: { date: '', count: 0 }, note: null };

// ---------------- liepin-cli invocation layer ----------------
// CLI binary resolution: ① env LIEPIN_CLI_BIN override ② liepin-cli in PATH ③ known venv install path
function cliCandidates() {
  const list = [];
  if (process.env.LIEPIN_CLI_BIN) list.push(process.env.LIEPIN_CLI_BIN);
  const home = os.homedir();
  // auto-install path (takes priority over bare command, as it may not be on PATH)
  // generic install locations (override any of these via LIEPIN_CLI_BIN)
  list.push(path.join(home, '.local', 'bin', 'liepin-cli'));
  list.push(path.join(home, '.npm-global', 'bin', 'liepin-cli'));
  if (process.platform === 'win32') {
    list.push(path.join(home, 'AppData', 'Roaming', 'npm', 'liepin-cli.cmd'));
  }
  list.push('liepin-cli');
  return list;
}

// Token passthrough: prefer LIEPIN_USER_TOKEN (liepin-cli native), fall back to LIEPIN_TOKEN (old convention), then fall back to config file (subprocess reads itself)
function spawnEnv() {
  const env = Object.assign({}, process.env);
  if (!env.LIEPIN_USER_TOKEN && env.LIEPIN_TOKEN) env.LIEPIN_USER_TOKEN = env.LIEPIN_TOKEN;
  return env;
}

// Get currently available token (for explicit --token passthrough, v2.3.0 official doc requires: --token > env > config)
function getActiveToken() {
  const fromEnv = process.env.LIEPIN_USER_TOKEN || process.env.LIEPIN_TOKEN || '';
  if (fromEnv.trim()) return fromEnv.trim();
  try {
    const cfgPath = path.join(os.homedir(), '.config', 'liepin-cli', 'config.json');
    if (fs.existsSync(cfgPath)) {
      const d = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (d.token && String(d.token).trim()) return String(d.token).trim();
    }
  } catch (e) {}
  return null;
}

// Run one liepin-cli command, return {code, stdout, stderr}; try candidate binaries in order; hard timeout prevents subprocess hang
function runCli(args, timeoutMs) {
  const TO = typeof timeoutMs === 'number' ? timeoutMs : CLI_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const candidates = cliCandidates();
    let lastErr = null;
    let settled = false;
    let timer = null;
    function finish(code, out, err) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code: code === null ? -1 : code, stdout: out, stderr: err });
    }
    function onTimeout(p) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { if (p && !p.killed) p.kill('SIGKILL'); } catch (e) {}
      const e = new Error('CLI call timed out (' + (TO / 1000) + 's no response, subprocess may be hung)');
      e.code = 'TIMEOUT';
      lastErr = e;
      reject(e);
    }
    function tryOnce(idx) {
      if (idx >= candidates.length) {
        const e = lastErr || new Error('liepin-cli not found');
        e.code = lastErr && lastErr.code ? lastErr.code : 'ENOENT';
        reject(e);
        return;
      }
      const bin = candidates[idx];
      let cmd, spawnArgs;
      if (/\.py$/.test(bin)) {
        cmd = process.env.LIEPIN_PYTHON || 'python';
        spawnArgs = ['-m', 'liepin_cli.main', ...args];
      } else {
        cmd = bin;
        spawnArgs = args;
      }
      let p;
      try {
        p = spawn(cmd, spawnArgs, { env: spawnEnv(), windowsHide: true });
      } catch (e) {
        lastErr = e;
        tryOnce(idx + 1);
        return;
      }
      let out = '', err = '';
      timer = setTimeout(() => onTimeout(p), TO);
      if (timer && typeof timer.unref === 'function') timer.unref();
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (err += d));
      p.on('error', (e) => {
        if (settled) return;
        lastErr = e;
        if (timer) clearTimeout(timer);
        tryOnce(idx + 1);
      });
      p.on('close', (code) => finish(code, out, err));
    }
    tryOnce(0);
  });
}

// Adapt CLI raw output into the wrapper shape expected by old evalResult / isRateLimit (keep test and judgment logic unchanged)
function adaptCliResult(r) {
  const text = (r.stdout || '').trim();
  const errText = (r.stderr || '').trim();
  if (r.code !== 0) {
    const msg = errText || text || ('exit code ' + r.code);
    return { error: { message: msg } };
  }
  if (!text) return { error: { message: errText || 'empty response' } };
  return { result: { content: [{ text }] } };
}

// Rate-limit guard: on throttle, exponential backoff 15→240s; cumulative >1800s throws RATE_LIMIT_PERSIST
const BACKOFF = [15, 30, 45, 60, 90, 120, 180, 240];
async function runCliGuarded(args, label) {
  let totalWait = 0;
  for (let i = 0; i <= BACKOFF.length; i++) {
    let r;
    try {
      r = await runCli(args);
    } catch (e) {
      if (e.code === 'ENOENT') throw new Error('liepin-cli command not found: please install and add to PATH, or set LIEPIN_CLI_BIN (see skill "Dependency Pre-check")');
      log(`${label} call failed: ${e.message}, retrying in 15s`);
      await sleep(15000); totalWait += 15;
      if (totalWait > 1800) throw new Error('RATE_LIMIT_PERSIST');
      continue;
    }
    const adapted = adaptCliResult(r);
    if (isRateLimit(adapted)) {
      const wait = BACKOFF[Math.min(i, BACKOFF.length - 1)];
      log(`${label} hit rate-limit, backoff ${wait}s (cumulative ${totalWait}s)`);
      await sleep(wait * 1000); totalWait += wait;
      if (totalWait > 1800) throw new Error('RATE_LIMIT_PERSIST');
      continue;
    }
    return adapted;
  }
  throw new Error(`${label} retries exhausted`);
}

// First real-response probe dump (field names [needs verification], for manual calibration)
let probeSearchSaved = false;
let probeApplySaved = false;
function saveProbe(p, adapted) {
  try {
    const txt = adapted.error ? JSON.stringify(adapted.error) : (adapted.result && adapted.result.content[0] && adapted.result.content[0].text);
    fs.writeFileSync(p, JSON.stringify({
      _note: 'First real-call raw response probe; field names [needs verification], use this to calibrate apply_pipeline.js parsing (extractJobList / normalizeJob)',
      raw: txt,
    }, null, 2), 'utf8');
  } catch (e) { /* probe failure does not affect main flow */ }
}

// ---------------- Salary parsing (K) ----------------
function parseSalary(str) {
  if (!str) return { floor: null, ceil: null };
  const s = String(str);
  if (/||negotiab/i.test(s)) return { floor: null, ceil: null };
  const unit = /[wW]/.test(s) ? 10 : 1;
  const nums = (s.match(/(\d+(?:\.\d+)?)/g) || []).map(Number);
  if (nums.length === 0) return { floor: null, ceil: null };
  return { floor: nums[0] * unit, ceil: (nums.length > 1 ? nums[nums.length - 1] : nums[0]) * unit };
}

// ---------------- Input normalization (defensive) ----------------
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

// ---------------- Recruiter detection v2 (three-layer · v2.2.0) ----------------
//
// Layer 1: known direct-hire enterprise whitelist (famous direct hiring, hit → return false directly)
// Layer 2: known recruiter brand library (hit → return true directly)
// Layer 3: heuristic weighted scoring (industry + company name + JD score fusion, threshold judgment)
//
// Whitelist and brand library each 50+, covering major direct-hire enterprises and recruiter agencies, minimizing mis-judgment.

// ----- Layer 1: known direct-hire enterprise whitelist (hit → false directly) -----
const DIRECT_HIRE_BRANDS = [
  // Internet/tech
  '', '', '', '', '', '', '', '', '', '', '', '', 'OPPO', 'vivo', '', '', '', '', '', '360', '', '', '', '', 'B', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '58', '', '', '', '', '', '', '', '', '',
  // Finance/bank/insurance/securities
  '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
  // Manufacturing/auto/heavy-industry
  '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'TCL', '', '', '', '', '', '', '', '', '',
  // Central SOEs/public-institution/infrastructure
  '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
  // Famous foreign companies
  '', 'Microsoft', '', 'Google', '', 'Apple', 'Meta', '', 'Amazon', 'Oracle', '', 'IBM', 'Intel', '', 'NVIDIA', '', 'AMD', 'Cisco', '', 'SAP', 'Salesforce', 'Adobe', 'Dell', '', 'HP', 'LinkedIn', 'Uber', 'Tesla', '', 'Walmart', 'Nike', '', 'Adidas', '', '', 'Pepsi', '', 'P&G', '', 'Unilever', '', '', 'Nestle', '', 'Johnson', '', 'Pfizer', '', 'Merck', '', 'Lilly', '', 'Novartis', '', 'Roche', '', 'Bayer', '', 'Sanofi', '', 'AstraZeneca', '', 'Siemens', '', 'Philips', '', 'GE', '', 'Bosch', '', 'Schneider', 'ABB', '', 'BASF', '', 'Dow', '3M',
  // Famous private/new-consumer/service
  '', '', '', '', '', 'Starbucks', '', 'McDonald', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
  // E-commerce/cross-border/emerging
  'SHEIN', '', 'Temu', 'TikTok', 'Shopee', 'Lazada', '', '', '', '', '', '', 'Ping++',
  // Other obviously direct-hire: education/medical/real-estate
  '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
];
// Quick hit check (company name containing any whitelist word = non-recruiter, direct from layer 1)
// Uses Set for speed; whitelist is mixed CN/EN, some company names >2 chars, every check is efficient enough
const RECTYPE_FILL = new Set(DIRECT_HIRE_BRANDS.map((s) => s.toLowerCase()));

// ----- Layer 2: known recruiter / HR-service companies (hit → true directly) -----
const RECRUITER_KNOWN_BRANDS = [
  // Global top 5 recruiters
  '', 'Heidrick', '', 'Korn Ferry', 'KornFerry', 'Korn', '', 'Egon Zehnder', '', 'Spencer Stuart', '', 'Russell Reynolds',
  // Other international recruiters/HR
  '', 'Michael Page', 'MichaelPage', '', 'Randstad', '', 'Adecco', '', 'ManpowerGroup', 'Manpower', 'Recruit', '', 'Persol', 'Hays', '', 'Robert Walters', 'RobertHalf', '', 'Hudson',
  // Domestic top recruiters/consulting
  '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'BPO', '',
  // HR outsourcing/labor dispatch/background check
  '', '', '', '', 'FESCO', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
  // RPO / recruitment process outsourcing
  '', '', 'Korn', 'Futurestep', '', 'RPO', '',
  // Business services/management consulting (occasionally mixed with recruiter business)
  '', 'Accenture', '', 'Deloitte', '', 'EY', '', 'KPMG', '', 'PwC', '', 'McKinsey', '', 'BCG', '', 'Bain', '', 'Roland Berger',
  // Common classified platforms/job sites
  '', '', '51job', '', '', '', 'BOSS', 'BOSS', '', '', '', '',
];
const REC_BRANDS_SET = new Set(RECRUITER_KNOWN_BRANDS.map((s) => s.toLowerCase()));

function isDirectHireBrand(comp) {
  if (!comp) return false;
  const c = comp.toLowerCase();
  for (const brand of RECTYPE_FILL) {
    if (brand.length > 2 && c.includes(brand)) return true;
    // Short brands (1~2 chars) skipped to avoid mis-judgment (e.g. "", "" need full match in limited cases, handled by include)
  }
  return false;
}

function isKnownRecruiterBrand(comp) {
  if (!comp) return false;
  const c = comp.toLowerCase();
  for (const brand of REC_BRANDS_SET) {
    if (brand.length > 2 && c.includes(brand)) return true;
  }
  return false;
}

// ----- Layer 3: heuristic weighted scoring (industry + company feature + JD keyword fusion) -----
const RECRUITER_FEATURE_IND = /||||||||/;
const NON_RECRUITER_IND = /||||||||||||||||||||||/;
const RECRUITER_COMP_FEATURE = /||||||||/i;
const RECRUITER_JD_FEATURE = /||||RPO|||/i;
// Company-name explicit exclusion words: when company name contains one of these, likely a recruiter
const RECRUITER_COMP_EXCLUDE = /||||||||/i;
// Direct-hire company-name signals: when company name contains these and no recruiter signal, strengthen non-recruiter judgment
const DIRECT_SIGNAL = /||||||||||||/i;

function headhunterScore(job) {
  // Returns a 0~100 recruiter-probability score: ≤20 direct-hire, ≥80 recruiter, middle needs manual check
  const ind = job.industry || '';
  const comp = job.company || '';
  const detail = job.jobDetail || job.description || '';
  let score = 0;
  // Industry feature: recruiter industry +20, direct-hire industry -15
  if (RECRUITER_FEATURE_IND.test(ind)) score += 20;
  if (NON_RECRUITER_IND.test(ind)) score -= 15;
  // Company-name feature: recruiter word +25, direct-hire signal -10
  if (RECRUITER_COMP_FEATURE.test(comp)) score += 25;
  if (RECRUITER_COMP_EXCLUDE.test(comp)) score += 10;
  if (DIRECT_SIGNAL.test(comp)) score -= 10;
  // JD text feature
  if (RECRUITER_JD_FEATURE.test(detail)) score += 25;
  // Normalize to 0~100
  return Math.max(0, Math.min(100, score + 50));
}

function isRecruiterJob(job) {
  const comp = job.company || '';
  // Layer 1: whitelist direct exclude
  if (isDirectHireBrand(comp)) return false;
  // Layer 2: known recruiter brand direct judge
  if (isKnownRecruiterBrand(comp)) return true;
  // Layer 3: weighted score, ≥60 judged recruiter
  return headhunterScore(job) >= 60;
}

// ---------------- Search: parse server raw JSON (multi-candidate tolerant) ----------------
// Response structure [needs verification]: main hypothesis {data:{list:[...]}}, fall back to other common wrappers in order
function extractJobList(adapted) {
  let obj;
  try {
    const txt = adapted.error ? JSON.stringify(adapted.error) : (adapted.result.content[0] && adapted.result.content[0].text);
    obj = JSON.parse(txt);
  } catch (e) { return []; }
  const candidates = [
    obj && obj.data && obj.data.list,
    obj && obj.list,
    obj && obj.jobs,
    obj && obj.data && obj.jobs,
    obj && obj.data && obj.data && obj.data.list,
    Array.isArray(obj) ? obj : null,
  ];
  for (const c of candidates) if (Array.isArray(c)) return c;
  return [];
}

// Job field alias tolerant (response field names [needs verification])
function first(...vals) {
  for (const v of vals) if (v !== undefined && v !== null && v !== '') return v;
  return undefined;
}
function normalizeJob(j) {
  return {
    jobId: Number(first(j.jobId, j.id)),
    jobName: first(j.jobName, j.title, j.jobTitle) || '',
    company: first(j.company, j.compName, j.employer, j.companyName) || '',
    industry: first(j.industry, j.trade, j.industryName) || '',
    salary: first(j.salary, j.salaryText, j.salaryDesc, j.salaryShow) || '',
    location: first(j.location, j.city, j.address, j.workCity, j.cityName) || '',
    jobDetail: first(j.jobDetail, j.description, j.jobDesc, j.detail) || '',
    // apply-required job-kind: reuse the position-type value from search results (official mandatory, do not guess)
    jobKind: String(first(j.jobKind, j.jobType, j.recruitType, j.type, j.jobTypeId) || '2'),
  };
}

// CURRENT_LOCATION: injected by main, used for server-side location filtering (plaintext, low risk)
let CURRENT_LOCATION = '__ALL__';

async function searchJobs(keyword, salaryFloorYuan, salaryCeilYuan, page, extraOpts) {
  const args = ['job', 'search', '--job-name', keyword, '--page', String(page), '--output', 'json'];
  // Location filter (v2.3.0 all official params configured)
  if (CURRENT_LOCATION && CURRENT_LOCATION !== '__ALL__') {
    const toks = splitKeywords(CURRENT_LOCATION);
    if (toks.length === 1) args.push('--address', toks[0]);
  }
  // Salary filter (official --salary-floor --salary-cap)
  if (salaryFloorYuan > 0) args.push('--salary-floor', String(salaryFloorYuan));
  if (salaryCeilYuan > 0 && salaryCeilYuan < 999000) args.push('--salary-cap', String(salaryCeilYuan));
  // Extra filter params (v2.3.0 new: --work-experience --edu-level --comp-nature --company-name --salary-kind)
  if (extraOpts) {
    if (extraOpts.workExperience) args.push('--work-experience', extraOpts.workExperience);
    if (extraOpts.eduLevel) args.push('--edu-level', extraOpts.eduLevel);
    if (extraOpts.compNature) args.push('--comp-nature', extraOpts.compNature);
    if (extraOpts.companyName) args.push('--company-name', extraOpts.companyName);
    if (extraOpts.salaryKind) args.push('--salary-kind', extraOpts.salaryKind);
  }
  let adapted;
  try {
    adapted = await runCliGuarded(args, `search[${keyword}]p${page}`);
  } catch (e) {
    log('Search interrupted:', e.message);
    throw e;
  }
  if (!probeSearchSaved) { saveProbe(PROBE_SEARCH, adapted); probeSearchSaved = true; }
  const list = extractJobList(adapted);
  return list.map(normalizeJob).filter((j) => j.jobId);
}

// ---------------- Apply ----------------
async function applyJob(jobId, jobKind) {
  const args = ['job', 'apply', '--job-id', String(jobId), '--job-kind', String(jobKind), '--output', 'json'];
  const adapted = await runCliGuarded(args, `apply[${jobId}]`);
  if (!probeApplySaved) { saveProbe(PROBE_APPLY, adapted); probeApplySaved = true; }
  return adapted;
}

// ---------------- Cross-session de-dup ----------------
function loadDelivered(workdir) {
  const dir = workdir || WORKDIR;
  const set = new Set();
  for (const f of HISTORY_REPORTS) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) continue;
    try {
      const d = JSON.parse(fs.readFileSync(p, 'utf8'));
      const arr = d.results || d.items || (Array.isArray(d) ? d : []);
      arr.forEach((x) => {
        const s = x.status; const id = Number(x.jobId);
        if ((s === 'success' || s === 'already') && id) set.add(id);
      });
    } catch (e) {}
  }
  return set;
}

// ---------------- Resume job-expectation sync (v2.3.0 key fix) ----------------
// Before search, call `liepin-cli resume update-job-want` to write the user's job expectation into the resume,
// otherwise Liepin backend matches by the "old expectation" in the resume, not the user's current search criteria — the root cause of many applications going nowhere.
// Official params: --jobtitle --dq --want-salary-low --want-salary-high
async function ensureJobWant(keywords, location, salaryFloor, salaryCeil) {
  const args = ['resume', 'update-job-want'];
  // Expected position: use first keyword (wizard allows only one core direction)
  if (keywords && keywords.length) args.push('--jobtitle', String(keywords[0]).slice(0, 30));
  // Expected location: pass when single city, skip when multi-city/nationwide (let Liepin match resume location)
  if (location && location !== '__ALL__') {
    const toks = splitKeywords(location);
    if (toks.length === 1) args.push('--dq', toks[0]);
  }
  if (salaryFloor > 0) args.push('--want-salary-low', String(salaryFloor));
  if (salaryCeil > 0 && salaryCeil < 999) args.push('--want-salary-high', String(salaryCeil));
  try {
    const r = await runCliGuarded(args, 'sync job expectation');
    log('  ✅ resume job expectation synced: ' + args.slice(2, 2 + 4).join(' '));
    return { ok: true, args };
  } catch (e) {
    log('  ⚠️ job expectation sync failed (does not affect delivery): ' + e.message);
    return { ok: false, error: e.message };
  }
}

// ============ v2.3.0 new: auth status + full resume suite + --token passthrough ============

// --- auth status ---
// Official doc `liepin-cli auth status`: view current token status (desensitized)
async function authStatus() {
  const args = ['auth', 'status'];
  try {
    const r = await runCliGuarded(args, 'check auth status');
    const adapted = adaptCliResult(r);
    const txt = adapted.error ? JSON.stringify(adapted.error) : (adapted.result && adapted.result.content[0] && adapted.result.content[0].text);
    log('  🔑 auth status: ' + (txt || 'unknown'));
    return { ok: true, text: txt };
  } catch (e) {
    log('  ⚠️ auth status query failed: ' + e.message);
    return { ok: false, error: e.message };
  }
}

// --- auth clear ---
// Official doc `liepin-cli auth clear`: clear local token
async function authClear() {
  const args = ['auth', 'clear'];
  try {
    const r = await runCliGuarded(args, 'clear token');
    log('  ✅ local token cleared');
    return { ok: true };
  } catch (e) {
    log('  ⚠️ token clear failed: ' + e.message);
    return { ok: false };
  }
}

// --- resume get ---
// Official doc `liepin-cli resume get`: get current resume
async function resumeGet() {
  const args = ['resume', 'get', '--output', 'json'];
  try {
    const r = await runCliGuarded(args, 'read resume');
    const adapted = adaptCliResult(r);
    const txt = adapted.error ? null : (adapted.result && adapted.result.content[0] && adapted.result.content[0].text);
    if (txt) {
      const data = JSON.parse(txt);
      return { ok: true, data };
    }
    return { ok: true, data: null };
  } catch (e) {
    log('  ⚠️ resume read failed: ' + e.message);
    return { ok: false, error: e.message, data: null };
  }
}

// --- resume update-base-info ---
// Official doc `liepin-cli resume update-base-info`: update basic profile
async function resumeSyncBaseInfo(fields) {
  if (!fields || !Object.keys(fields).length) return { ok: true, note: 'no fields, skip' };
  const args = ['resume', 'update-base-info'];
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null && v !== '') args.push('--' + k, String(v));
  }
  if (args.length <= 3) return { ok: true, note: 'no valid fields, skip' };
  try {
    const r = await runCliGuarded(args, 'update basic info');
    log('  ✅ resume basic info updated');
    return { ok: true };
  } catch (e) {
    log('  ⚠️ basic info update failed: ' + e.message);
    return { ok: false, error: e.message };
  }
}

// --- resume update-self-assess ---
// Official doc `liepin-cli resume update-self-assess`: update self-assessment
async function resumeSyncSelfAssess(text) {
  if (!text || !text.trim()) return { ok: true, note: 'no content, skip' };
  const args = ['resume', 'update-self-assess', '--self-assess', text.trim().slice(0, 500)];
  try {
    const r = await runCliGuarded(args, 'update self-assessment');
    log('  ✅ self-assessment updated');
    return { ok: true };
  } catch (e) {
    log('  ⚠️ self-assessment update failed: ' + e.message);
    return { ok: false };
  }
}

// --- resume add-work-exp ---
// Official doc `liepin-cli resume add-work-exp`
async function resumeSyncWorkExp(entries) {
  if (!entries || !entries.length) return { ok: true, note: 'no work experience, skip' };
  let ok = 0;
  for (const e of entries) {
    if (!e.compName && !e.rwTitle) continue;
    const r = await runCliGuarded(
      ['resume', 'add-work-exp', '--comp-name', String(e.compName || '').slice(0, 50),
       '--rw-title', String(e.rwTitle || '').slice(0, 30),
       '--work-start', String(e.workStart || '202001'), '--work-end', String(e.workEnd || 'now'),
       '--salary', String(e.salary || '0')],
      'add work experience'
    ).catch(() => null);
    if (r) ok++;
  }
  if (ok) log('  ✅ work experience synced ' + ok + '/' + entries.length);
  return { ok: ok > 0 };
}

// --- resume add-edu-exp ---
// Official doc `liepin-cli resume add-edu-exp`
async function resumeSyncEduExp(entries) {
  if (!entries || !entries.length) return { ok: true, note: 'no education experience, skip' };
  let ok = 0;
  for (const e of entries) {
    if (!e.school) continue;
    const r = await runCliGuarded(
      ['resume', 'add-edu-exp', '--school', String(e.school).slice(0, 50),
       '--major', String(e.major || '').slice(0, 50), '--degree', String(e.degree || 'Bachelor'),
       '--start', String(e.start || '201009'), '--end', String(e.end || '201406')],
      'add education experience'
    ).catch(() => null);
    if (r) ok++;
  }
  if (ok) log('  ✅ education experience synced ' + ok + '/' + entries.length);
  return { ok: ok > 0 };
}

// --- resume add-project-exp ---
// Official doc `liepin-cli resume add-project-exp`
async function resumeSyncProjectExp(entries) {
  if (!entries || !entries.length) return { ok: true, note: 'no project experience, skip' };
  let ok = 0;
  for (const e of entries) {
    if (!e.name) continue;
    const r = await runCliGuarded(
      ['resume', 'add-project-exp', '--name', String(e.name).slice(0, 50),
       '--position', String(e.position || '').slice(0, 30),
       '--start', String(e.start || '202001'), '--end', String(e.end || '202012')],
      'add project experience'
    ).catch(() => null);
    if (r) ok++;
  }
  if (ok) log('  ✅ project experience synced ' + ok + '/' + entries.length);
  return { ok: ok > 0 };
}

// --- resume add-job-want (fallback) ---
// Official doc `liepin-cli resume add-job-want`: add job expectation (when none exists)
// Main flow already uses update-job-want; add is the fallback
async function resumeAddJobWant(jobtitle, dq, low, high) {
  if (!jobtitle) return { ok: true, note: 'no job title, skip' };
  const args = ['resume', 'add-job-want', '--jobtitle', String(jobtitle).slice(0, 30)];
  if (dq) args.push('--dq', dq);
  if (low > 0) args.push('--want-salary-low', String(low));
  if (high > 0 && high < 999) args.push('--want-salary-high', String(high));
  try {
    await runCliGuarded(args, 'add job expectation');
    log('  ✅ job expectation added');
    return { ok: true };
  } catch (e) {
    log('  ⚠️ add job expectation failed: ' + e.message);
    return { ok: false };
  }
}

// --- resume full health check (called before search) ---
// Read resume → check completeness → sync job expectation
async function resumeHealthCheck(keywords, location, salaryFloor, salaryCeil) {
  log('[Step 0] resume health check…');
  const resume = await resumeGet();
  if (!resume.ok || !resume.data) {
    log('  ⚠️ no resume data read (does not affect delivery, but completing resume is recommended)');
    return { ok: false, note: 'no resume read' };
  }
  await ensureJobWant(keywords, location, salaryFloor, salaryCeil);
  return { ok: true, note: 'resume health check done' };
}


// ---------------- Daily quota ----------------
function loadQuota(workdir) {
  const today = new Date().toISOString().slice(0, 10);
  const qp = workdir ? path.join(workdir, 'liepin_daily_quota.json') : QUOTA_PATH;
  if (!fs.existsSync(qp)) return { date: today, count: 0 };
  try {
    const d = JSON.parse(fs.readFileSync(qp, 'utf8'));
    if (d.date !== today) return { date: today, count: 0 };
    return d;
  } catch (e) { return { date: today, count: 0 }; }
}
function saveQuota(q) { fs.writeFileSync(QUOTA_PATH, JSON.stringify(q, null, 2), 'utf8'); }

// ---------------- Rate-limit detection (compatible with old signature: read result.content[0].text or error.message) ----------------
function isRateLimit(resp) {
  let txt = '';
  try { txt = resp.error ? JSON.stringify(resp.error) : resp.result.content[0].text; } catch (e) {}
  return /|429|||rate.?limit/i.test(txt);
}

// ---------------- Four-state result judgment (never fake success) ----------------
function evalResult(resp) {
  if (resp && resp.error) return { status: 'fail', message: JSON.stringify(resp.error).slice(0, 160) };
  let content; try { content = resp.result.content; } catch (e) { return { status: 'unknown', message: 'no return' }; }
  if (!content || !content[0]) return { status: 'unknown', message: 'empty return' };
  let text = content[0].text;
  let parsed; try { parsed = JSON.parse(text); } catch (e) { parsed = { raw: text }; }
  const errCode = parsed.errCode !== undefined ? parsed.errCode : (parsed.code !== undefined ? parsed.code : null);
  const msg = parsed.message || parsed.msg || parsed.errMsg || (parsed.data ? JSON.stringify(parsed.data) : text.slice(0, 160));
  const lc = msg.toLowerCase();
  if (/|||/i.test(msg)) return { status: 'already', message: msg };
  if (/401|unauthorized|/i.test(msg) || (errCode !== null && errCode !== 0 && errCode !== '0')) return { status: 'fail', message: msg };
  if (/|failed||||||denied|invalid|error/i.test(msg)) return { status: 'fail', message: msg };
  if (/||||ok|true|success/i.test(msg)) return { status: 'success', message: msg };
  return { status: 'unknown', message: msg };
}

// ---------------- Report ----------------
function recordOne(job, ev, quota, results, counts) {
  results.push({ jobId: job.jobId, jobName: job.jobName, company: job.company, industry: job.industry, salary: job.salary, location: job.location, recruiter: job.recruiter, status: ev.status, message: ev.message });
  counts[ev.status] = (counts[ev.status] || 0) + 1;
  if (ev.status === 'success') { quota.count += 1; saveQuota(quota); }
}

function writeReport(toApply, results, counts, quota, quotaReached, note) {
  const out = {
    generatedAt: new Date().toISOString(),
    summary: { ...counts, total: toApply.length, applied: results.length },
    dailyQuota: quota,
    quotaReached: !!quotaReached,
    note: note || null,
    results,
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(out, null, 2), 'utf8');
  writeSummary(out);
  return out;
}

function writeSummary(out) {
  const c = out.summary;
  const lines = [];
  lines.push('# Liepin Delivery Result Summary');
  lines.push('');
  lines.push(`Generated at: ${new Date().toLocaleString('en-US')}`);
  lines.push('');
  lines.push(`## Overview`);
  lines.push(`- Total to apply this run: ${c.total}`);
  lines.push(`- Actually processed: ${c.applied}`);
  lines.push(`- ✅ Success: ${c.success}　⚠️ Already applied: ${c.already}　❌ Fail: ${c.fail}　❓ Unknown: ${c.unknown}`);
  lines.push(`- Applied today: ${out.dailyQuota.count}`);
  if (out.quotaReached) lines.push(`- ⏸ Daily cap reached, remaining roles left for tomorrow`);
  if (out.note) lines.push(`- Note: ${out.note}`);
  lines.push('');
  const by = (st) => out.results.filter((r) => r.status === st);
  if (by('success').length) {
    lines.push(`## ✅ Success (${by('success').length})`);
    by('success').forEach((r) => lines.push(`- ${r.jobName} @ ${r.company} (${r.location || ''})`));
    lines.push('');
  }
  if (by('fail').length) {
    lines.push(`## ❌ Fail and reasons (${by('fail').length})`);
    by('fail').forEach((r) => lines.push(`- ${r.jobName} @ ${r.company}: ${r.message}`));
    lines.push('');
  }
  if (by('already').length) {
    lines.push(`## ⚠️ Already applied (skipped, ${by('already').length})`);
    by('already').forEach((r) => lines.push(`- ${r.jobName} @ ${r.company}`));
    lines.push('');
  }
  if (by('unknown').length) {
    lines.push(`## ❓ Unknown (needs manual check, ${by('unknown').length})`);
    by('unknown').forEach((r) => lines.push(`- ${r.jobName} @ ${r.company}: ${r.message}`));
    lines.push('');
  }
  fs.writeFileSync(SUMMARY_PATH, lines.join('\n'), 'utf8');
}

// ---------------- Token source detection ----------------
function tokenAvailable() {
  if (process.env.LIEPIN_USER_TOKEN && process.env.LIEPIN_USER_TOKEN.trim()) return true;
  if (process.env.LIEPIN_TOKEN && process.env.LIEPIN_TOKEN.trim()) return true;
  try {
    const cfgPath = path.join(os.homedir(), '.config', 'liepin-cli', 'config.json');
    if (fs.existsSync(cfgPath)) {
      const d = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (d.token && String(d.token).trim()) return true;
    }
  } catch (e) {}
  return false;
}

// ---------------- Main flow ----------------
async function main() {
  if (!tokenAvailable()) {
    console.error('Missing Token: please run `liepin-cli setup` first (writes ~/.config/liepin-cli/config.json), or set env LIEPIN_USER_TOKEN; see skill "Dependency Pre-check".');
    process.exit(3);
  }
  if (!fs.existsSync(CONFIG_PATH)) { console.error('Missing liepin_wizard_config.json (please complete the popup wizard to collect criteria first)'); process.exit(3); }
  // Clear last run's real-time progress file before each run, avoid appending to history
  try { fs.unlinkSync(PROGRESS_PATH); } catch (e) {}

  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const keywords = splitKeywords(cfg.keywords);
  if (!keywords.length) keywords.push('HRBP');
  const industry = normalizeMulti(cfg.industry);
  CURRENT_LOCATION = normalizeLocation(cfg.location);
  const salaryFloor = cfg.salaryFloor || 0;
  const salaryCeil = cfg.salaryCeil || 999;
  let recruitmentType = cfg.recruitmentType;
  if (!recruitmentType) recruitmentType = cfg.preferNonRecruiter === false ? 'all' : 'nonRecruiter';
  const dailyCap = cfg.dailyCap || 999;
  const maxPages = 1;  // v2.3.0: only search page 1 (liepin-cli search results are relevance-sorted, page 1 is most relevant), no more multi-page scanning — previously 3 keywords × 6 pages = 18 calls, now 3×1 = 3 calls, from 30 min down to 1 min
  const unattended = cfg.unattended === true;
  const schedule = cfg.schedule || '0 9 * * *';
  if (unattended) {
    if (dailyCap >= 999) log('⚠️ unattended mode should set a reasonable dailyCap (e.g. 30~50) to avoid over-applying in one day tripping risk control; currently unlimited');
    else log(`unattended mode enabled (frequency=${schedule}), will run automatically with zero touch, still guarded by daily cap / rate-limit / circuit-break`);
  }

  const salaryFloorYuan = salaryFloor * 1000;
  const delivered = loadDelivered();
  let quota = loadQuota();
  const appliedThisRun = new Set();

  log(`recruitmentType=${recruitmentType}; dailyCap=${dailyCap}; appliedToday=${quota.count}; CLI=based on liepin-cli`);

  // 0) Resume health check (v2.3.0: read resume + check completeness + sync job expectation)
  log('[Step 0] resume health check…');
  await resumeHealthCheck(keywords, CURRENT_LOCATION, salaryFloor, salaryCeil);

  // 1) Search + filter (strictly per wizard settings; any hard condition not met → filtered, but field-parse failure always passes, no false kill)
  const locToks = CURRENT_LOCATION === '__ALL__' ? [] : splitKeywords(CURRENT_LOCATION);
  log('[Filter settings] keywords=[' + keywords.join(',') + ']; industry=' + (industry.includes('__ALL__') ? 'All' : industry.join('/')) +
      '; location=' + (locToks.length ? locToks.join('/') : 'Nationwide') + '; salary=' + salaryFloor + '~' + salaryCeil + 'K; recruitmentType=' + recruitmentType);
  const candidates = [];
  const seen = new Set();
  for (const kw of keywords) {
    for (let pg = 0; pg < maxPages; pg++) {
      let list;
      try { list = await searchJobs(kw, salaryFloorYuan, salaryCeil * 1000, pg, { workExperience: cfg.workExperience, eduLevel: cfg.eduLevel, compNature: cfg.compNature }); }
      catch (e) { log('Search interrupted:', e.message); break; }
      if (list.length === 0) break;
      for (const j of list) {
        const id = Number(j.jobId);
        if (!id || seen.has(id)) continue;
        const sal = parseSalary(j.salary);
        // Salary: on parse failure do not filter (avoid false kill); only filter when parseable and genuinely out of floor/ceiling
        if (salaryFloor > 0 && sal.floor !== null && sal.floor < salaryFloor) continue;
        if (sal.ceil !== null && sal.ceil > salaryCeil) continue;
        // Industry: any of multiple keywords contains → pass (OR)
        if (!industry.includes('__ALL__') && !industry.some((ind) => (j.industry || '').includes(ind))) continue;
        // Location: any of multiple cities contains → pass (OR); nationwide (__ALL__) unrestricted
        if (locToks.length && !locToks.some((lc) => (j.location || '').includes(lc))) continue;
        // Level: job title already merges "role+level", no separate level filter
        seen.add(id);
        candidates.push({ ...j, jobId: id, recruiter: isRecruiterJob(j) });
      }
    }
  }

  // 2) Recruitment-type filter
  let filtered = candidates;
  if (recruitmentType === 'nonRecruiter') filtered = candidates.filter((c) => !c.recruiter);
  else if (recruitmentType === 'recruiter') filtered = candidates.filter((c) => c.recruiter);
  else filtered.sort((a, b) => (a.recruiter ? 1 : 0) - (b.recruiter ? 1 : 0)); // all: non-recruiter priority

  // 3) De-dup
  const pending = filtered.filter((c) => !delivered.has(c.jobId) && !appliedThisRun.has(c.jobId));
  log(`[Filter result] By your settings, ${pending.length} valid matching roles were found, starting delivery now…`);
  if (pending.length === 0) {
    log('No roles matching current settings, stopped. You can adjust the wizard (keyword / industry / location / salary) and retry.');
    const out = writeReport([], [], counts, quota, false, 'No roles match current settings');
    console.log(SUMMARY_BLOCK(out));
    process.exit(0);
  }

  const results = [];
  const counts = { success: 0, already: 0, fail: 0, unknown: 0 };
  runState.quota = quota;

  // 4) Daily quota
  const remain = dailyCap - quota.count;
  if (remain <= 0) {
    log(`Daily cap ${dailyCap} reached today, stopping. Applied ${quota.count} today.`);
    const out = writeReport(pending, [], counts, quota, true, 'Daily cap reached');
    console.log(SUMMARY_BLOCK(out));
    process.exit(0);
  }
  // Get run mode (v2.3.0 new foreground/background + pre-delivery preview list)
  const runMode = (cfg.runMode === 'background') ? 'background' : 'foreground';
  const toApply = pending.slice(0, remain);
  runState.toApply = toApply;
  if (toApply.length < pending.length) log(`Limited by daily cap ${dailyCap}, applying ${toApply.length} this run (remaining ${remain}), other ${pending.length - toApply.length} left for tomorrow`);

  // ============ v2.3.0: generate pending-application list (pre-delivery preview) ============
  log('');
  log('==================== Pending Application List Preview ====================');
  log('Total ' + toApply.length + ' roles, will be applied one by one:');
  toApply.forEach(function(j, i) {
    log('  [' + (i+1) + '/' + toApply.length + '] ' + j.jobName + ' @ ' + j.company + (j.salary ? ' (' + j.salary + ')' : '') + (j.location ? ' ' + j.location : ''));
  });
  log('Run mode: ' + (runMode === 'foreground' ? 'Foreground (per-item result display)' : 'Background (consolidated report)'));
  log('============================================================');
  log('');

  // 5) First-item pre-check
  if (toApply.length > 0) {
    const first = toApply[0];
    let r0;
    try { r0 = await applyJob(first.jobId, first.jobKind); }
    catch (e) {
      if (e.message === 'RATE_LIMIT_PERSIST') {
        log('Persistent rate-limit >30min, auto-paused; de-dup guarantees safe resume later');
        const out = writeReport(toApply, results, counts, quota, false, 'Persistent rate-limit >30min, auto-paused');
        console.log(SUMMARY_BLOCK(out));
        process.exit(3);
      }
      log('Pre-check failed (persistent rate-limit):', e.message);
      const out = writeReport(toApply, results, counts, quota, false, e.message);
      console.log(SUMMARY_BLOCK(out));
      process.exit(3);
    }
    const e0 = evalResult(r0);
    if (e0.status === 'fail' && /401|unauthorized|/i.test(e0.message)) {
      log('Pre-check 401: Token invalid or no permission, please re-run `liepin-cli setup` to refresh credentials');
      const out = writeReport(toApply, results, counts, quota, false, 'apply permission 401');
      console.log(SUMMARY_BLOCK(out));
      process.exit(2);
    }
    recordOne(first, e0, quota, results, counts);
    if (runMode === 'foreground') {
      log(`[Apply ${1}/${toApply.length}] ${first.jobName} @ ${first.company} (${first.location || ''})｜${statusZh(e0.status)}: ${e0.message}`);
    }
    appendProgress(1, first, e0);
    log(`Pre-check passed, starting bulk delivery (total ${toApply.length})`);
  }

  // 6) Bulk delivery
  let consecutiveFails = 0;
  for (let i = 1; i < toApply.length; i++) {
    if (overRuntime()) {
      log(`Reached max runtime ${Math.round(MAX_RUNTIME_MS / 60000)} min, safe stop and save progress, rerun resumes`);
      const out = writeReport(toApply, results, counts, quota, false, 'Max runtime reached, safe stop');
      console.log(SUMMARY_BLOCK(out));
      process.exit(0);
    }
    const j = toApply[i];
    const seq = i + 1;
    let ev;
    try {
      let resp;
      try { resp = await applyJob(j.jobId, j.jobKind); }
      catch (e) {
        // Persistent rate-limit is global, should abort whole run; other exceptions (timeout / CLI missing / parse fail) degrade single item to fail and continue
        if (e && e.message === 'RATE_LIMIT_PERSIST') {
          log('Persistent rate-limit >30min, auto-paused; de-dup guarantees safe resume later');
          const out = writeReport(toApply, results, counts, quota, false, 'Persistent rate-limit >30min, auto-paused');
          console.log(SUMMARY_BLOCK(out));
          process.exit(3);
        }
        throw e;
      }
      ev = evalResult(resp);
      recordOne(j, ev, quota, results, counts);
    } catch (e) {
      // Single-item exception fallback: never break whole run because of it, mark fail and resume (rerun can retry)
      const msg = (e && e.message) ? String(e.message).slice(0, 160) : 'delivery exception';
      ev = { status: 'fail', message: msg };
      recordOne(j, ev, quota, results, counts);
      log(`[Apply ${seq}/${toApply.length}] ${j.jobName} @ ${j.company} (${j.location || ''})｜Failed (degraded, continuing): ${msg}`);
      appendProgress(seq, j, ev);
      consecutiveFails += 1;
      if (consecutiveFails >= CIRCUIT_FAIL_LIMIT) {
        log(`Consecutive ${CIRCUIT_FAIL_LIMIT} delivery failures, likely token invalid or API anomaly, circuit-broken; de-dup guarantees safe rerun later`);
        const out = writeReport(toApply, results, counts, quota, false, `Consecutive ${CIRCUIT_FAIL_LIMIT} failures, likely token invalid, circuit-broken`);
        console.log(SUMMARY_BLOCK(out));
        process.exit(3);
      }
      await sleep(1500);
      continue;
    }
    // v2.3.0: foreground/background mode — foreground shows per-item, background only counts
    if (runMode === 'foreground') {
      log(`[Apply ${seq}/${toApply.length}] ${j.jobName} @ ${j.company} (${j.location || ''})｜${statusZh(ev.status)}: ${ev.message}`);
    }
    appendProgress(seq, j, ev);
    if (ev.status === 'fail') {
      consecutiveFails += 1;
      if (consecutiveFails >= CIRCUIT_FAIL_LIMIT) {
        log(`Consecutive ${CIRCUIT_FAIL_LIMIT} delivery failures, likely token invalid or API anomaly, circuit-broken; de-dup guarantees safe rerun later`);
        const out = writeReport(toApply, results, counts, quota, false, `Consecutive ${CIRCUIT_FAIL_LIMIT} failures, likely token invalid, circuit-broken`);
        console.log(SUMMARY_BLOCK(out));
        process.exit(3);
      }
    } else {
      consecutiveFails = 0;
    }
    await sleep(1500);
  }

  const out = writeReport(toApply, results, counts, quota, false, null);
  console.log(SUMMARY_BLOCK(out));
}

function SUMMARY_BLOCK(out) {
  const c = out.summary;
  return [
    '========== Delivery Result ==========',
    `Total:${c.total}  Processed:${c.applied}`,
    `Success:${c.success}  Already:${c.already}  Fail:${c.fail}  Unknown:${c.unknown}`,
    `Applied today:${out.dailyQuota.count}${out.quotaReached ? ' (cap reached)' : ''}`,
    out.note ? `Note:${out.note}` : '',
    `Report:${REPORT_PATH}`,
    `Summary:${SUMMARY_PATH}`,
    out.quotaReached ? '' : ' (first real-response field names [needs verification]: see ' + PROBE_SEARCH + ' / ' + PROBE_APPLY + ')',
    '==============================',
  ].filter(Boolean).join('\n');
}

// ---------------- Graceful interruption handling ----------------
function onInterrupt(sig) {
  log(`Received ${sig}, saving progress and exiting… (de-dup guarantees safe resume)`);
  try {
    runState.note = `User interrupted (${sig}), progress safely saved, rerun to resume`;
    writeReport(runState.toApply, runState.results, runState.counts, runState.quota, false, runState.note);
  } catch (e) {}
  process.exit(130);
}

module.exports = {
  parseSalary,
  evalResult,
  isRateLimit,
  isRecruiterJob,
  isDirectHireBrand,
  isKnownRecruiterBrand,
  headhunterScore,
  loadDelivered,
  loadQuota,
  splitKeywords,
  normalizeLocation,
  normalizeMulti,
  searchJobs,
  applyJob,
  adaptCliResult,
  extractJobList,
  normalizeJob,
  // v2.3.0 new exports
  authStatus,
  authClear,
  resumeGet,
  resumeSyncBaseInfo,
  resumeSyncSelfAssess,
  resumeSyncWorkExp,
  resumeSyncEduExp,
  resumeAddJobWant,
  ensureJobWant,
  resumeHealthCheck,
};

if (require.main === module) {
  process.on('SIGINT', () => onInterrupt('SIGINT'));
  process.on('SIGTERM', () => onInterrupt('SIGTERM'));
  // Global fallback: any uncaught exception / unhandled rejection dumps full stack then exits, avoid silent exit 1 with no [FATAL]
  process.on('uncaughtException', (e) => { flushExit(1, '[FATAL-uncaughtException] ' + (e && e.stack ? e.stack : e)); });
  process.on('unhandledRejection', (reason) => { flushExit(1, '[FATAL-unhandledRejection] ' + (reason && reason.stack ? reason.stack : String(reason))); });
  main().catch((e) => { flushExit(1, '[FATAL] ' + (e && e.stack ? e.stack : (e && e.message ? e.message : e))); });
}
