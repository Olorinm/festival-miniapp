# Festival Miniapp

电影节选片、挑场次和排片的小程序原型。

## 功能

- 按片单浏览影片并标记想看程度
- 按日期、影院、影片筛选场次
- 多方案排片、冲突检查、文字版导入导出
- 生成排片长图
- 支持云端片单数据兜底加载

## 使用

用微信开发者工具导入本目录。公开配置使用 `touristappid`，正式开发请复制 `project.private.config.example.json` 为 `project.private.config.json`，再填自己的小程序信息。

云函数密钥只放在云函数环境变量里，不要提交到仓库；变量名参考各云函数目录里的 `.env.example`。

## 工具

```bash
node scripts/fetch-doulist-posters.mjs --doulist 163945180
```

该脚本用于离线从豆列拉取轻量海报并生成 manifest。

补 TMDB 剧情简介：

```bash
TMDB_API_TOKEN=YOUR_TMDB_API_TOKEN node scripts/fetch-tmdb-synopses.mjs
```

脚本会优先用 IMDb ID 匹配 TMDB，语言顺序默认为 `zh-CN,zh-TW,en-US`，并把结果写入 `synopsis`、`tmdbId`、`synopsisSource` 等字段。可先用 `--dry-run --limit 10` 试跑。
