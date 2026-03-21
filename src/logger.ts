type LogLevel = "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
}

export class Logger {
  private static enabled = true;
  private static jsonFormat = process.env.LOG_FORMAT === "json";

  static setEnabled(enabled: boolean): void {
    Logger.enabled = enabled;
  }

  static setJsonFormat(json: boolean): void {
    Logger.jsonFormat = json;
  }

  static info(message: string, ...args: unknown[]): void {
    Logger.log("info", message, args);
  }

  static warn(message: string, ...args: unknown[]): void {
    Logger.log("warn", message, args);
  }

  static error(message: string, ...args: unknown[]): void {
    Logger.log("error", message, args);
  }

  private static log(level: LogLevel, message: string, args: unknown[]): void {
    if (!Logger.enabled) return;

    if (Logger.jsonFormat) {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level,
        message,
      };
      if (args.length > 0) {
        entry.data = args.length === 1 ? args[0] : args;
      }
      console.error(JSON.stringify(entry));
    } else {
      console.error(`[${level.toUpperCase()}] ${message}`, ...args);
    }
  }
}
