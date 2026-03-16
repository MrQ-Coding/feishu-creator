# Feishu Technical Note Template

## 1. Recommended Top-Level Structure

Default skeleton:

1. `一、概览`
2. `二、概念介绍`
3. `三、源码入口`
4. `四、源码解析`
5. `五、关键子流程`
6. `六、总结`

## 2. Section Writing Pattern

Default micro-pattern:

1. Overview line (`概览：...`)
2. Main path explanation (ordered steps)
3. Evidence (small code excerpt, command output, or logs)
4. Transition sentence (`这一步最终会进入...`)

## 3. Source Snippet Pattern

Path:

```text
frameworks/base/services/core/java/com/android/server/wm/RootWindowContainer.java
```

Snippet:

```java
// frameworks/base/services/core/java/com/android/server/wm/RootWindowContainer.java
void startHomeOnAllDisplays(...) {
    // key lines only
}
```

Proof:

```text
这段逻辑证明主流程会先遍历显示设备，随后再调用目标启动入口方法。
```

## 4. Comparison Section Pattern

Use `term + short explanation` bullets:

- **同步流程**: 调用链在当前线程内连续推进，便于直接定位下一跳。
- **异步流程**: 通过消息或回调转交执行，需要额外确认触发点与时序。

## 5. Test Or Validation Report Pattern

Default structure:

1. `一、测试结论`
2. `二、验证范围`
3. `三、验证方式`
4. `四、效率记录`
5. `五、关键问题`
6. `六、建议`

`三、验证方式` should label the evidence source:

- MCP tool calls
- local service / script execution
- code reading inference

Each problem section:

1. Observed fact (`现象：...`)
2. Evidence (`证据：返回结果 / 截图 / 关键字段`)
3. Inference when needed (`推断：...`)
4. Recommendation (`建议：...`)

## 6. Quick Reminders

- Lead with the main path, then expand into branches.
- Keep snippets short; do not paste whole files.
- Use inline code for stable identifiers and source paths, not ordinary Chinese words.
