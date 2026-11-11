import { Emitter } from "../core/emitter";
import { log } from "../core/logger";
import type { AccentId, AssistantSettings, Settings, WeatherPlace } from "../types";

const STORAGE_KEY = "island.settings.v1";

/**
 * Описание акцентов: значения дублируются в CSS-переменных `--accent-*`.
 *
 * Палитра — системные цвета Apple из Human Interface Guidelines (тёмная тема),
 * поэтому переключение темы не выводит интерфейс из «яблочной» палитры.
 */
export const ACCENTS: Record<AccentId, { label: string; color: string }> = {
  violet: { label: "Фиолетовый", color: "#bf5af2" },
  blue: { label: "Синий", color: "#0a84ff" },
  indigo: { label: "Индиго", color: "#5e5ce6" },
  cyan: { label: "Голубой", color: "#64d2ff" },
  mint: { label: "Мятный", color: "#66d4cf" },
  green: { label: "Зелёный", color: "#30d158" },
  amber: { label: "Оранжевый", color: "#ff9f0a" },
  red: { label: "Красный", color: "#ff453a" },
  rose: { label: "Розовый", color: "#ff375f" },
  graphite: { label: "Графит", color: "#8e8e93" },
};

/** Город по умолчанию — Москва: координаты заданы без обращения к сети. */
const DEFAULT_PLACE: WeatherPlace = {
  name: "Москва",
  region: "Москва",
  country: "Россия",
  latitude: 55.7558,
  longitude: 37.6173,
};

/** Настройки по умолчанию. */
export const DEFAULT_SETTINGS: Settings = {
  accent: "violet",
  alwaysOnTop: true,
  showSeconds: false,
  showDrips: true,
  liveMascot: true,
  city: DEFAULT_PLACE.name,
  latitude: DEFAULT_PLACE.latitude,
  longitude: DEFAULT_PLACE.longitude,
  savedCities: [DEFAULT_PLACE],
  units: "metric",
  systemIntervalMs: 1500,
  assistant: {
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    apiKey: "",
  },
};

/** Частичное обновление настроек. */
export type SettingsPatch = Partial<Omit<Settings, "assistant">> & {
  assistant?: Partial<AssistantSettings>;
};

/** Хранилище настроек: localStorage + применение внешнего вида. */
class SettingsStore {
  /** Событие изменения настроек. */
  readonly changed = new Emitter<Settings>();

  private current: Settings = { ...DEFAULT_SETTINGS };

  /** Текущие настройки. */
  get value(): Settings {
    return this.current;
  }

  /** Читает настройки из localStorage и применяет их к документу. */
  load(): Settings {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) this.current = sanitize(JSON.parse(raw) as unknown);
    } catch (error) {
      log("warn", "Не удалось прочитать настройки, используются значения по умолчанию", error);
    }
    return this.current;
  }

  /** Сохраняет частичное изменение и уведомляет подписчиков. */
  update(patch: SettingsPatch): Settings {
    this.current = {
      ...this.current,
      ...patch,
      assistant: { ...this.current.assistant, ...(patch.assistant ?? {}) },
    };

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.current));
    } catch (error) {
      log("warn", "Не удалось сохранить настройки", error);
    }

    this.changed.emit(this.current);
    return this.current;
  }
}

/** Единственный экземпляр настроек приложения. */
export const settings = new SettingsStore();

/** Приводит прочитанный JSON к валидной структуре настроек. */
function sanitize(input: unknown): Settings {
  const source = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const defaults = DEFAULT_SETTINGS;
  const accent = typeof source.accent === "string" && source.accent in ACCENTS
    ? (source.accent as AccentId)
    : defaults.accent;
  const assistantRaw = (typeof source.assistant === "object" && source.assistant !== null
    ? source.assistant
    : {}) as Record<string, unknown>;

  const latitude = pickCoordinate(source.latitude, defaults.latitude);
  const longitude = pickCoordinate(source.longitude, defaults.longitude);
  const savedCities = pickPlaces(source.savedCities, defaults.savedCities);
  const city = pickString(source.city, defaults.city);

  return {
    accent,
    alwaysOnTop: pickBoolean(source.alwaysOnTop, defaults.alwaysOnTop),
    showSeconds: pickBoolean(source.showSeconds, defaults.showSeconds),
    showDrips: pickBoolean(source.showDrips, defaults.showDrips),
    liveMascot: pickBoolean(source.liveMascot, defaults.liveMascot),
    city,
    latitude,
    longitude,
    // Текущий город всегда есть в списке сохранённых — иначе переключение «пропадёт».
    savedCities:
      savedCities.some((place) => place.name === city)
        ? savedCities
        : [{ name: city, region: "", country: "", latitude: latitude ?? 0, longitude: longitude ?? 0 }, ...savedCities].slice(0, 8),
    units: source.units === "imperial" ? "imperial" : "metric",
    systemIntervalMs: clampInterval(pickNumber(source.systemIntervalMs, defaults.systemIntervalMs)),
    assistant: {
      baseUrl: pickString(assistantRaw.baseUrl, defaults.assistant.baseUrl),
      model: pickString(assistantRaw.model, defaults.assistant.model),
      apiKey: pickString(assistantRaw.apiKey, defaults.assistant.apiKey),
    },
  };
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function pickNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function pickCoordinate(value: unknown, fallback: number | null): number | null {
  if (value === null) return null;
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 180 ? value : fallback;
}

function pickString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/** Читает список городов, отбрасывая записи без корректных координат. */
function pickPlaces(value: unknown, fallback: WeatherPlace[]): WeatherPlace[] {
  if (!Array.isArray(value)) return [...fallback];

  const places: WeatherPlace[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const name = pickString(record.name, "").trim();
    const latitude = pickCoordinate(record.latitude, null);
    const longitude = pickCoordinate(record.longitude, null);
    if (name.length === 0 || latitude === null || longitude === null) continue;
    places.push({
      name,
      region: pickString(record.region, "").trim(),
      country: pickString(record.country, "").trim(),
      latitude,
      longitude,
    });
  }

  return places.length > 0 ? places.slice(0, 8) : [...fallback];
}

function clampInterval(value: number): number {
  return Math.min(Math.max(Math.round(value), 1000), 10_000);
}
