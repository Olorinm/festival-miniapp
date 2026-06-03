# 赶场愉快 Web

Vercel 应急网页版。Root Directory 选择 `web`。

## 方案

- 前端和 API：Vercel + Next.js。
- AI：`/api/ai-plan` 服务端调用火山方舟，失败后可切 DeepSeek。
- 热度统计：Upstash Redis。未配置 Redis 时只使用内存兜底，不适合线上。
- 影片数据和海报：随代码静态发布。

## 环境变量

复制 `.env.example` 到 `.env.local` 用于本地开发；Vercel 后台填写同名变量。

- `ARK_API_KEY`：火山方舟 key，可选。
- `DEEPSEEK_API_KEY`：DeepSeek key，可选。
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`：热度统计，线上建议必填。
- `KV_REST_API_URL` / `KV_REST_API_TOKEN`：Vercel Marketplace 的 Upstash for Redis 可能注入这组变量，代码也会自动识别。

## 本地运行

```bash
npm install
npm run dev
```

## 部署

1. 在 Upstash 创建 Redis，复制 REST URL 和 REST Token。
2. 在 Vercel 导入 GitHub 仓库，Root Directory 填 `web`，Framework 选择 Next.js。
3. 在 Vercel Project Settings -> Environment Variables 填入 `.env.example` 里的变量。
4. Production 部署后，用真实页面测试：AI 排片、热度显示、导入导出、海报详情。

API route 已设置 `preferredRegion = 'hkg1'`，尽量让 AI 和热度请求从香港区域执行。
