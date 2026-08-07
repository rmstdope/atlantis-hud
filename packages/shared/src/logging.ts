export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEntry = {
  app: string;
  level: LogLevel;
  message: string;
  timestamp: string;
};

const MAX_BUFFER_SIZE = 200;

export class RingBufferLogger {
  private readonly app: string;
  private readonly entries: LogEntry[] = [];

  constructor(app: string) {
    this.app = app;
  }

  write(level: LogLevel, message: string): LogEntry {
    const entry: LogEntry = {
      app: this.app,
      level,
      message,
      timestamp: new Date().toISOString()
    };

    this.entries.push(entry);
    if (this.entries.length > MAX_BUFFER_SIZE) {
      this.entries.splice(0, this.entries.length - MAX_BUFFER_SIZE);
    }

    return entry;
  }

  snapshot(): LogEntry[] {
    return [...this.entries];
  }
}

export function toJsonLines(entries: LogEntry[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join("\n");
}
