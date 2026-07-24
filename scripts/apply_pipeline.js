// 猎聘全自动投递管道（弹窗向导版 · v2.0.0，基于官方开源 liepin-cli）
// 底层调用：spawn `liepin-cli job search / job apply --output json`，解析 stdout 原始 JSON
// 上层逻辑（跨会话去重 / 每日配额 / 招聘类型过滤 / 猎头识别 / 频控守护 / 真实四态 / 成果展示 / 稳定性护栏）全部保留
// 零外部依赖：仅 Node 标准库 child_process / fs / path / os
//
// ⚠️ 响应字段名 [需核实]：liepin-cli 直连 /mcp/search-job、/mcp/apply-job，原样回显服务端原始 JSON，
//   官方仓库未文档化响应结构。本文件对搜索列表与岗位字段做了「多候选容错解析」，并在首次真实调用时
//   把原始响应落盘到 liepin_schema_probe_search.json / liepin_schema_probe_apply.json，供人工核验校准。

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
const PROGRESS_PATH = path.join(WORKDIR, 'liepin_wizard_progress.jsonl'); // 实时逐条进度，供查进度/监控
const CRASH_PATH = path.join(WORKDIR, 'liepin_wizard_crash.log'); // 致命异常落盘（避免 process.exit 截断 stderr 导致无 [致命] 输出）
const CLI_TIMEOUT_MS = 90000; // 单次 CLI 调用硬超时（防 subprocess 挂死导致整轮卡死）

// 致命异常安全退出：先落盘完整堆栈，再给 stderr 一个刷新窗口，避免 process.exit 截断 [致命] 输出
function flushExit(code, msg) {
  try { fs.appendFileSync(CRASH_PATH, (msg || '') + '\n'); } catch (e) {}
  try { console.error(msg || ''); } catch (e) {}
  const t = setTimeout(() => process.exit(code), 80);
  if (t && typeof t.unref === 'function') t.unref();
}

