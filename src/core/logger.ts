/** Уровни журнала приложения. */
export type LogLevel = "info" | "warn" | "error";

/** Запись журнала. */
export interface LogEntry {
  level: LogLevel;
  message: string;
  detail?: string;
  at: number;
}

const MAX_ENTRIES = 40;
const entries: LogEntry[] = [];

/**
 * Пишет запись в журнал приложения.
 *
 * `info` остаётся внутри острова (виден в «Настройки → Диагностика»),
 * `warn` и `error` дополнительно уходят в консоль WebView — это единственный
 * способ увидеть сбой, не открывая интерфейс.
 */
export function log(level: LogLevel, message: string, detail?: unknown): void {
  entries.push({ level, message, detail: describe(detail), at: Date.now() });
  if (entries.length > MAX_ENTRIES) entries.shift();

  if (level === "error") console.error(`[island] ${message}`, detail ?? "");
  else if (level === "warn") console.warn(`[island] ${message}`, detail ?? "");
}

/** Возвращает последние записи журнала (новые в конце). */
export function getLogEntries(): readonly LogEntry[] {
  return entries;
}

/** Приводит произвольный объект ошибки к короткой строке. */
function describe(detail: unknown): string | undefined {
  if (detail === undefined || detail === null) return undefined;
  if (detail instanceof Error) return detail.message;
  if (typeof detail === "string") return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}
