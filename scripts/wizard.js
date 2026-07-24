// 猎聘投递向导 · Web 版需求收集器（单弹窗，一次性填完）
// 零外部依赖：仅 Node 标准库 http + fs + path
// 用法：node scripts/wizard.js  →  打印 WIZARD_URL=http://127.0.0.1:PORT
//       用户在浏览器打开该 URL 填表提交 → 写 liepin_wizard_config.json → 服务关闭并退出
// 偏好记忆：启动时若工作区已存在 liepin_wizard_config.json，自动把上次填写的值预填进表单。

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const WORKDIR = process.cwd();
const HTML_PATH = path.join(__dirname, 'wizard.html');
const CONFIG_PATH = path.join(WORKDIR, 'liepin_wizard_config.json');

let hasResume = false; // 默认认为无简历

// ---------------- 检查猎聘用户是否有简历 ----------------
// 调 `liepin-cli resume get`：成功 = 有简历；失败 = 无简历/token失效
function checkResumeExists() {
  // 找 CLI 二进制（与 apply_pipeline.js 同一套逻辑）
  const home = os.homedir();
  const cands = [
    process.env.LIEPIN_CLI_BIN,
    path.join(home, '.workbuddy', 'binaries', 'python', 'envs', 'liepin-cli', 'Scripts', 'liepin-cli.exe'),
    path.join(home, '.workbuddy', 'binaries', 'python', 'envs', 'liepin-cli', 'bin', 'liepin-cli'),
    'liepin-cli',
  ].filter(Boolean);
  for (const bin of cands) {
    try {
      const r = spawnSync(bin, ['resume', 'get', '--output', 'json'], { windowsHide: true, timeout: 10000, encoding: 'utf8' });
      if (r.status === 0) {
        try {
          const data = JSON.parse(r.stdout);
          if (data && (data.resumeId || data.baseInfo || data.name || JSON.stringify(data).length > 50)) {
            return true; // 有简历
          }
        } catch (e) {}
        return false; // 空响应 = 无简历
      }
      if (r.stderr && r.stderr.includes('token')) return false; // token问题默认无简历
    } catch (e) { continue; }
  }
  return false; // 拿不到CLI也当无简历
}

const html = fs.readFileSync(HTML_PATH, 'utf8');

// ---------------- 输入归一化（与 apply_pipeline.js 保持同一套规则） ----------------
const KEYWORD_SEP = /[,，、;；\s]+/;
function splitKeywords(v) {
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(KEYWORD_SEP).map((s) => s.trim()).filter(Boolean);
  return [];
}
function normalizeLocation(v) {
  if (v === undefined || v === null) return '__ALL__';
  const s = String(v).trim();
  if (s === '' || s === '__ALL__' || s === '不限') return '__ALL__';
  return s;
}
function normalizeMulti(v) {
  if (Array.isArray(v)) {
    const a = v.map((s) => String(s).trim()).filter(Boolean);
    if (!a.length || a.includes('__ALL__') || a.includes('不限')) return ['__ALL__'];
    return a;
  }
  if (typeof v === 'string') {
    const a = v.split(KEYWORD_SEP).map((s) => s.trim()).filter(Boolean);
    if (!a.length || a.includes('__ALL__') || a.includes('不限')) return ['__ALL__'];
    return a;
  }
  return ['__ALL__'];
}

// ---------------- 读取已有配置，构造预填数据（偏好记忆） ----------------
function buildPrefill() {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const kw = splitKeywords(c.keywords).join('，');
    return {
      keywords: kw,
      industry: Array.isArray(c.industry) ? c.industry : ['__ALL__'],
      location: (c.location && c.location !== '__ALL__') ? c.location : '不限',
      salaryFloor: (c.salaryFloor != null) ? c.salaryFloor : 25,
      salaryCeil: (c.salaryCeil != null) ? c.salaryCeil : 500,
      recruitmentType: ['nonRecruiter', 'recruiter', 'all'].includes(c.recruitmentType) ? c.recruitmentType : 'nonRecruiter',
      dailyCap: (c.dailyCap && c.dailyCap >= 1) ? c.dailyCap : 50,
      unattended: c.unattended === true,
      schedule: c.schedule || '0 9 * * *',
    };
  } catch (e) {
    return null; // 无历史配置：空白表单
  }
}

// 检查猎聘是否有简历 + 预填数据
const prefill = buildPrefill();
hasResume = checkResumeExists();

// 注入 resume 状态 + 预填数据到 HTML
let injectScript = '<script>window.__HAS_RESUME__=' + hasResume + ';';
if (prefill) injectScript += 'window.__PREFILL__=' + JSON.stringify(prefill).replace(/</g, '\\u003c') + ';';
injectScript += '</script>';
const servedHtml = html.replace('</head>', injectScript + '</head>');

if (hasResume) console.log('HAS_RESUME=true（已检测到简历，不显示简历字段）');
else console.log('HAS_RESUME=false（未检测到简历，向导中将显示简历字段）');

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
        res.end(JSON.stringify({ ok: false, message: '配置不是合法 JSON' }));
        return;
      }
      // 关键词：必须能拆出至少一个（防御字符串/数组混用）
      const kws = splitKeywords(cfg.keywords);
      if (!kws.length) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: '缺少岗位关键词' }));
        return;
      }
      const safe = {
        keywords: kws,
        industry: normalizeMulti(cfg.industry),
        location: normalizeLocation(cfg.location),
        salaryFloor: Number(cfg.salaryFloor) || 0,
        salaryCeil: Number(cfg.salaryCeil) || 999,
        // 岗位名称已合并「岗位+职级」，层级不再单独过滤，恒为全量
        levels: ['__ALL__'],
        recruitmentType: ['nonRecruiter', 'recruiter', 'all'].includes(cfg.recruitmentType) ? cfg.recruitmentType : 'nonRecruiter',
        dailyCap: Math.max(1, parseInt(cfg.dailyCap, 10) || 50),
        maxPages: parseInt(cfg.maxPages, 10) || 6,
        runMode: ['foreground', 'background'].includes(cfg.runMode) ? cfg.runMode : 'foreground',
      };
      // 自动化运行字段（如有）
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
        res.end(JSON.stringify({ ok: false, message: '写配置失败: ' + e.message }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: CONFIG_PATH, autoRun: true }));
      console.log('CONFIG_WRITTEN=' + CONFIG_PATH);
      console.log('AUTO_RUN_START=需求已提交，立即自动运行 apply_pipeline.js（全程无需用户操作）');
      // 响应已发给前端；保持服务进程存活，前台启动投递管道并把输出实时透传，结束即退出
      const child = spawn(process.execPath, [path.join(__dirname, 'apply_pipeline.js')], {
        cwd: WORKDIR,
        stdio: 'inherit',
        env: process.env,
      });
      child.on('error', (e) => {
        console.error('投递进程启动失败：' + e.message);
        server.close();
        process.exit(1);
      });
      child.on('exit', (code) => {
        console.log('PIPELINE_DONE=apply_pipeline.js 退出码 ' + (code || 0));
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
  if (prefill) console.log('PREFILL=上次偏好已载入（' + prefill.keywords + '）');
});