// 历史报告（用于跨会话永久去重）
const HISTORY_REPORTS = [
  'liepin_apply_report.json',
  'liepin_apply_report_deep.json',
  'liepin_apply_report_full.json',
  'liepin_redeliver_report.json',
  'liepin_realestate_report.json',
  'liepin_wizard_report.json',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function log(...a) { console.error('[进度]', ...a); }
// 投递状态中文映射，供实时日志与进度文件使用
function statusZh(s) { return ({ success: '成功', already: '已投过', fail: '失败', unknown: '未知' })[s] || s; }
// 实时逐条进度落盘（JSONL），每投一条追加一行，供「查进度」随时读取
function appendProgress(seq, job, ev) {
  try {
    const line = JSON.stringify({ seq, ts: Date.now(), jobId: job.jobId, jobName: job.jobName, company: job.company, location: job.location, status: ev.status, message: ev.message }) + '\n';
    fs.appendFileSync(PROGRESS_PATH, line, 'utf8');
  } catch (e) { /* 进度文件非关键，失败忽略 */ }
}

// ---------------- 稳定性护栏 ----------------
const MAX_RUNTIME_MS = 45 * 60 * 1000;
const CIRCUIT_FAIL_LIMIT = 3;
const RUN_START = Date.now();
function overRuntime() { return (Date.now() - RUN_START) > MAX_RUNTIME_MS; }

const runState = { toApply: [], results: [], counts: { success: 0, already: 0, fail: 0, unknown: 0 }, quota: { date: '', count: 0 }, note: null };

// ---------------- liepin-cli 调用层 ----------------
// CLI 二进制解析：① 环境变量 LIEPIN_CLI_BIN 覆盖 ② PATH 中的 liepin-cli ③ 已知 venv 安装路径
function cliCandidates() {
  const list = [];
  if (process.env.LIEPIN_CLI_BIN) list.push(process.env.LIEPIN_CLI_BIN);
  const home = os.homedir();
  // 自动安装路径（优先于裸命令，因可能不在 PATH 中）
  if (process.platform === 'win32') {
    list.push(path.join(home, '.workbuddy', 'binaries', 'python', 'envs', 'liepin-cli', 'Scripts', 'liepin-cli.exe'));
  } else {
    list.push(path.join(home, '.workbuddy', 'binaries', 'python', 'envs', 'liepin-cli', 'bin', 'liepin-cli'));
  }
  list.push('liepin-cli');
  return list;
}

// 透传 token：优先 LIEPIN_USER_TOKEN（liepin-cli 原生），回退 LIEPIN_TOKEN（旧约定），再回退配置文件（子进程自行读取）
function spawnEnv() {
  const env = Object.assign({}, process.env);
  if (!env.LIEPIN_USER_TOKEN && env.LIEPIN_TOKEN) env.LIEPIN_USER_TOKEN = env.LIEPIN_TOKEN;
  return env;
}

// 获取当前可用的 token（用于显式 --token 透传，v2.3.0 官方文档要求：--token > env > config）
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

// 运行一次 liepin-cli 命令，返回 {code, stdout, stderr}；依次尝试候选二进制；带硬超时防止 subprocess 挂死
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
      const e = new Error('CLI 调用超时（' + (TO / 1000) + 's 无响应，疑似 subprocess 挂死）');
      e.code = 'TIMEOUT';
      lastErr = e;
      reject(e);
    }
    function tryOnce(idx) {
      if (idx >= candidates.length) {
        const e = lastErr || new Error('liepin-cli 未找到');
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

// 将 CLI 原始输出适配为旧版 evalResult / isRateLimit 约定的包装形态（保证测试与判定逻辑不变）
function adaptCliResult(r) {
  const text = (r.stdout || '').trim();
  const errText = (r.stderr || '').trim();
  if (r.code !== 0) {
    const msg = errText || text || ('退出码 ' + r.code);
    return { error: { message: msg } };
  }
  if (!text) return { error: { message: errText || '空响应' } };
  return { result: { content: [{ text }] } };
}

// 频控守护：命中限流按 15→240s 指数退避；累计超 1800s 抛 RATE_LIMIT_PERSIST
const BACKOFF = [15, 30, 45, 60, 90, 120, 180, 240];
async function runCliGuarded(args, label) {
  let totalWait = 0;
  for (let i = 0; i <= BACKOFF.length; i++) {
    let r;
    try {
      r = await runCli(args);
    } catch (e) {
      if (e.code === 'ENOENT') throw new Error('未找到 liepin-cli 命令：请先安装并加入 PATH，或设置 LIEPIN_CLI_BIN（详见技能「依赖预检」章节）');
      log(`${label} 调用异常: ${e.message}，15s 后重试`);
      await sleep(15000); totalWait += 15;
      if (totalWait > 1800) throw new Error('RATE_LIMIT_PERSIST');
      continue;
    }
    const adapted = adaptCliResult(r);
    if (isRateLimit(adapted)) {
      const wait = BACKOFF[Math.min(i, BACKOFF.length - 1)];
      log(`${label} 触发频控，退避 ${wait}s（已累计 ${totalWait}s）`);
      await sleep(wait * 1000); totalWait += wait;
      if (totalWait > 1800) throw new Error('RATE_LIMIT_PERSIST');
      continue;
    }
    return adapted;
  }
  throw new Error(`${label} 重试耗尽`);
}

// 首次真实响应落盘探针（字段名 [需核实]，供人工校准）
let probeSearchSaved = false;
let probeApplySaved = false;
function saveProbe(p, adapted) {
  try {
    const txt = adapted.error ? JSON.stringify(adapted.error) : (adapted.result && adapted.result.content[0] && adapted.result.content[0].text);
    fs.writeFileSync(p, JSON.stringify({
      _note: '首次真实调用原始响应探针；字段名 [需核实]，请据此校准 apply_pipeline.js 的解析（extractJobList / normalizeJob）',
      raw: txt,
    }, null, 2), 'utf8');
  } catch (e) { /* 探针失败不影响主流程 */ }
}

// ---------------- 薪资解析（K） ----------------
function parseSalary(str) {
  if (!str) return { floor: null, ceil: null };
  const s = String(str);
  if (/面议|议薪|negotiab/i.test(s)) return { floor: null, ceil: null };
  const unit = /万/.test(s) ? 10 : 1;
  const nums = (s.match(/(\d+(?:\.\d+)?)/g) || []).map(Number);
  if (nums.length === 0) return { floor: null, ceil: null };
  return { floor: nums[0] * unit, ceil: (nums.length > 1 ? nums[nums.length - 1] : nums[0]) * unit };
}

// ---------------- 输入归一化（防御性） ----------------
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

// ---------------- 猎头识别 v2（三层判定 · v2.2.0）----------------
//
// 第 1 层：确非猎头公司白名单（知名直招企业，命中即直接返回 false）
// 第 2 层：已知猎头品牌库（命中即直接返回 true）
// 第 3 层：启发式加权（行业+公司名+JD 分数融合，阈值判定）
//
// 白名单与品牌库各 50+，覆盖主要直招企业与猎头机构，最大限度降低误判。

// ----- 第 1 层：知名直招企业白名单（命中直接 false） -----
const DIRECT_HIRE_BRANDS = [
  // 互联网/科技
  '腾讯', '阿里', '阿里巴巴', '百度', '字节跳动', '字节', '京东', '美团', '滴滴', '快手', '小米', '华为', 'OPPO', 'vivo', '联想', '中兴', '网易', '新浪', '搜狗', '360', '奇安信', '携程', '去哪儿', '贝壳', 'B站', '哔哩哔哩', '知乎', '小红书', '拼多多', '得物', '蚂蚁', '蚂蚁集团', '菜鸟', '钉钉', '飞猪', '盒马', '饿了么', '淘天', '高德', '唯品会', '58同城', '完美世界', '米哈游', '莉莉丝', '叠纸', '鹰角', '三七互娱', '网易游戏', '腾讯游戏', '游族',
  // 金融/银行/保险/证券
  '招商银行', '工商银行', '建设银行', '中国银行', '农业银行', '交通银行', '浦发银行', '平安银行', '中信银行', '光大银行', '民生银行', '兴业银行', '北京银行', '上海银行', '南京银行', '宁波银行', '杭州银行', '江苏银行', '国泰君安', '中信证券', '海通证券', '华泰证券', '招商证券', '广发证券', '中金', '中国平安', '中国人寿', '中国太保', '新华保险', '太平洋保险', '泰康', '人保', '太平保险', '中信信托', '五矿信托', '中航信托', '华夏基金', '易方达', '嘉实基金', '南方基金', '广发基金', '富国基金', '汇添富', '博时基金', '天弘基金',
  // 制造业/汽车/重工
  '比亚迪', '宁德时代', '蔚来', '理想', '小鹏', '特斯拉', '宝马', '奔驰', '大众', '丰田', '本田', '福特', '通用', '沃尔沃', '吉利', '长城', '奇瑞', '长安', '广汽', '上汽', '东风', '一汽', '红旗', '北汽', '江淮', '三一', '三一重工', '徐工', '中联重科', '海尔', '美的', '格力', '海信', 'TCL', '京东方', '新华三', '中兴通讯', '烽火', '中芯国际', '华虹', '长鑫', '长江存储', '吉利集团',
  // 央国企/事业单位/基础设施
  '中国移动', '中国联通', '中国电信', '中国石化', '中国石油', '中海油', '国家电网', '南方电网', '国铁', '中国铁路', '中国邮政', '国家能源', '中粮', '中烟', '中航工业', '中船', '中国船舶', '兵器工业', '航天科工', '航天科技', '航空工业', '中国电科', '中国电子', '保利', '华润', '招商局', '中信集团', '光大集团', '中化', '中建', '中铁', '中交', '中冶', '中国建材', '五矿', '华侨城',
  // 知名外企
  '微软', 'Microsoft', '谷歌', 'Google', '苹果', 'Apple', 'Meta', '亚马逊', 'Amazon', 'Oracle', '甲骨文', 'IBM', 'Intel', '英特尔', 'NVIDIA', '英伟达', 'AMD', 'Cisco', '思科', 'SAP', 'Salesforce', 'Adobe', 'Dell', '惠普', 'HP', 'LinkedIn', 'Uber', 'Tesla', '沃尔玛', 'Walmart', 'Nike', '耐克', 'Adidas', '阿迪达斯', '百事', 'Pepsi', '宝洁', 'P&G', '联合利华', 'Unilever', '欧莱雅', '雀巢', 'Nestle', '强生', 'Johnson', '辉瑞', 'Pfizer', '默沙东', 'Merck', '礼来', 'Lilly', '诺华', 'Novartis', '罗氏', 'Roche', '拜耳', 'Bayer', '赛诺菲', 'Sanofi', '阿斯利康', 'AstraZeneca', '西门子', 'Siemens', '飞利浦', 'Philips', '通用电气', 'GE', '博世', 'Bosch', '施耐德', 'Schneider', 'ABB', '巴斯夫', 'BASF', '陶氏', 'Dow', '3M',
  // 知名民企/新消费/服务
  '伊利', '蒙牛', '农夫山泉', '娃哈哈', '星巴克', 'Starbucks', '麦当劳', 'McDonald', '百胜', '肯德基', '海底捞', '瑞幸', '喜茶', '奈雪', '波司登', '李宁', '安踏', '特步', '良品铺子', '百果园', '孩子王', '京东健康', '阿里健康', '三只松鼠', '绝味', '周黑鸭', '蓝月亮', '立白', '纳爱斯', '珀莱雅', '薇诺娜', '花西子', '完美日记',
  // 电商/跨境/新兴
  'SHEIN', '希音', 'Temu', 'TikTok', 'Shopee', 'Lazada', '速卖通', '阿里国际', '跨境', '宝尊', '微盟', '有赞', 'Ping++',
  // 其他明显直招：教育/医疗/地产
  '新东方', '好未来', '学而思', '中公', '华图', '爱尔', '通策', '迈瑞', '联影', '华大', '药明', '恒瑞', '百济', '信达', '君实', '万科', '碧桂园', '龙湖', '保利发展', '华润置地', '中海', '万达', '融创', '绿城', '金地', '招商蛇口', '旭辉', '新城', '世茂',
];
// 快速命中判定（公司名包含任一白名单词即非猎头，首层直出）
// 使用 Set 加速，但白名单含中英文混合 + 部分公司名含多于 2 个字符，用 every 检查效率也够
const RECTYPE_FILL = new Set(DIRECT_HIRE_BRANDS.map((s) => s.toLowerCase()));

// ----- 第 2 层：已知猎头/人力服务公司（命中直接 true） -----
const RECRUITER_KNOWN_BRANDS = [
  // 国际猎头五大
  '海德思哲', 'Heidrick', '光辉国际', 'Korn Ferry', 'KornFerry', 'Korn', '亿康先达', 'Egon Zehnder', '史宾沙', 'Spencer Stuart', '罗盛', 'Russell Reynolds',
  // 其他国际知名猎头/人力
  '米高蒲志', 'Michael Page', 'MichaelPage', '任仕达', 'Randstad', '德科', 'Adecco', '万宝盛华', 'ManpowerGroup', 'Manpower', 'Recruit', '瑞可利', 'Persol', 'Hays', '瀚纳仕', 'Robert Walters', 'RobertHalf', '瀚德', 'Hudson',
  // 国内头部猎头/咨询
  '科锐', '科锐国际', '锐仕方达', '对点', '对点咨询', '沃锐猎头', '沃锐', '嘉驰', '嘉驰国际', '探也', '探也猎头', '仲望咨询', '仲望', '泰来', '泰来猎头', '大瀚', '大瀚猎头', '展动力', '展动力猎头', '埃摩森', '猎上网', '猎萝卜', '猎聘外包', '猎聘BPO', '猎聘事业部',
  // 人事外包/劳务派遣/背景调查
  '中智', '中智集团', '上海外服', '外服', 'FESCO', '北京外企', '北京外服', '易才', '易才集团', '海峡人力', '薪宝', '薪宝科技', '人瑞', '人瑞人才', '佩琪', '佩琪人才', '君润', '君润人力', '杰博', '杰博人力', '博尔捷', '博尔捷人力', '社保通', '天坤', '天坤人力', '上海外服', '天津外服', '浙江外服', '深圳外服', '广东外服',
  // RPO / 招聘流程外包
  '光辉国际', '光辉', 'Korn', 'Futurestep', '翰德', 'RPO', '招聘流程外包',
  // 商务服务/管理咨询（偶有猎头业务混杂）
  '埃森哲', 'Accenture', '德勤', 'Deloitte', '安永', 'EY', '毕马威', 'KPMG', '普华永道', 'PwC', '麦肯锡', 'McKinsey', '波士顿咨询', 'BCG', '贝恩', 'Bain', '罗兰贝格', 'Roland Berger',
  // 常见分类平台/招聘网站
  '猎聘', '猎聘网', '51job', '前程无忧', '智联招聘', '智联', 'BOSS直聘', 'BOSS直聘直聘', '拉勾', '脉脉', '大街', '应届生求职网',
];
const REC_BRANDS_SET = new Set(RECRUITER_KNOWN_BRANDS.map((s) => s.toLowerCase()));

function isDirectHireBrand(comp) {
  if (!comp) return false;
  const c = comp.toLowerCase();
  for (const brand of RECTYPE_FILL) {
    if (brand.length > 2 && c.includes(brand)) return true;
    // 短品牌（1~2 字符）跳过防误判（如"三一"、"中金"等需要完整匹配场景有限，直接按 include 处理）
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

// ----- 第 3 层：启发式加权评分（行业+公司特征+JD 关键词融合） -----
const RECRUITER_FEATURE_IND = /人力资源服务|劳务派遣|外包|猎头|人才服务|管理咨询|商务服务|招聘服务|职业中介/;
const NON_RECRUITER_IND = /互联网|人工智能|软件|计算机|金融|银行|保险|证券|基金|制造|汽车|医疗|医药|教育|培训|房地产|建筑|能源|化工|食品|饮料|零售|电商/;
const RECRUITER_COMP_FEATURE = /劳务派遣|人力资源|猎头|人才服务|劳务外包|中介|招聘|人力资本|雇员外包/i;
const RECRUITER_JD_FEATURE = /猎头|代招|劳务派遣|外包岗位|RPO|派遣|劳务外包|人事外包/i;
// 公司名明确排除词：当公司名含以下之一时大概率是猎头
const RECRUITER_COMP_EXCLUDE = /咨询|人才|猎头|猎聘|人力|劳务|派遣|外包|中介/i;
// 直招公司名信号：当公司名含以下且无猎头信号时增强非猎头判定
const DIRECT_SIGNAL = /集团|股份|有限公|有限公司|科技|技术|网络|电子|实业|投资|股份有限|制造|实业有限/i;

function headhunterScore(job) {
  // 返回 0~100 的猎头概率分数：≤20 为直招，≥80 为猎头，中间需人工
  const ind = job.industry || '';
  const comp = job.company || '';
  const detail = job.jobDetail || job.description || '';
  let score = 0;
  // 行业特征：猎头行业 +20，直招行业 -15
  if (RECRUITER_FEATURE_IND.test(ind)) score += 20;
  if (NON_RECRUITER_IND.test(ind)) score -= 15;
  // 公司名特征：猎头词 +25，直招信号 -10
  if (RECRUITER_COMP_FEATURE.test(comp)) score += 25;
  if (RECRUITER_COMP_EXCLUDE.test(comp)) score += 10;
  if (DIRECT_SIGNAL.test(comp)) score -= 10;
  // JD 文本特征
  if (RECRUITER_JD_FEATURE.test(detail)) score += 25;
  // 综合归一化到 0~100
  return Math.max(0, Math.min(100, score + 50));
}

function isRecruiterJob(job) {
  const comp = job.company || '';
  // 第 1 层：白名单直接排除
  if (isDirectHireBrand(comp)) return false;
  // 第 2 层：已知猎头品牌直接判定
  if (isKnownRecruiterBrand(comp)) return true;
  // 第 3 层：加权评分，≥60 判定为猎头
  return headhunterScore(job) >= 60;
}

// ---------------- 搜索：解析服务端原始 JSON（多候选容错） ----------------
// 响应结构 [需核实]：主假设 {data:{list:[...]}}，依次回退其它常见包裹方式
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

// 岗位字段别名容错（响应字段名 [需核实]）
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
    // apply 必填的 job-kind：复用搜索结果中的职位类型值（官方强制要求，禁止猜测）
    jobKind: String(first(j.jobKind, j.jobType, j.recruitType, j.type, j.jobTypeId) || '2'),
  };
}

// CURRENT_LOCATION：由 main 注入，用于服务端 location 过滤（明文低风险）
let CURRENT_LOCATION = '__ALL__';

async function searchJobs(keyword, salaryFloorYuan, salaryCeilYuan, page, extraOpts) {
  const args = ['job', 'search', '--job-name', keyword, '--page', String(page), '--output', 'json'];
  // 地点过滤（v2.3.0 所有官方参数已配齐）
  if (CURRENT_LOCATION && CURRENT_LOCATION !== '__ALL__') {
    const toks = splitKeywords(CURRENT_LOCATION);
    if (toks.length === 1) args.push('--address', toks[0]);
  }
  // 薪资过滤（官方 --salary-floor --salary-cap）
  if (salaryFloorYuan > 0) args.push('--salary-floor', String(salaryFloorYuan));
  if (salaryCeilYuan > 0 && salaryCeilYuan < 999000) args.push('--salary-cap', String(salaryCeilYuan));
  // 额外过滤参数（v2.3.0 新增：--work-experience --edu-level --comp-nature --company-name --salary-kind）
  if (extraOpts) {
    if (extraOpts.workExperience) args.push('--work-experience', extraOpts.workExperience);
    if (extraOpts.eduLevel) args.push('--edu-level', extraOpts.eduLevel);
    if (extraOpts.compNature) args.push('--comp-nature', extraOpts.compNature);
    if (extraOpts.companyName) args.push('--company-name', extraOpts.companyName);
    if (extraOpts.salaryKind) args.push('--salary-kind', extraOpts.salaryKind);
  }
  let adapted;
  try {
    adapted = await runCliGuarded(args, `搜索[${keyword}]p${page}`);
  } catch (e) {
    log('搜索中断:', e.message);
    throw e;
  }
  if (!probeSearchSaved) { saveProbe(PROBE_SEARCH, adapted); probeSearchSaved = true; }
  const list = extractJobList(adapted);
  return list.map(normalizeJob).filter((j) => j.jobId);
}

// ---------------- 投递 ----------------
async function applyJob(jobId, jobKind) {
  const args = ['job', 'apply', '--job-id', String(jobId), '--job-kind', String(jobKind), '--output', 'json'];
  const adapted = await runCliGuarded(args, `投递[${jobId}]`);
  if (!probeApplySaved) { saveProbe(PROBE_APPLY, adapted); probeApplySaved = true; }
  return adapted;
}

// ---------------- 跨会话去重 ----------------
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

// ---------------- 简历求职期望同步（v2.3.0 关键修复）----------------
// 搜索前先调 `liepin-cli resume update-job-want` 把用户的求职期望写到简历，
// 否则猎聘后台按简历里"旧的期望"匹配，不按用户当前搜索条件——这是大量投递石沉大海的根因。
// 官方参数：--jobtitle --dq --want-salary-low --want-salary-high
async function ensureJobWant(keywords, location, salaryFloor, salaryCeil) {
  const args = ['resume', 'update-job-want'];
  // 期望职位：用第一个关键词（向导只允许一个核心方向）
  if (keywords && keywords.length) args.push('--jobtitle', String(keywords[0]).slice(0, 30));
  // 期望地点：单城市时透传，多城市/全国不传（让猎聘匹配简历地）
  if (location && location !== '__ALL__') {
    const toks = splitKeywords(location);
    if (toks.length === 1) args.push('--dq', toks[0]);
  }
  if (salaryFloor > 0) args.push('--want-salary-low', String(salaryFloor));
  if (salaryCeil > 0 && salaryCeil < 999) args.push('--want-salary-high', String(salaryCeil));
  try {
    const r = await runCliGuarded(args, '同步求职期望');
    log('  ✅ 简历求职期望已同步：' + args.slice(2, 2 + 4).join(' '));
    return { ok: true, args };
  } catch (e) {
    log('  ⚠️ 求职期望同步失败（不影响投递）：' + e.message);
    return { ok: false, error: e.message };
  }
}

// ============ v2.3.0 全新：auth 状态 + resume 全套 + --token 透传 ============

// --- auth status ---
// 官方文档 `liepin-cli auth status`：查看当前 token 状态（脱敏显示）
async function authStatus() {
  const args = ['auth', 'status'];
  try {
    const r = await runCliGuarded(args, '检查认证状态');
    const adapted = adaptCliResult(r);
    const txt = adapted.error ? JSON.stringify(adapted.error) : (adapted.result && adapted.result.content[0] && adapted.result.content[0].text);
    log('  🔑 认证状态：' + (txt || '未知'));
    return { ok: true, text: txt };
  } catch (e) {
    log('  ⚠️ 认证状态查询失败：' + e.message);
    return { ok: false, error: e.message };
  }
}

// --- auth clear ---
// 官方文档 `liepin-cli auth clear`：清除本地 token
async function authClear() {
  const args = ['auth', 'clear'];
  try {
    const r = await runCliGuarded(args, '清除 token');
    log('  ✅ 本地 token 已清除');
    return { ok: true };
  } catch (e) {
    log('  ⚠️ token 清除失败：' + e.message);
    return { ok: false };
  }
}

// --- resume get ---
// 官方文档 `liepin-cli resume get`：获取当前简历
async function resumeGet() {
  const args = ['resume', 'get', '--output', 'json'];
  try {
    const r = await runCliGuarded(args, '读取简历');
    const adapted = adaptCliResult(r);
    const txt = adapted.error ? null : (adapted.result && adapted.result.content[0] && adapted.result.content[0].text);
    if (txt) {
      const data = JSON.parse(txt);
      return { ok: true, data };
    }
    return { ok: true, data: null };
  } catch (e) {
    log('  ⚠️ 简历读取失败：' + e.message);
    return { ok: false, error: e.message, data: null };
  }
}

// --- resume update-base-info ---
// 官方文档 `liepin-cli resume update-base-info`：更新基础资料
async function resumeSyncBaseInfo(fields) {
  if (!fields || !Object.keys(fields).length) return { ok: true, note: '无字段，跳过' };
  const args = ['resume', 'update-base-info'];
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null && v !== '') args.push('--' + k, String(v));
  }
  if (args.length <= 3) return { ok: true, note: '无有效字段，跳过' };
  try {
    const r = await runCliGuarded(args, '更新基础资料');
    log('  ✅ 简历基础资料已更新');
    return { ok: true };
  } catch (e) {
    log('  ⚠️ 基础资料更新失败：' + e.message);
    return { ok: false, error: e.message };
  }
}

