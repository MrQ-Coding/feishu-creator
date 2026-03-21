import { describe, it, expect } from "vitest";
import { jsonToolResult, textToolResult, errorToolResult } from "../toolResponse.js";

describe("toolResponse", () => {
  describe("jsonToolResult", () => {
    it("serializes data as JSON text content", () => {
      const result = jsonToolResult({ foo: "bar", count: 42 });
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      expect(JSON.parse(result.content[0].text)).toEqual({ foo: "bar", count: 42 });
    });

    it("handles null and primitives", () => {
      expect(JSON.parse(jsonToolResult(null).content[0].text)).toBeNull();
      expect(JSON.parse(jsonToolResult(123).content[0].text)).toBe(123);
    });
  });

  describe("textToolResult", () => {
    it("returns plain text content", () => {
      const result = textToolResult("hello world");
      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({ type: "text", text: "hello world" });
    });
  });

  describe("errorToolResult", () => {
    it("sets isError to true per MCP spec", () => {
      const result = errorToolResult("test_tool", new Error("something broke"));
      expect(result.isError).toBe(true);
    });

    it("formats Error messages", () => {
      const result = errorToolResult("my_tool", new Error("connection refused"));
      expect(result.content[0].text).toBe("my_tool failed: connection refused");
    });

    it("formats non-Error values", () => {
      const result = errorToolResult("my_tool", "string error");
      expect(result.content[0].text).toBe("my_tool failed: string error");
    });

    it("handles undefined error", () => {
      const result = errorToolResult("my_tool", undefined);
      expect(result.content[0].text).toBe("my_tool failed: undefined");
    });
  });
});
