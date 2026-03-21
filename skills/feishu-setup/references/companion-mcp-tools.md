# 推荐配套 MCP 工具

以下工具与 feishu-creator 配合使用，可增强文档工作流。所有工具应安装到**用户全局配置** `~/.claude/.mcp.json`，不要写入项目级 `.mcp.json`。

## docling-mcp（文档格式转换）

IBM 开源的文档理解引擎，支持将 PDF、PPTX、DOCX、XLSX、HTML、图片等转为 Markdown。

- **典型场景**：将已有 PDF/PPT 内容转为 Markdown，再通过 feishu-creator 写入飞书文档。
- **前置依赖**：`uvx`（来自 [uv](https://github.com/astral-sh/uv) 包管理器）
- **GitHub**：`docling-project/docling-mcp`

配置：

```json
{
  "mcpServers": {
    "docling": {
      "command": "uvx",
      "args": ["--from=docling-mcp", "docling-mcp-server"]
    }
  }
}
```

## markdownify-mcp（全能格式转换）

支持 PDF、PPTX、DOCX、XLSX、图片 OCR、音频转写、YouTube 字幕、网页抓取等。

- **典型场景**：需要处理多种格式来源时的万能转换器。
- **前置依赖**：Node.js，需 clone 后构建。
- **GitHub**：`zcaceres/markdownify-mcp`

配置：

```json
{
  "mcpServers": {
    "markdownify": {
      "command": "node",
      "args": ["/absolute/path/to/markdownify-mcp/dist/index.js"]
    }
  }
}
```

## @modelcontextprotocol/server-pdf（轻量 PDF 读取）

官方 PDF MCP server，基于 PDF.js，仅做文本提取，适合简单场景。

- **典型场景**：快速读取 PDF 文本内容，无需复杂排版解析。
- **前置依赖**：`npx`

配置：

```json
{
  "mcpServers": {
    "pdf": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-pdf"]
    }
  }
}
```

## 与 feishu-creator 配合的典型工作流

### PDF → 飞书文档

```
用户: "把这个 PDF 导入到飞书"
  ↓
1. docling 将 PDF 转为 Markdown
2. 审查 Markdown 质量（表格是否完整、图片是否有链接）
3. create_document 创建飞书文档
4. import_markdown_to_document 导入 Markdown
5. 如需图片：upload_local_image 逐个上传
```

### PPT → 飞书文档

```
用户: "把这个 PPT 内容整理成飞书文档"
  ↓
1. docling 将 PPTX 转为 Markdown
2. PPT 转换后通常是扁平结构——按幻灯片标题整理为章节
3. 可选：用 feishu-doc-writer skill 润色内容
4. import_markdown_to_document 或 upsert_section 逐章节写入
```

### 格式兼容性说明

feishu-creator 的 `import_markdown_to_document` 已对外部工具输出做了兼容处理：

| 外部工具常见输出 | feishu-creator 处理 |
|-----------------|-------------------|
| YAML frontmatter | 自动剥离 |
| 水平分割线 | 静默跳过 |
| 图片 `![alt](url)` | 降级为可点击链接 |
| 任务列表 `- [ ]` | 转为 ☐/☑ 标记 |
| HTML 标签 | 剥离标签，保留内容 |

## 安装注意事项

- 合并写入 `~/.claude/.mcp.json` 时需保留用户已有的其他 MCP server 配置。
- 安装后需重启 Claude Code 才能加载新的 MCP server。
- 检查前置依赖（`uvx`、`npx`）是否可用，不可用时给出安装指引。
