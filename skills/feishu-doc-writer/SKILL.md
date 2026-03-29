---
name: feishu-doc-writer
description: Write, rewrite, polish, and restructure Feishu documents and wiki notes in Chinese. Supports multiple document types including technical analysis, design proposals, meeting notes, and general documentation. Use when turning rough notes into readable documents, improving wording and structure, or drafting new documents.
---

# 飞书文档写作助手

当主要任务是起草或改写文档内容时使用本 skill。本 skill 专注于写作本身——飞书 API 操作请使用 `feishu-doc-workflow`。

## 工作流

### 1. 判断文档类型

动笔前先确认文档类型：

| 类型 | 触发词 | 模板 |
|------|--------|------|
| **技术分析** | 源码分析、代码解读、调用链、实现原理 | [references/template-technical.md](references/template-technical.md) |
| **方案设计** | 技术方案、设计文档、架构设计、RFC | [references/template-design.md](references/template-design.md) |
| **会议纪要** | 会议记录、讨论纪要、对齐结论 | [references/template-meeting.md](references/template-meeting.md) |
| **通用文档** | 说明文档、操作手册、知识沉淀、FAQ | [references/template-general.md](references/template-general.md) |

类型不明确时主动询问用户。无法归入前三类时使用**通用文档**。

### 2. 确定写作模式

- **新文档**：先列提纲，确认后再填充内容。
- **改写**：保留原文有价值的信息，直接重写薄弱部分。不要评论原稿——直接改好。

### 3. 解析风格（仅在用户要求时）

只有用户明确要求风格一致（"按我的风格写"、"保持原来的文风"）时才执行：

1. 优先调用 `resolve_style_profile`。
2. 命中则将其 `风格指纹` 作为写作约束。
3. 未命中且用户需要，交给 `feishu-style-extract` 生成。
4. 用户未提及风格，跳过此步。

### 4. 搭建章节骨架

- 使用显式编号标题：`一、...`、`二、...`。
- 从对应模板中选取骨架结构。
- 在合适的标题层级插入过渡章节，避免单个章节过载。
- 短文档（< 5 节）使用扁平结构即可。

### 5. 撰写内容

以下规则适用于所有文档类型：

1. **结论先行。** 先给出关键结论，再展开解释。
2. **一段一事。** 每段聚焦一个要点，便于快速扫读。
3. **证据精简。** 代码片段、数据、引用只保留证明当前观点的关键行，每段证据前标注来源路径。
4. **格式克制。** 行内代码仅用于标识符和路径，不用于普通中文词汇；加粗和高亮从严使用。
5. **过渡显式。** 当下一节依赖当前节时，用一句话衔接。
6. **避免元叙述。** 不写"本节将介绍..."，直接说明。
7. **图表配套。** 撰写过程中逐章节判断是否需要配图。满足以下任一条件即配图：
   - 描述了组件/模块间的调用关系或依赖关系 → 架构图（`create_graphviz_diagram_block`）
   - 描述了时序交互（A 调用 B，B 回调 A）→ 时序图（`create_plantuml_diagram_block`）
   - 描述了状态变化流转 → 状态机图（Graphviz 或 PlantUML）
   - 描述了分支决策逻辑（如果…则…否则…）→ 流程图（`create_graphviz_diagram_block`）
   - 列出了 3 个以上组件的层级或包含关系 → 架构图（`create_graphviz_diagram_block`）
   - 描述了数据流转路径（A→B→C）→ 数据流图（`create_graphviz_diagram_block`）

   不需要画图的情况：纯配置说明或操作步骤列表；用表格已足够清晰；章节涉及的节点/步骤不足 3 个。

   工具选择：层级、依赖、流程、架构类 → Graphviz；时序、交互、活动类 → PlantUML。图表紧跟在对应正文段落之后插入。

### 6. 一致性自检

交付前检查：

- 章节顺序是否符合逻辑递进关系。
- 全文术语是否统一（同一概念不要换称呼）。
- 每节是否支撑文档的主线论点或目的。
- 较长文档是否以总结收尾。

### 7. 发布到飞书

写作完成后，衔接 `feishu-doc-workflow` 发布：

- **新建文档**：`create_document` → `import_markdown_to_document`，或按章节逐段 `upsert_section`。
- **更新已有文档**：`replace_section_blocks` 或 `upsert_section` 替换指定章节。
- **发布后验证**：`export_document_to_markdown` 回读确认，检查格式是否完整。

如果用户只要求写作不要求发布，跳过此步，将内容以 markdown 形式交付。

## 验收标准

交付前逐条自检，不通过则修正后再交付：

| # | 检查项 | 通过条件 |
|---|--------|----------|
| 1 | 文档类型 | 已识别类型并应用对应模板骨架 |
| 2 | 章节结构 | 使用编号标题（`一、`...），层级不超过 3 层 |
| 3 | 结论前置 | 每个主要章节的第一段是结论或概述，不是背景铺垫 |
| 4 | 证据标注 | 每处代码/数据引用前有来源路径，片段不超过 15 行 |
| 5 | 术语一致 | 全文中同一概念使用同一名称，无混用 |
| 6 | 无元叙述 | 不存在"本节将..."、"下面介绍..."等元叙述句式 |
| 7 | 总结收尾 | 超过 4 个章节的文档有总结章节 |
| 8 | 风格匹配 | 若启用了风格画像，输出符合其 `风格指纹` 规则 |
| 9 | 图表配套 | 符合图表触发条件的章节已配图，图表紧跟对应正文 |

## 参考模板

- [references/template-technical.md](references/template-technical.md) — 技术分析模板
- [references/template-design.md](references/template-design.md) — 方案设计模板
- [references/template-meeting.md](references/template-meeting.md) — 会议纪要模板
- [references/template-general.md](references/template-general.md) — 通用文档模板
