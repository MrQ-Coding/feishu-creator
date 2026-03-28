---
name: knowledge-qa
description: Knowledge base Q&A workflow. Search the knowledge base before solving a problem, then record the solution. Use when the user asks a technical question, reports a bug, or wants to check if a solution already exists.
---

# 知识库问答闭环工作流

当用户提出技术问题、报告问题或寻求解决方案时，使用本工作流。

## 工作流程

### 第一步：搜索知识库

先用 `knowledge_search` 查询本地索引：

```
knowledge_search({ query: "<用户问题关键词>" })
```

- 从用户问题中提取 2-5 个关键词
- 默认不开启 API fallback（本地索引足够快）
- 如果本地索引无结果且问题重要，可设置 `fallbackToApi: true` 重试

### 第二步：返回已有方案或解决问题

**如果找到匹配结果：**
- 直接向用户展示已有解决方案
- 附上来源文档链接
- 询问是否需要补充或更新

**如果没有找到：**
- 正常分析和解决问题
- 给出解决方案

### 第三步：记录到知识库

问题解决后，询问用户：

> "这个问题已解决。要记录到知识库吗？"

用户确认后，调用 `knowledge_record`：

```
knowledge_record({
  spaceId: "<知识库空间ID>",
  category: "<分类名>",
  title: "<问题标题>",
  keywords: ["关键词1", "关键词2", ...],
  problem: "<问题描述>",
  solution: "<解决方案>",
  reference: "<参考链接（可选）>"
})
```

**关键词提取原则：**
- 包含技术术语（如 React, Docker, Nginx）
- 包含错误信息关键词
- 包含场景描述词（如 部署、性能、权限）
- 3-6 个关键词为宜

**分类建议：**
- 按技术领域分：前端问题、后端问题、运维问题、数据库问题
- 按项目分：项目A问题集、项目B问题集

## 首次使用

如果是首次使用或索引为空，先构建索引：

```
knowledge_index_rebuild({
  spaceId: "<知识库空间ID>",
  maxDepth: 3
})
```

## 注意事项

1. **不要重复记录**：搜索到已有方案时，除非有重要补充，否则不需要重新记录
2. **尊重用户意愿**：记录前必须征得用户同意
3. **保持简洁**：问题描述和解决方案应简明扼要，便于后续检索
4. **关键词要准确**：直接影响后续搜索的命中率
