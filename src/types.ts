/** Раздел раскрытой панели острова. */
export type PageId = "overview" | "system" | "focus" | "assistant" | "settings";

/** Процесс в списке самых нагруженных. */
export interface ProcessInfo {
  pid: number;
  name: string;
  /** Загрузка CPU в процентах от одного ядра. */
  cpu: number;
  /** Занятая память в байтах. */
  memory: number;
}

/** Диск или раздел. */
export interface DiskInfo {
  name: string;
  mount: string;
  total: number;
  available: number;
}

/** Сетевая активность. */
export interface NetworkInfo {
  rxPerSec: number;
  txPerSec: number;
  totalRx: number;
  totalTx: number;
  interfaces: number;
  /** Интерфейс, похожий на VPN-подключение. */
  vpnInterface: string | null;
}

/** Снимок системы из Rust-команды `system_snapshot`. */
export interface SystemSnapshot {
  hostName: string;
  osName: string;
  osVersion: string;
  cpuBrand: string;
  cpuCores: number;
  cpuUsage: number;
  memoryUsed: number;
  memoryTotal: number;
  swapUsed: number;
  swapTotal: number;
  uptimeSecs: number;
  processCount: number;
  processes: ProcessInfo[];
  disks: DiskInfo[];
  network: NetworkInfo;
}

/** Состояние активного медиасеанса из Rust-команды `media_snapshot`. */
export interface MediaSnapshot {
  available: boolean;
  playing: boolean;
  title: string;
  artist: string;
  album: string;
  app: string;
  positionMs: number;
  durationMs: number;
  /** Обложка в виде data-URI. */
  art: string | null;
}

/** Доступные акценты интерфейса. */
export type AccentId =
  | "violet"
  | "blue"
  | "indigo"
  | "cyan"
  | "mint"
  | "green"
  | "amber"
  | "red"
  | "rose"
  | "graphite";

/** Настройки ассистента: ключ хранится только локально. */
export interface AssistantSettings {
  baseUrl: string;
  model: string;
  apiKey: string;
}

/** Город для прогноза: найденный геокодером или сохранённый пользователем. */
export interface WeatherPlace {
  /** Название города так, как его вернул геокодер. */
  name: string;
  /** Регион, область или штат; пустая строка, если геокодер его не знает. */
  region: string;
  /** Страна; пустая строка, если геокодер её не знает. */
  country: string;
  latitude: number;
  longitude: number;
}

/** Пользовательские настройки острова. */
export interface Settings {
  accent: AccentId;
  alwaysOnTop: boolean;
  showSeconds: boolean;
  /** Капли, стекающие по кромке свёрнутой пилюли. */
  showDrips: boolean;
  /** Живой персонаж: моргание, взгляд за курсором и смена выражения. */
  liveMascot: boolean;
  /** Подпись выбранного города: «Москва» или «Ростов-на-Дону, Ростовская область». */
  city: string;
  latitude: number | null;
  longitude: number | null;
  /** Города для быстрого переключения; первый — не обязательно текущий. */
  savedCities: WeatherPlace[];
  units: "metric" | "imperial";
  systemIntervalMs: number;
  assistant: AssistantSettings;
}

/** Тональность уведомления. */
export type NotificationTone = "info" | "success" | "warning";

/** Запись в центре уведомлений. */
export interface AppNotification {
  id: string;
  title: string;
  body: string;
  glyph: string;
  tone: NotificationTone;
  at: number;
  read: boolean;
}

/** Текущая погода. */
export interface WeatherNow {
  temperature: number;
  apparent: number;
  humidity: number;
  wind: number;
  code: number;
  isDay: boolean;
}

/** Прогноз на день. */
export interface WeatherDay {
  date: string;
  code: number;
  min: number;
  max: number;
}

/** Ответ сервиса погоды. */
export interface Weather {
  place: string;
  now: WeatherNow;
  days: WeatherDay[];
  updatedAt: number;
  units: Settings["units"];
}

/** Состояние батареи из Battery Status API. */
export interface BatteryInfo {
  /** Уровень заряда 0..1. */
  level: number;
  charging: boolean;
}

/** Сообщение диалога с ассистентом. */
export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  at: number;
  pending?: boolean;
}