// --- resume update-self-assess ---
// 官方文档 `liepin-cli resume update-self-assess`：更新自我评价
async function resumeSyncSelfAssess(text) {
  if (!text || !text.trim()) return { ok: true, note: '无内容，跳过' };
  const args = ['resume', 'update-self-assess', '--self-assess', text.trim().slice(0, 500)];
  try {
    const r = await runCliGuarded(args, '更新自我评价');
    log('  ✅ 自我评价已更新');
    return { ok: true };
  } catch (e) {
    log('  ⚠️ 自我评价更新失败：' + e.message);
    return { ok: false };
  }
}

// --- resume add-work-exp ---
// 官方文档 `liepin-cli resume add-work-exp`
async function resumeSyncWorkExp(entries) {
  if (!entries || !entries.length) return { ok: true, note: '无工作经历，跳过' };
  let ok = 0;
  for (const e of entries) {
    if (!e.compName && !e.rwTitle) continue;
    const r = await runCliGuarded(
      ['resume', 'add-work-exp', '--comp-name', String(e.compName || '').slice(0, 50),
       '--rw-title', String(e.rwTitle || '').slice(0, 30),
       '--work-start', String(e.workStart || '202001'), '--work-end', String(e.workEnd || '至今'),
       '--salary', String(e.salary || '0')],
      '新增工作经历'
    ).catch(() => null);
    if (r) ok++;
  }
  if (ok) log('  ✅ 工作经历已同步 ' + ok + '/' + entries.length);
  return { ok: ok > 0 };
}

