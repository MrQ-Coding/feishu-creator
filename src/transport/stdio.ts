import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "../mcp/app.js";
import { Logger } from "../logger.js";
import type { AppContext } from "../appContext.js";
import { createShutdownHandler } from "./shutdown.js";

export async function runStdio(context: AppContext): Promise<void> {
  // Never print logs to stdout/stderr in stdio mode.
  Logger.setEnabled(false);
  const server = createMcpServer(context);
  const transport = new StdioServerTransport();

  const shutdown = createShutdownHandler(async () => {
    try {
      await server.close();
    } catch {
      // Ignore close errors during shutdown.
    }
    try {
      await context.shutdown();
    } catch {
      // Ignore cleanup errors during shutdown.
    }
  });

  const handleStdinClosure = () => shutdown(0);
  const handleStdoutClose = () => shutdown(0);
  const handleStdoutError = (error: NodeJS.ErrnoException) => {
    shutdown(error.code === "EPIPE" ? 0 : 1);
  };
  const handleSignal = () => shutdown(0);

  process.stdin.once("end", handleStdinClosure);
  process.stdin.once("close", handleStdinClosure);
  process.stdout.once("close", handleStdoutClose);
  process.stdout.once("error", handleStdoutError);
  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);

  await server.connect(transport);
}
