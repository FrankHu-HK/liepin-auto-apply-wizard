# 猎聘全自动投递向导 · 端到端示例

> 完整展示「用户对话 → 配置 → 搜索 → 投递 → 成果」全链路输入输出，照着抄即可跑通。所有示例均为真实结构（脱敏）。

## 一、对话触发示例（用户原话 → 技能识别）

**场景 A：一句话启动**
```
用户：「帮我把简历投到猎聘上那些 HRD 和 HRBP 的岗位，只要直招不要猎头」
→ 高触发：含「猎聘」+「投」+ 岗位意图 + 招聘类型（直招=nonRecruiter）
→ 技能：拉起 Web 向导，预填关键词，招聘类型默认 nonRecruiter
```

**场景 B：续投**
```
用户：「昨天没投完，今天接着投」
→ 触发续投类：读取历史报告去重，只投未投过的，每日上限照常
```

**场景 C：查进度**
```
用户：「我投的简历有回音吗 / 投得怎么样了」
→ 触发状态类：读取最新 liepin_wizard_summary.md 汇报四态结果
```

## 二、配置示例（liepin_wizard_config.json）

由向导生成，也可手改：
```json
{
  "keywords": ["HRBP", "人力资源总监", "HRD"],
  "industry": ["__ALL__"],
  "location": "__ALL__",
  "salaryFloor": 25,
  "salaryCeil": 500,
  "levels": ["__ALL__"],
  "recruitmentType": "nonRecruiter",
  "dailyCap": 50,
  "maxPages": 6
}
```
- `recruitmentType`：`nonRecruiter`(仅直招) / `recruiter`(仅猎头) / `all`(都要，非猎头优先)
- `__ALL__` 表示不限（行业/地点通用）

## 三、搜索返回示例（user-search-job）

```
请求：
POST https://open-agent.liepin.com/mcp/user
Headers: x-user-token: <JWT>, Content-Type: application/json
Body: {"jsonrpc":"2.0","id":...,"method":"tools/call",
       "params":{"name":"user-search-job",
                 "arguments":{"jobName":"HRBP","salaryFloor":"25000","page":"0"}}}

返回（解析后 data.list 一条）：
{
  "jobId": 39281745,
  "jobName": "HRBP",
  "company": "某某科技有限公司",
  "industry": "互联网",
  "salary": "25-40k",
  "location": "深圳",
  "jobType": "2"
}
```
脚本据此做：薪资解析（25-40k → floor 25 / ceil 40）→ 行业/地点过滤 → 猎头识别 → 去重。

## 四、投递返回与四态判定示例（user-apply-job）

```
请求 Body: {"name":"user-apply-job","arguments":{"jobId":39281745,"jobKind":"2"}}

① 成功：
{"errCode":0,"message":"应聘成功"} → 状态 success

② 已投过：
{"errCode":1,"message":"您已投递过该职位"} → 状态 already（跳过，不重复）

③ 失败（岗位关闭）：
{"errCode":500,"message":"该职位已关闭，无法投递"} → 状态 fail，原因写入报告

④ 失败（401）：
{"error":{"message":"unauthorized"}} → 状态 fail，若为首条预检则退出码 2

⑤ 未知：
{"result":{"content":[{"text":"{}"}]}} → 状态 unknown，需人工核对
```

## 五、成果报告示例

### 5.1 JSON（liepin_wizard_report.json，机器可读）
```json
{
  "generatedAt": "2026-07-17T23:10:00.000Z",
  "summary": { "success": 18, "already": 6, "fail": 2, "unknown": 1, "total": 27, "applied": 27 },
  "dailyQuota": { "date": "2026-07-17", "count": 18 },
  "quotaReached": false,
  "note": null,
  "results": [
    { "jobId": 39281745, "jobName": "HRBP", "company": "某某科技", "status": "success", "message": "应聘成功" },
    { "jobId": 39281799, "jobName": "HRD", "company": "某集团", "status": "already", "message": "您已投递过该职位" },
    { "jobId": 39281820, "jobName": "人力资源总监", "company": "某制造", "status": "fail", "message": "该职位已关闭，无法投递" },
    { "jobId": 39281855, "jobName": "COE", "company": "某金融", "status": "unknown", "message": "{}" }
  ]
}
```

### 5.2 Markdown（liepin_wizard_summary.md，人类可读）
```markdown
# 猎聘投递成果汇总

生成时间：2026/7/17 23:10:00

## 概览
- 本次待投总数：27
- 实际处理：27
- ✅ 成功：18　⚠️ 已投过：6　❌ 失败：2　❓ 未知：1
- 今日已投：18 份

## ✅ 成功（18）
- HRBP @ 某某科技（深圳）
- 人力资源总监 @ 某能源（上海）
- ...（其余略）

## ❌ 失败及原因（2）
- 人力资源总监 @ 某制造：该职位已关闭，无法投递
- HRBP @ 某医疗：投递频率过快，请稍后重试

## ⚠️ 已投过（跳过，6）
- HRD @ 某集团
- ...（其余略）

## ❓ 未知（需人工核对，1）
- COE @ 某金融：返回不明确，请到猎聘 App 核对
```

## 六、投递前自动告知示例（非阻塞日志播报）
```
[每日配额] 每日上限=50 份，今日已投 0 份，本次最多可投 50 份
[筛选设定] 关键词=人力资源总监,财务经理　行业=不限　地点=全国　薪资=25K~500K　招聘类型=仅非猎头
[筛选结果] 本次按你的设置，共筛选出符合要求的有效岗位 11 个，现在立刻开始投递…
[投递 1/11] 人力资源总监 @ 某科技集团（深圳）｜成功：已投递
[投递 2/11] 财务经理 @ 某金融（上海）｜已投过：跳过
...（逐条实时展示）
```

## 七、典型失败链路（频控）
```
[进度] 搜索[HRBP]p0 命中 12 条
[进度] 招聘类型过滤后 11 条，去重后待投 11 条
[进度] 预检通过，开始批量投递（共 11 条）
[进度] 投递[39281745] 触发 429 频控，退避 15s（已累计 15s）
[进度] 投递[39281745] 触发 429 频控，退避 30s（已累计 45s）
...（退避递增至 240s，累计 >1800s）...
[进度] 频控持续超 30 分钟，已自动暂停；去重保证可稍后安全续投
========== 投递成果 ==========
成功:8  已投过:2  失败:0  未知:0
今日已投:8 份
备注:频控持续超30分钟，已自动暂停
==============================
→ 退出码 3，代理主动告知用户原因
```