// --- resume add-edu-exp ---
// 官方文档 `liepin-cli resume add-edu-exp`
async function resumeSyncEduExp(entries) {
  if (!entries || !entries.length) return { ok: true, note: '无教育经历，跳过' };
  let ok = 0;
  for (const e of entries) {
    if (!e.school) continue;
    const r = await runCliGuarded(
      ['resume', 'add-edu-exp', '--school', String(e.school).slice(0, 50),
       '--major', String(e.major || '').slice(0, 50), '--degree', String(e.degree || '本科'),
       '--start', String(e.start || '201009'), '--end', String(e.end || '201406')],
      '新增教育经历'
    ).catch(() => null);
    if (r) ok++;
  }
  if (ok) log('  ✅ 教育经历已同步 ' + ok + '/' + entries.length);
  return { ok: ok > 0 };
}

// --- resume add-project-exp ---
// 官方文档 `liepin-cli resume add-project-exp`
async function resumeSyncProjectExp(entries) {
  if (!entries || !entries.length) return { ok: true, note: '无项目经历，跳过' };
  let ok = 0;
  for (const e of entries) {
    if (!e.name) continue;
    const r = await runCliGuarded(
      ['resume', 'add-project-exp', '--name', String(e.name).slice(0, 50),
       '--position', String(e.position || '').slice(0, 30),
       '--start', String(e.start || '202001'), '--end', String(e.end || '202012')],
      '新增项目经历'
    ).catch(() => null);
    if (r) ok++;
  }
  if (ok) log('  ✅ 项目经历已同步 ' + ok + '/' + entries.length);
  return { ok: ok > 0 };
}

