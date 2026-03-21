---
name: feishu-creator-doc-workflow
description: Safely create, inspect, update, replace, move, copy, and verify Feishu documents and wiki notes via feishu-creator MCP tools. Use when the user wants to operate on Feishu documents — not for installation (use feishu-setup) or drafting content (use feishu-doc-writer).
---

# 飞书文档操作工作流

当任务是飞书文档操作（创建、读取、编辑、重组、批量管理）时使用本 skill。安装配置请使用 `feishu-setup`，写作内容请使用 `feishu-doc-writer`。

## 意图路由

| 用户意图 | 对应操作 |
|---------|---------|
| 创建新文档或 wiki 页面 | [创建文档](#创建文档) |
| 更新或改写某个章节 | [更新章节](#更新章节) |
| 将本地 markdown 同步到飞书 | [Markdown 同步](#markdown-同步) |
| 重组 wiki 结构 | [重组章节](#重组章节) |
| 对多篇文档批量操作 | [批量操作](#批量操作) |
| 添加图表 | [图表与表格](#图表与表格) |
| 操作表格 | [图表与表格](#图表与表格) |
| 将 PDF/PPT/DOCX 导入飞书 | [外部文件导入飞书](#外部文件导入飞书) |

## 核心原则

1. **先查后改。** 结构化编辑前始终先 `get_document_blocks` 或 `export_document_to_markdown`。
2. **用最高层级原语。** 优先 heading 级工具，避免手动拼 block index。优先 `upsert_section` 而非 `delete_by_heading` + `insert_before_heading`。
3. **改后验证。** 回读受影响区域，确认结果。见[验证](#验证)。
4. **安全失败。** 编辑失败时不要盲目重试，先诊断。见[错误恢复](#错误恢复)。

## 编辑原语（按优先级）

| 优先级 | 工具 | 适用场景 |
|--------|------|----------|
| 1 | `upsert_section` | 按标题替换已有或创建新章节 |
| 2 | `replace_section_blocks` | 替换章节内容，保留标题 |
| 3 | `generate_section_blocks` | 创建结构化内容（标题 + 列表项） |
| 4 | `generate_rich_text_blocks` | 创建混合富文本块 |
| 5 | `insert_before_heading` | 在指定标题前插入内容 |
| 6 | `import_markdown_to_document` | 从 markdown 批量导入 |
| 7 | `batch_create_blocks` | 低层 block 插入（最后手段） |

---

## 创建文档

**场景：** 用户需要新建飞书文档或 wiki 页面。

1. `create_document` — 指定标题和可选的 wiki 空间/父节点。
2. 写入内容，选择以下方式之一：
   - `import_markdown_to_document` — 源内容是 markdown 文本时。
   - `generate_section_blocks` — 构建结构化章节时。
   - `upsert_section`（多次调用） — 逐章节构建时。
3. 验证：`get_document_blocks` 确认文档结构。

## 更新章节

**场景：** 用户需要修改已有文档的部分内容。

1. `get_document_info` — 解析文档。
2. `export_document_to_markdown` 或 `get_document_blocks` — 了解当前结构。
3. `preview_edit_plan` — 预览匹配和变更范围（复杂编辑时推荐）。
4. 执行编辑：
   - 单章节替换：`replace_section_blocks` 或 `upsert_section`。
   - 在标题前插入新内容：`insert_before_heading`。
   - 删除章节：`delete_by_heading`。
5. 验证：`get_document_blocks` 检查受影响区域。

## Markdown 同步

**场景：** 用户有本地 markdown 文件，需要同步到飞书。

1. 解析或创建目标文档。
2. `import_markdown_to_document` — 导入 markdown 内容。
3. 验证：`export_document_to_markdown` 做往返检查。

**注意事项：**
- Markdown → 飞书对复杂格式（嵌套表格、HTML）有损。
- markdown 中的图片必须是本地文件路径或可访问的 URL。
- 往返检查发现问题时，改用 `upsert_section` 逐章节导入。

## 外部文件导入飞书

**场景：** 用户需要将 PDF、PPT、DOCX 等文件内容导入飞书文档。

### 前提

需要配套 MCP 工具（如 `docling-mcp`）将文件转为 Markdown。配套工具的安装见 `feishu-setup` skill 的"推荐配套 MCP 工具"章节。

### 工作流

1. **转换**：使用 docling 等工具将源文件转为 Markdown。
2. **审查**：检查转换后的 Markdown 质量，必要时人工修正。
3. **创建目标文档**：`create_document` 创建飞书文档。
4. **导入**：`import_markdown_to_document` 将 Markdown 写入飞书。
5. **验证**：`get_document_blocks` 或 `export_document_to_markdown` 确认结果。

### 格式兼容说明

`import_markdown_to_document` 对外部工具输出的 Markdown 做了以下兼容处理：

| 格式 | 处理方式 |
|------|----------|
| YAML frontmatter (`---...---`) | 自动剥离 |
| 水平分割线 (`---`, `***`, `___`) | 静默跳过（飞书无对应块） |
| 图片 `![alt](url)` | 降级为可点击链接 `[alt](url)` |
| 任务列表 `- [ ]` / `- [x]` | 转为 ☐ / ☑ 标记的普通列表 |
| HTML 标签 (`<br>`, `<div>`, `<p>` 等) | 剥离标签，保留内容 |

### 图片处理策略

Markdown 中的图片语法会降级为链接。如需在飞书文档中显示图片：

1. 先用 `import_markdown_to_document` 导入文本内容。
2. 识别需要插入图片的位置。
3. 使用 `upload_local_image` 逐个上传图片到对应位置。

### 大文件导入策略

源文件超过 50 页或转换后 Markdown 超过 50KB 时：

1. 将 Markdown 按一级标题拆分为多个章节。
2. `create_document` 创建飞书文档。
3. 逐章节调用 `upsert_section` 写入，而非一次性 `import_markdown_to_document`。
4. 每个章节写入后验证，失败时单独重试该章节。

## 重组章节

**场景：** 用户需要移动、复制或重新排列章节。

1. `get_document_blocks` — 映射当前标题结构。
2. 执行：
   - `move_section` — 同文档内或跨文档移动。
   - `copy_section` — 复制到同文档或另一文档。
3. 验证：对源文档和目标文档分别 `get_document_blocks`。

**跨文档移动：** 操作后验证两篇文档——源文档中该章节应已移除，目标文档中应已出现。

## 批量操作

**场景：** 用户需要对多篇文档执行操作。

1. 发现目标：`search_feishu_documents` 或 `get_feishu_wiki_tree`。
2. 对每篇文档套用上述单文档 recipe。
3. 汇报结果：成功和失败分别列出。

**批量护栏：**
- 删除多篇文档前必须与用户确认。
- 顺序处理，不要并发，避免触发限流。
- 遇到非预期错误时停止并汇报，不要继续盲跑。

## 图表与表格

### 图片与图表

| 需求 | 工具 |
|------|------|
| 上传本地图片 | `upload_local_image` |
| 渲染 Graphviz 并插入文档 | `create_graphviz_diagram_block` |
| 渲染 PlantUML 并插入文档 | `create_plantuml_diagram_block` |
| 仅渲染不插入 | `render_graphviz_diagram`、`render_plantuml_diagram` |

### 表格

| 需求 | 工具 |
|------|------|
| 创建表格 | `create_table` |
| 读取表格 | `get_table` |
| 更新单元格 | `update_table_cell` |
| 整体替换表格 | `replace_table` |

---

## 验证

结构化编辑后按以下标准验证：

| 检查项 | 方法 | 失败时的处理 |
|--------|------|-------------|
| 内容正确到位 | `get_document_blocks` 找到新增/更新的 block | 重新检查标题匹配，用精确文本重试 |
| 无重复内容 | 扫描是否有重复标题或 block | `delete_by_heading` 删除重复项 |
| 层级正确 | 确认标题层级和父子嵌套关系 | `move_section` 修正位置 |
| 无游离 block | 检查是否有孤立的列表项、图片或空段落 | `delete_document_blocks` 清理 |

## 错误恢复

| 错误 | 可能原因 | 恢复方法 |
|------|----------|----------|
| 标题未找到 | 标题文本不完全匹配（空格、编号、Unicode） | `get_document_blocks` 查看实际标题文本，用精确匹配重试 |
| 替换后内容为空 | block payload 格式错误 | 检查 payload 格式，修正后重试 |
| "block not found" | block 被并发编辑删除或移动 | 重新读取文档，定位 block 新位置 |
| 限流（429） | API 调用过于频繁 | 等待后重试；批量操作时在文档间加延迟 |
| 操作中鉴权过期 | 长操作期间 token TTL 超时 | 自动使用刷新后的 token 重试；持续失败则重新检查凭据 |
| 编辑后内容丢失 | 标题歧义导致匹配了错误章节 | 使用 heading path（如 `一级标题/二级标题`）精确匹配；在飞书 UI 从文档历史恢复 |
| Markdown 导入不完整 | 不支持的 markdown 语法 | 对问题章节改用 `upsert_section` |

## 护栏

- 优先使用 heading 级工具，避免 block index 工具。
- 删除操作优先 `delete_by_heading`，避免 `delete_document_blocks`。
- 不要直接输出原始 MCP 工具返回——附上一句解释说明。
- 标题有歧义时使用 heading path（父级/子级）精确匹配。
- 大文档（100+ block）优先章节级操作，避免全文重写。
- 破坏性操作（删除文档、批量删除）前必须与用户确认。
