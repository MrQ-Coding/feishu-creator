# feishu-creator

**让 AI 直接帮你写飞书文档。**

一个 Claude Code plugin —— 告诉 AI 你想写什么，它替你完成从创建文档到发布内容的全过程。

[![Node.js](https://img.shields.io/badge/node-%3E%3D20.17.0-brightgreen)](https://nodejs.org)

---

## 能做什么

- **写文档** — "帮我写一篇技术方案"、"把会议记录整理成飞书文档"
- **改内容** — "把第三章换成新的方案"、"把这段移到另一篇文档里"
- **画图表** — "画一个架构图插到文档里"、"加一个流程图"
- **管知识库** — "这个问题记录到知识库"、"搜一下之前怎么解决的"
- **学文风** — "分析我的写作风格"、"按这个风格帮我重写"

---

## 上手

1. 登录 [飞书开放平台](https://open.feishu.cn/app?lang=zh-CN)，创建自建应用，添加 `docs:doc`、`wiki:wiki`、`drive:drive:readonly` 等权限，记录 App ID 和 App Secret。
2. 在 Claude Code 中说：**"帮我安装 feishu-creator，仓库地址 https://github.com/MrQ-Coding/feishu-creator"**

内置的 `feishu-setup` skill 会自动完成克隆、构建、凭据配置、客户端接入和连通性验证。

---

## 使用边界

- Markdown 导入导出是轻量实现，不保证完全无损
- 复杂表格样式、合并单元格暂不支持
- Wiki 删除依赖 Playwright 浏览器会话，首次使用需完成一次飞书登录

---

## 开发

```bash
npm run dev          # 开发模式
npm run build        # 构建
npm run type-check   # 类型检查
```

环境变量见 [`.env.example`](./.env.example)，认证与 HTTP 部署详见 [skills/feishu-setup](./skills/feishu-setup/SKILL.md)。