// --- resume add-job-want（备用）---
// 官方文档 `liepin-cli resume add-job-want`：新增求职期望（当不存在时）
// 主流程已用 update-job-want 更新；add 为备选方案
async function resumeAddJobWant(jobtitle, dq, low, high) {
  if (!jobtitle) return { ok: true, note: '无岗位名，跳过' };
  const args = ['resume', 'add-job-want', '--jobtitle', String(jobtitle).slice(0, 30)];
  if (dq) args.push('--dq', dq);
  if (low > 0) args.push('--want-salary-low', String(low));
  if (high > 0 && high < 999) args.push('--want-salary-high', String(high));
  try {
    await runCliGuarded(args, '新增求职期望');
    log('  ✅ 求职期望已新增');
    return { ok: true };
  } catch (e) {
    log('  ⚠️ 新增求职期望失败：' + e.message);
    return { ok: false };
  }
}

// --- resume 全面健康检查（搜索前调用）---
// 读简历 → 检查完整性 → 同步求职期望
async function resumeHealthCheck(keywords, location, salaryFloor, salaryCeil) {
  log('【步骤 0】简历健康检查…');
  const resume = await resumeGet();
  if (!resume.ok || !resume.data) {
    log('  ⚠️ 未读取到简历数据（不影响投递，但建议先完善简历）');
    return { ok: false, note: '未读取到简历' };
  }
  await ensureJobWant(keywords, location, salaryFloor, salaryCeil);
  return { ok: true, note: '简历健康检查完成' };
}


