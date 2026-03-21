# Design Proposal Template

## 1. Recommended Top-Level Structure

Default skeleton:

1. `一、背景与目标`
2. `二、现状分析`
3. `三、方案设计`
4. `四、方案对比`（when multiple options exist）
5. `五、实施计划`
6. `六、风险与应对`
7. `七、总结`

## 2. Section Writing Pattern

### 背景与目标

- State the problem in 2-3 sentences.
- List concrete goals as numbered items.
- Distinguish must-have from nice-to-have.

### 现状分析

- Describe current architecture or workflow briefly.
- Highlight the specific pain points this proposal addresses.
- Use a diagram (`create_graphviz_diagram_block`) when the current architecture is non-trivial.

### 方案设计

- Lead with the core idea in one sentence.
- Break down into sub-sections by component or layer.
- For each component: what it does → how it works → why this approach.
- Include a high-level architecture diagram when helpful.

### 方案对比

Use a comparison table:

| 维度 | 方案 A | 方案 B |
|------|--------|--------|
| 复杂度 | ... | ... |
| 性能 | ... | ... |
| 可维护性 | ... | ... |

End with a clear recommendation and reasoning.

### 实施计划

- Break into phases with concrete deliverables.
- Use ordered list for sequential steps.
- Note dependencies between phases.

### 风险与应对

Use `risk + mitigation` pairs:

- **风险**: 描述具体风险
  **应对**: 具体缓解措施

## 3. Quick Reminders

- Lead with the recommendation, not the analysis.
- Keep diagrams focused — one concept per diagram.
- Quantify where possible (latency, cost, effort).
- Separate facts from opinions explicitly.
