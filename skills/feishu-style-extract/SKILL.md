---
name: feishu-style-extract
description: Analyze representative Feishu docs or wiki notes, extract a reusable writing-style profile, and optionally save the profile back into Feishu. Use when the user asks to analyze their writing style, imitate an existing author voice, keep document tone consistent, or build a style guide from Feishu content.
---

# 飞书文风提取助手

当主要任务是从已有飞书文档中提炼写作风格并生成可复用画像时使用本 skill。如果只是应用已有画像来写作，请使用 `feishu-doc-writer`（它会自动调用 `resolve_style_profile`）。

## 适用场景

- 用户说"分析一下我的写作风格"、"总结我的文风"、"帮我生成风格画像"
- 需要模仿某人的文风进行写作
- 需要在一组文档间统一语气后再起草新内容
- 需要在改写或扩展时保留原作者的风格

## 工作流

### 快速路径（优先尝试）

1. 调用 `resolve_style_profile`。
2. 命中且用户未要求刷新 → 直接返回画像，完成。
3. 命中但用户要求更新 → 进入完整提取流程，以现有画像为基线。

### 完整提取

#### 第 1 步：确定分析范围

解析以下场景之一：

- **指定文档**：用户提供了 1-N 个文档 URL 或 ID，直接使用。
- **Wiki 空间或子树**：通过 `get_feishu_wiki_tree` 发现候选文档。
- **模糊请求**（"分析我的文风"）：请用户提供 3-5 篇代表性文档，除非目标集合在上下文中已经明确。

#### 第 2 步：收集并评级样本

对每个候选文档：

1. `get_document_info` → 规范化页面信息。
2. `export_document_to_markdown` → 读取内容。
3. markdown 不够用时回退到 `get_document_blocks`。

对每个样本评级：

- **强**：原创、有实质性散文内容、语气有代表性。
- **中**：部分有代表性，但主题或结构较窄。
- **弱**：太短、模板化、复制内容、作者不明确。

可信样本不足 3 篇时，明确告知置信度低并请求更多样本。

采样规则：

- 优选 5-10 篇文档。
- 偏好原创写作而非复制素材。
- 偏好主题多样性而非数量。
- 降权以代码块、表格、截图为主的文档。

#### 第 3 步：分析风格维度

从四个维度分析：

| 维度 | 关注要素 |
|------|----------|
| **词汇** | 正式度、术语密度、偏好词、中英混用习惯 |
| **句式** | 平均句长、从句复杂度、段落密度、列表使用、节奏感 |
| **语气** | 人称、自信度、教学感 vs 对话感、情感色温 |
| **结构** | 开头模式、标题风格、示例密度、格式偏好 |

将稳定的风格特征与主题特定效应区分开。React 相关文档中的高频术语不一定代表作者的通用写作风格。

#### 第 4 步：生成画像

使用 [references/style-profile-template.md](references/style-profile-template.md) 作为输出模板。关键部分：

- 一句话整体定性
- 样本范围与选择理由
- 各维度发现
- `风格指纹`：5 条以上具体、可复用的写作规则
- 一段代表性摘录及批注
- `使用方式` 说明

#### 第 5 步：确认并保存

1. **先展示草稿**再保存，邀请用户修正。
2. 区分当前风格（样本呈现的）和目标风格（用户想要的）。
3. **保存到飞书**（默认行为，用户明确拒绝时跳过）：
   - 新建画像：`create_document` + `import_markdown_to_document`
   - 更新已有：`upsert_section`
   - 标题约定：`✍️ 写作风格画像 - {类型}`

## 错误处理

| 情况 | 处理方式 |
|------|----------|
| 文档未找到 | 跳过，记录未命中，继续处理其余样本 |
| 权限不足 | 在报告中注明，请求用户提供其他样本 |
| Markdown 导出为空 | 回退到 `get_document_blocks` |
| 候选文档过多 | 采样前 5-10 篇，说明采样依据 |
| 可信样本不足 | 说明置信度低，请求更多样本 |
| 混合作者 | 确认文档归属后再生成最终画像 |
| 保存失败 | 在对话中展示画像，注明写回未完成 |

## 护栏

- 描述作者怎么写，不评判好坏（除非用户要求）。
- 不要过拟合到单篇样本——标注仅出现在一篇文档中的特征。
- 区分观察和推断：`常用编号标题` 是观察；`重视教学感` 是推断。
- 避免伪精确——使用 `倾向于`、`明显偏好`、`经常出现`。
- 用户确认前不保存画像。
- 共享 HTTP 模式下，需要稳定的 owner 身份才能关联画像归属。

## 参考模板

- [references/style-profile-template.md](references/style-profile-template.md) — 画像输出模板和审查清单。