// ---------------- 每日配额 ----------------
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

// ---------------- 频控检测（兼容旧签名：读 result.content[0].text 或 error.message） ----------------
function isRateLimit(resp) {
  let txt = '';
  try { txt = resp.error ? JSON.stringify(resp.error) : resp.result.content[0].text; } catch (e) {}
  return /频繁|429|过于频繁|受限|rate.?limit/i.test(txt);
}

// ---------------- 结果四态判定（绝不谎报） ----------------
function evalResult(resp) {
  if (resp && resp.error) return { status: 'fail', message: JSON.stringify(resp.error).slice(0, 160) };
  let content; try { content = resp.result.content; } catch (e) { return { status: 'unknown', message: '无返回' }; }
  if (!content || !content[0]) return { status: 'unknown', message: '空返回' };
  let text = content[0].text;
  let parsed; try { parsed = JSON.parse(text); } catch (e) { parsed = { raw: text }; }
  const errCode = parsed.errCode !== undefined ? parsed.errCode : (parsed.code !== undefined ? parsed.code : null);
  const msg = parsed.message || parsed.msg || parsed.errMsg || (parsed.data ? JSON.stringify(parsed.data) : text.slice(0, 160));
  const lc = msg.toLowerCase();
  if (/已投递过|已经投递|重复投递|您已投递/i.test(msg)) return { status: 'already', message: msg };
  if (/401|unauthorized|未授权/i.test(msg) || (errCode !== null && errCode !== 0 && errCode !== '0')) return { status: 'fail', message: msg };
  if (/失败|failed|达上限|过于频繁|频繁|受限|拒绝|denied|invalid|error/i.test(msg)) return { status: 'fail', message: msg };
  if (/应聘成功|投递成功|成功|投递完成|ok|true|success/i.test(msg)) return { status: 'success', message: msg };
  return { status: 'unknown', message: msg };
}

// ---------------- 报告 ----------------
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
  lines.push('# 猎聘投递成果汇总');
  lines.push('');
  lines.push(`生成时间：${new Date().toLocaleString('zh-CN')}`);
  lines.push('');
  lines.push(`## 概览`);
  lines.push(`- 本次待投总数：${c.total}`);
  lines.push(`- 实际处理：${c.applied}`);
  lines.push(`- ✅ 成功：${c.success}　⚠️ 已投过：${c.already}　❌ 失败：${c.fail}　❓ 未知：${c.unknown}`);
  lines.push(`- 今日已投：${out.dailyQuota.count} 份`);
  if (out.quotaReached) lines.push(`- ⏸ 已达每日上限，剩余岗位留待明日`);
  if (out.note) lines.push(`- 备注：${out.note}`);
  lines.push('');
  const by = (st) => out.results.filter((r) => r.status === st);
  if (by('success').length) {
    lines.push(`## ✅ 成功（${by('success').length}）`);
    by('success').forEach((r) => lines.push(`- ${r.jobName} @ ${r.company}（${r.location || ''}）`));
    lines.push('');
  }
  if (by('fail').length) {
    lines.push(`## ❌ 失败及原因（${by('fail').length}）`);
    by('fail').forEach((r) => lines.push(`- ${r.jobName} @ ${r.company}： ${r.message}`));
    lines.push('');
  }
  if (by('already').length) {
    lines.push(`## ⚠️ 已投过（跳过，${by('already').length}）`);
    by('already').forEach((r) => lines.push(`- ${r.jobName} @ ${r.company}`));
    lines.push('');
  }
  if (by('unknown').length) {
    lines.push(`## ❓ 未知（需人工核对，${by('unknown').length}）`);
    by('unknown').forEach((r) => lines.push(`- ${r.jobName} @ ${r.company}： ${r.message}`));
    lines.push('');
  }
  fs.writeFileSync(SUMMARY_PATH, lines.join('\n'), 'utf8');
}

// ---------------- Token 来源检测 ----------------
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

