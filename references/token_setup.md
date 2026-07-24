# Token 获取手把手指南（阶段 0）

> 本技能唯一前置：一个你本人猎聘账号的 `x-user-token`（JWT）。Token 明文仅通过环境变量 `LIEPIN_TOKEN` 在本次命令内联传入，**不落盘、不记记忆、不打日志**。

## 步骤（约 2 分钟）

1. **登录猎聘并进入 MCP 服务器页**
   - 浏览器打开：https://www.liepin.com/mcp/server
   - 如未登录，先扫码/短信登录你的猎聘账号。

2. **生成凭证**
   - 页面内点击「生成凭证」或「创建 Token」按钮。
   - 若提示选择权限，**务必勾选 `user-search-job` 和 `user-apply-job`**（后者是投递权限，缺了会报 401）。

3. **复制 x-user-token**
   - 复制生成的 JWT 串（以 `eyJ` 开头，通常很长）。
   - 直接发到对话框，或按下方方式在命令行内联传入。

## 使用方式

**方式 A：直接发给 WorkBuddy 代理**
- 把 token 复制到对话框，代理会自行注入 `LIEPIN_TOKEN` 并运行脚本。

**方式 B：手动命令行**
```powershell
$env:LIEPIN_TOKEN="eyJ...你的token..."
node scripts/apply_pipeline.js
```

```bash
# Linux / macOS
export LIEPIN_TOKEN="eyJ...你的token..."
node scripts/apply_pipeline.js
```

## 常见问题

- **Q：Token 有效期多久？**
  - 标称 90 天，但高频批量请求可能被服务端提前吊销。若投递报 401，按上述步骤重新生成即可。

- **Q：为什么 search 通但 apply 报 401？**
  - 猎聘对搜索和投递权限可能分离。重新生成凭证时，确认已勾选 **apply 权限**。

- **Q：Token 会被保存吗？**
  - 不会。脚本只读取当前环境变量 `LIEPIN_TOKEN`，结束后不保留。

- **Q：不想每次复制 token 怎么办？**
  - 可用工作区 `.env` 文件或操作系统环境变量管理，但**不要提交到 Git/公开仓库**。
