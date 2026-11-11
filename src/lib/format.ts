/** Чистые функции форматирования: без DOM и без обращений к Rust. */

const BYTE_UNITS = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Ограничивает значение отрезком `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Считает долю `value / total` в диапазоне 0..1; при `total = 0` возвращает 0. */
export function ratio(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return clamp(value / total, 0, 1);
}

/** Форматирует байты: `1536` → «1,5 КБ». */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 Б";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits).replace(".", ",")} ${BYTE_UNITS[unit]}`;
}

/** Форматирует скорость: `1536` → «1,5 КБ/с». */
export function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/с`;
}

/** Форматирует проценты: `12.34` → «12%». */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.round(clamp(value, 0, 100))}%`;
}

/** Форматирует длительность: `75000` → «1:15», `3 725 000` → «1:02:05». */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Форматирует время: «12:34» или «12:34:56». */
export function formatClock(date: Date, withSeconds = false): string {
  const options: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" as const } : {}),
  };
  return new Intl.DateTimeFormat("ru-RU", options).format(date);
}

/** Форматирует дату: «Суббота, 12 апреля». */
export function formatDateLong(date: Date): string {
  const text = new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
  return capitalize(text);
}

/** Короткий день недели для прогноза: «Сегодня» или «чт». */
export function formatWeekday(isoDate: string, now: Date = new Date()): string {
  const date = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "—";

  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return "Сегодня";

  return new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(date).replace(".", "");
}

/** Форматирует «сколько прошло»: «только что», «5 мин назад», «3 ч назад». */
export function formatRelative(timestamp: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - timestamp);
  if (diff < MINUTE) return "только что";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} мин назад`;
  if (diff < 24 * HOUR) return `${Math.floor(diff / HOUR)} ч назад`;
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(timestamp));
}

/** Форматирует аптайм: «3 д 4 ч». */
export function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} д ${hours} ч`;
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  return `${minutes} мин`;
}

/** Поднимает первую букву: «суббота» → «Суббота». */
export function capitalize(value: string): string {
  if (value.length === 0) return value;
  return value[0]!.toUpperCase() + value.slice(1);
}

/** Экранирует данные из внешних источников перед вставкой в `innerHTML`. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
