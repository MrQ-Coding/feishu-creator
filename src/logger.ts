export class Logger {
  private static enabled = true;

  static setEnabled(enabled: boolean): void {
    Logger.enabled = enabled;
  }

  static info(message: string, ...args: unknown[]): void {
    if (!Logger.enabled) return;
    console.error(`[INFO] ${message}`, ...args);
  }

  static warn(message: string, ...args: unknown[]): void {
    if (!Logger.enabled) return;
    console.error(`[WARN] ${message}`, ...args);
  }

  static error(message: string, ...args: unknown[]): void {
    if (!Logger.enabled) return;
    console.error(`[ERROR] ${message}`, ...args);
  }
}

