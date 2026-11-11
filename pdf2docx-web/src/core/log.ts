export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class Logger {
  private level: LogLevel = 'info';

  setLevel(level: LogLevel) {
    this.level = level;
  }

  private shouldLog(msgLevel: LogLevel): boolean {
    const levels: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
    return levels[msgLevel] >= levels[this.level];
  }

  debug(msg: string, ...args: unknown[]) {
    if (this.shouldLog('debug')) {
      console.debug(`[DEBUG] ${msg}`, ...args);
    }
  }

  info(msg: string, ...args: unknown[]) {
    if (this.shouldLog('info')) {
      console.info(`[INFO] ${msg}`, ...args);
    }
  }

  warn(msg: string, ...args: unknown[]) {
    if (this.shouldLog('warn')) {
      console.warn(`[WARN] ${msg}`, ...args);
    }
  }

  error(msg: string, ...args: unknown[]) {
    if (this.shouldLog('error')) {
      console.error(`[ERROR] ${msg}`, ...args);
    }
  }
}

export const logger = new Logger();