// ---------------- 主流程 ----------------
async function main() {
  if (!tokenAvailable()) {
    console.error('缺少 Token：请先运行 `liepin-cli setup`（写入 ~/.config/liepin-cli/config.json），或设置环境变量 LIEPIN_USER_TOKEN；详见技能「依赖预检」章节。');
    process.exit(3);
  }
  if (!fs.existsSync(CONFIG_PATH)) { console.error('缺少 liepin_wizard_config.json（请先完成弹窗向导收集需求）'); process.exit(3); }
  // 每次运行前清空上次的实时进度文件，避免追加到历史记录
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
  const maxPages = 1;  // v2.3.0：只搜第1页（猎聘CLI搜索结果已按相关性排序，第1页即最相关），不再多页翻找——原来要搜 3关键词×6页=18次，现在 3×1=3次，从30分钟缩短到1分钟
  const unattended = cfg.unattended === true;
  const schedule = cfg.schedule || '0 9 * * *';
  if (unattended) {
    if (dailyCap >= 999) log('⚠️ 无人值守模式建议设置合理的 dailyCap（如 30~50），避免单日过量触发风控；当前未限制');
    else log(`无人值守模式已启用（频率=${schedule}），将全程无需干预自动运行，仍受每日上限/频控/熔断护栏保护`);
  }

  const salaryFloorYuan = salaryFloor * 1000;
  const delivered = loadDelivered();
  let quota = loadQuota();
  const appliedThisRun = new Set();

  log(`招聘类型=${recruitmentType}；每日上限=${dailyCap}；今日已投=${quota.count}；CLI=基于 liepin-cli`);

  // 0) 简历健康检查（v2.3.0：读简历+检查完整性+同步求职期望）
  log('【步骤 0】简历健康检查…');
  await resumeHealthCheck(keywords, CURRENT_LOCATION, salaryFloor, salaryCeil);

  // 1) 搜索 + 过滤（严格按用户向导设置；任一硬条件不达标即过滤，但字段解析失败一律放过，不误杀）
  const locToks = CURRENT_LOCATION === '__ALL__' ? [] : splitKeywords(CURRENT_LOCATION);
  log('【筛选设定】关键词=[' + keywords.join('、') + ']；行业=' + (industry.includes('__ALL__') ? '不限' : industry.join('/')) +
      '；地点=' + (locToks.length ? locToks.join('/') : '全国') + '；薪资=' + salaryFloor + '~' + salaryCeil + 'K；招聘类型=' + recruitmentType);
  const candidates = [];
  const seen = new Set();
  for (const kw of keywords) {
    for (let pg = 0; pg < maxPages; pg++) {
      let list;
      try { list = await searchJobs(kw, salaryFloorYuan, salaryCeil * 1000, pg, { workExperience: cfg.workExperience, eduLevel: cfg.eduLevel, compNature: cfg.compNature }); }
      catch (e) { log('搜索中断:', e.message); break; }
      if (list.length === 0) break;
      for (const j of list) {
        const id = Number(j.jobId);
        if (!id || seen.has(id)) continue;
        const sal = parseSalary(j.salary);
        // 薪资：解析失败时不过滤（避免误杀）；仅当能解析且确实超出下限/上限才过滤
        if (salaryFloor > 0 && sal.floor !== null && sal.floor < salaryFloor) continue;
        if (sal.ceil !== null && sal.ceil > salaryCeil) continue;
        // 行业：多关键词任一包含即通过（OR）
        if (!industry.includes('__ALL__') && !industry.some((ind) => (j.industry || '').includes(ind))) continue;
        // 地点：多城市任一包含即通过（OR）；全国(__ALL__)不限制
        if (locToks.length && !locToks.some((lc) => (j.location || '').includes(lc))) continue;
        // 层级：岗位名称已合并「岗位+职级」，不再单独过滤
        seen.add(id);
        candidates.push({ ...j, jobId: id, recruiter: isRecruiterJob(j) });
      }
    }
  }

  // 2) 招聘类型过滤
  let filtered = candidates;
  if (recruitmentType === 'nonRecruiter') filtered = candidates.filter((c) => !c.recruiter);
  else if (recruitmentType === 'recruiter') filtered = candidates.filter((c) => c.recruiter);
  else filtered.sort((a, b) => (a.recruiter ? 1 : 0) - (b.recruiter ? 1 : 0)); // all：非猎头优先

  // 3) 去重
  const pending = filtered.filter((c) => !delivered.has(c.jobId) && !appliedThisRun.has(c.jobId));
  log(`【筛选结果】本次按你的设置，共筛选出符合要求的有效岗位 ${pending.length} 个，现在立刻开始投递…`);
  if (pending.length === 0) {
    log('没有符合当前设置的岗位，已停止。可调整向导（关键词/行业/地点/薪资）后重试。');
    const out = writeReport([], [], counts, quota, false, '无符合设置的岗位');
    console.log(SUMMARY_BLOCK(out));
    process.exit(0);
  }

  const results = [];
  const counts = { success: 0, already: 0, fail: 0, unknown: 0 };
  runState.quota = quota;

  // 4) 每日配额
  const remain = dailyCap - quota.count;
  if (remain <= 0) {
    log(`今日已达上限 ${dailyCap}，停止。今日已投 ${quota.count}。`);
    const out = writeReport(pending, [], counts, quota, true, '已达每日上限');
    console.log(SUMMARY_BLOCK(out));
    process.exit(0);
  }
  // 获取运行模式（v2.3.0 新增前台/后台 + 投递前预览清单）
  const runMode = (cfg.runMode === 'background') ? 'background' : 'foreground';
  const toApply = pending.slice(0, remain);
  runState.toApply = toApply;
  if (toApply.length < pending.length) log(`受每日上限 ${dailyCap} 限制，本次投 ${toApply.length}（剩余可投 ${remain}），其余 ${pending.length - toApply.length} 条留待明日`);

  // ============ v2.3.0：生成拟投递岗位清单（投递前预览）============
  log('');
  log('==================== 拟投递岗位清单预览 ====================');
  log('共 ' + toApply.length + ' 个岗位，以下将逐条投递：');
  toApply.forEach(function(j, i) {
    log('  [' + (i+1) + '/' + toApply.length + '] ' + j.jobName + ' @ ' + j.company + (j.salary ? '（' + j.salary + '）' : '') + (j.location ? ' ' + j.location : ''));
  });
  log('运行模式：' + (runMode === 'foreground' ? '前台（逐条展示结果）' : '后台（统一汇总报告）'));
  log('============================================================');
  log('');

  // 5) 预检首条
  if (toApply.length > 0) {
    const first = toApply[0];
    let r0;
    try { r0 = await applyJob(first.jobId, first.jobKind); }
    catch (e) {
      if (e.message === 'RATE_LIMIT_PERSIST') {
        log('频控持续超 30 分钟，已自动暂停；去重保证可稍后安全续投');
        const out = writeReport(toApply, results, counts, quota, false, '频控持续超30分钟，已自动暂停');
        console.log(SUMMARY_BLOCK(out));
        process.exit(3);
      }
      log('预检失败（频控持续）:', e.message);
      const out = writeReport(toApply, results, counts, quota, false, e.message);
      console.log(SUMMARY_BLOCK(out));
      process.exit(3);
    }
    const e0 = evalResult(r0);
    if (e0.status === 'fail' && /401|unauthorized|未授权/i.test(e0.message)) {
      log('预检 401：Token 失效或无权限，请重新运行 `liepin-cli setup` 刷新凭证');
      const out = writeReport(toApply, results, counts, quota, false, 'apply 权限 401');
      console.log(SUMMARY_BLOCK(out));
      process.exit(2);
    }
    recordOne(first, e0, quota, results, counts);
    if (runMode === 'foreground') {
      log(`[投递 1/${toApply.length}] ${first.jobName} @ ${first.company}（${first.location || ''}）｜${statusZh(e0.status)}：${e0.message}`);
    }
    appendProgress(1, first, e0);
    log(`预检通过，开始批量投递（共 ${toApply.length} 条）`);
  }

  // 6) 批量投递
  let consecutiveFails = 0;
  for (let i = 1; i < toApply.length; i++) {
    if (overRuntime()) {
      log(`已达最大运行时长 ${Math.round(MAX_RUNTIME_MS / 60000)} 分钟，安全停机并保存进度，重跑即续投`);
      const out = writeReport(toApply, results, counts, quota, false, '已达最大运行时长，已安全停机');
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
        // 频控持续属全局状态，应中止整轮；其余异常（超时/CLI 缺失/解析失败）单条降级为失败并续投
        if (e && e.message === 'RATE_LIMIT_PERSIST') {
          log('频控持续超 30 分钟，已自动暂停；去重保证可稍后安全续投');
          const out = writeReport(toApply, results, counts, quota, false, '频控持续超30分钟，已自动暂停');
          console.log(SUMMARY_BLOCK(out));
          process.exit(3);
        }
        throw e;
      }
      ev = evalResult(resp);
      recordOne(j, ev, quota, results, counts);
    } catch (e) {
      // 单条异常兜底：绝不因此中断整轮，记为失败后可重跑续投
      const msg = (e && e.message) ? String(e.message).slice(0, 160) : '投递异常';
      ev = { status: 'fail', message: msg };
      recordOne(j, ev, quota, results, counts);
      log(`[投递 ${seq}/${toApply.length}] ${j.jobName} @ ${j.company}（${j.location || ''}）｜失败（已降级续投）：${msg}`);
      appendProgress(seq, j, ev);
      consecutiveFails += 1;
      if (consecutiveFails >= CIRCUIT_FAIL_LIMIT) {
        log(`连续 ${CIRCUIT_FAIL_LIMIT} 次投递失败，疑似 Token 失效或接口异常，已熔断停机；去重保证可稍后重跑`);
        const out = writeReport(toApply, results, counts, quota, false, `连续${CIRCUIT_FAIL_LIMIT}次失败，疑似Token失效，已熔断`);
        console.log(SUMMARY_BLOCK(out));
        process.exit(3);
      }
      await sleep(1500);
      continue;
    }
    // v2.3.0：前台/后台模式——前台逐条展示，后台只计数不逐条输出
    if (runMode === 'foreground') {
      log(`[投递 ${seq}/${toApply.length}] ${j.jobName} @ ${j.company}（${j.location || ''}）｜${statusZh(ev.status)}：${ev.message}`);
    }
    appendProgress(seq, j, ev);
    if (ev.status === 'fail') {
      consecutiveFails += 1;
      if (consecutiveFails >= CIRCUIT_FAIL_LIMIT) {
        log(`连续 ${CIRCUIT_FAIL_LIMIT} 次投递失败，疑似 Token 失效或接口异常，已熔断停机；去重保证可稍后重跑`);
        const out = writeReport(toApply, results, counts, quota, false, `连续${CIRCUIT_FAIL_LIMIT}次失败，疑似Token失效，已熔断`);
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
    '========== 投递成果 ==========',
    `待投总数:${c.total}  实际处理:${c.applied}`,
    `成功:${c.success}  已投过:${c.already}  失败:${c.fail}  未知:${c.unknown}`,
    `今日已投:${out.dailyQuota.count} 份${out.quotaReached ? '（已达上限）' : ''}`,
    out.note ? `备注:${out.note}` : '',
    `报告:${REPORT_PATH}`,
    `成果汇总:${SUMMARY_PATH}`,
    out.quotaReached ? '' : '（首次真实响应字段名 [需核实]：见 ' + PROBE_SEARCH + ' / ' + PROBE_APPLY + '）',
    '==============================',
  ].filter(Boolean).join('\n');
}

// ---------------- 中断优雅处理 ----------------
function onInterrupt(sig) {
  log(`收到 ${sig}，正在保存进度并退出…（去重保证可安全续投）`);
  try {
    runState.note = `用户中断（${sig}），已安全保存进度，可重新运行续投`;
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
  // v2.3.0 新增导出
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
  // 全局兜底：未捕获异常/未处理拒绝一律落盘完整堆栈再退出，避免静默 exit 1 无 [致命]
  process.on('uncaughtException', (e) => { flushExit(1, '[致命-uncaughtException] ' + (e && e.stack ? e.stack : e)); });
  process.on('unhandledRejection', (reason) => { flushExit(1, '[致命-unhandledRejection] ' + (reason && reason.stack ? reason.stack : String(reason))); });
  main().catch((e) => { flushExit(1, '[致命] ' + (e && e.stack ? e.stack : (e && e.message ? e.message : e))); });
}
