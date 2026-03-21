export function jsonToolResult(data: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

export function textToolResult(text: string): {
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    content: [{ type: "text", text }],
  };
}

export function errorToolResult(
  toolName: string,
  error: unknown,
): {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: `${toolName} failed: ${error instanceof Error ? error.message : String(error)}`,
      },
    ],
  };
}
