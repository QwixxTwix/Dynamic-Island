import { Emitter } from "../core/emitter";
import { log } from "../core/logger";
import type { Settings, Weather, WeatherDay, WeatherNow, WeatherPlace } from "../types";

const CACHE_KEY = "island.weather.v2";
const CACHE_TTL_MS = 10 * 60_000;
/** Сколько храним прошлый удачный снимок: при падении сети лучше он, чем пустота. */
const STALE_TTL_MS = 24 * 60 * 60_000;
const REQUEST_TIMEOUT_MS = 12_000;
/** Сколько вариантов города показывать в подсказках поиска. */
const GEOCODE_LIMIT = 6;
/** Допуск сравнения координат: геокодер округляет по-разному в разных странах. */
const COORD_TOLERANCE = 0.01;

/** Изменение погоды. */
export const weatherChanged = new Emitter<Weather | null>();

let latest: Weather | null = null;

/** Последняя загруженная погода. */
export function getWeather(): Weather | null {
  return latest;
}

/** Расшифровка кодов WMO, которые отдаёт Open-Meteo. */
const WEATHER_CODES: Record<number, { label: string; glyph: string }> = {
  0: { label: "Ясно", glyph: "☀" },
  1: { label: "Преимущественно ясно", glyph: "🌤" },
  2: { label: "Переменная облачность", glyph: "⛅" },
  3: { label: "Пасмурно", glyph: "☁" },
  45: { label: "Туман", glyph: "🌫" },
  48: { label: "Изморозь", glyph: "🌫" },
  51: { label: "Слабая морось", glyph: "🌦" },
  53: { label: "Морось", glyph: "🌦" },
  55: { label: "Сильная морось", glyph: "🌧" },
  56: { label: "Ледяная морось", glyph: "🌧" },
  57: { label: "Ледяная морось", glyph: "🌧" },
  61: { label: "Небольшой дождь", glyph: "🌦" },
  63: { label: "Дождь", glyph: "🌧" },
  65: { label: "Сильный дождь", glyph: "🌧" },
  66: { label: "Ледяной дождь", glyph: "🌧" },
  67: { label: "Ледяной дождь", glyph: "🌧" },
  71: { label: "Небольшой снег", glyph: "🌨" },
  73: { label: "Снег", glyph: "🌨" },
  75: { label: "Сильный снег", glyph: "❄" },
  77: { label: "Снежные зёрна", glyph: "❄" },
  80: { label: "Ливень", glyph: "🌦" },
  81: { label: "Сильный ливень", glyph: "🌧" },
  82: { label: "Очень сильный ливень", glyph: "🌧" },
  85: { label: "Снегопад", glyph: "🌨" },
  86: { label: "Сильный снегопад", glyph: "❄" },
  95: { label: "Гроза", glyph: "⛈" },
  96: { label: "Гроза с градом", glyph: "⛈" },
  99: { label: "Сильная гроза с градом", glyph: "⛈" },
};

/** Подпись и глиф для кода WMO из Open-Meteo. */
export function describeWeatherCode(code: number): { label: string; glyph: string } {
  return WEATHER_CODES[code] ?? { label: "Нет данных", glyph: "◌" };
}

/** Форматирует температуру с единицами измерения: `-3` → «-3°C». */
export function formatTemperature(value: number, units: Settings["units"]): string {
  if (!Number.isFinite(value)) return "—";
  return `${Math.round(value)}°${units === "imperial" ? "F" : "C"}`;
}

/** Форматирует ветер: Open-Meteo отдаёт м/с для метрики и мили/ч для имперских единиц. */
export function formatWind(value: number, units: Settings["units"]): string {
  if (!Number.isFinite(value)) return "—";
  return `${Math.round(value)} ${units === "imperial" ? "миль/ч" : "м/с"}`;
}

/**
 * Собирает подпись города.
 *
 * @param options.withCountry добавляет страну — нужно в списке результатов поиска.
 */
export function placeLabel(place: WeatherPlace, options: { withCountry?: boolean } = {}): string {
  const parts = [place.name];
  if (place.region.length > 0 && place.region !== place.name) parts.push(place.region);
  if (options.withCountry && place.country.length > 0 && place.country !== place.region) parts.push(place.country);
  return parts.join(", ");
}

/**
 * Загружает погоду для координат из настроек.
 *
 * @param options.force игнорировать кэш (кнопка «обновить»).
 * @returns свежие данные, прошлый удачный снимок или `null`, если данных ещё не было.
 */
export async function loadWeather(
  current: Settings,
  options: { force?: boolean } = {},
): Promise<Weather | null> {
  const cached = readCache(current);
  if (cached?.fresh && !options.force) {
    latest = cached.data;
    weatherChanged.emit(latest);
    return cached.data;
  }

  if (current.latitude === null || current.longitude === null) {
    log("warn", "Погода не загружена: в настройках нет координат города");
    return latest;
  }

  const params = new URLSearchParams({
    latitude: String(current.latitude),
    longitude: String(current.longitude),
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
    timezone: "auto",
    forecast_days: "4",
    wind_speed_unit: current.units === "imperial" ? "mph" : "ms",
  });
  if (current.units === "imperial") params.set("temperature_unit", "fahrenheit");

  const payload = await requestJson(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
  const weather = payload ? parseWeather(payload, current) : null;

  if (!weather) {
    // Сервис недоступен: показываем последний удачный снимок вместо прочерков.
    if (cached) {
      latest = cached.data;
      weatherChanged.emit(latest);
    }
    return latest;
  }

  latest = weather;
  writeCache(weather, current);
  weatherChanged.emit(latest);
  return latest;
}

/**
 * Ищет города по названию через геокодер Open-Meteo.
 *
 * Понимает запросы на русском и английском («Токио», «Tokyo», «Нью-Йорк»),
 * поэтому подходит для любого города мира, а не только для заранее заданных.
 *
 * @returns отсортированный по населению список; пустой массив, если ничего не найдено.
 */
export async function geocodePlaces(query: string, limit: number = GEOCODE_LIMIT): Promise<WeatherPlace[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const params = new URLSearchParams({
    name: trimmed,
    count: String(Math.min(Math.max(limit, 1), 10)),
    language: "ru",
    format: "json",
  });

  const payload = await requestJson(`https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`);
  const results = asRecord(payload).results;
  if (!Array.isArray(results)) return [];

  const places: WeatherPlace[] = [];
  const seen = new Set<string>();

  for (const entry of results) {
    const record = asRecord(entry);
    const name = asString(record.name, "").trim();
    const latitude = asNumber(record.latitude);
    const longitude = asNumber(record.longitude);
    if (name.length === 0 || latitude === null || longitude === null) continue;

    const place: WeatherPlace = {
      name,
      region: asString(record.admin1, "").trim(),
      country: asString(record.country, "").trim(),
      latitude,
      longitude,
    };

    // Геокодер иногда отдаёт один и тот же город дважды — оставляем первый.
    const key = placeLabel(place, { withCountry: true }).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    places.push(place);
  }

  return places;
}

/** Разбирает ответ Open-Meteo в модель приложения. */
function parseWeather(payload: unknown, current: Settings): Weather | null {
  const root = asRecord(payload);
  const currentBlock = asRecord(root.current);
  const temperature = asNumber(currentBlock.temperature_2m);
  const code = asNumber(currentBlock.weather_code);
  if (temperature === null || code === null) return null;

  const now: WeatherNow = {
    temperature,
    apparent: asNumber(currentBlock.apparent_temperature) ?? temperature,
    humidity: asNumber(currentBlock.relative_humidity_2m) ?? 0,
    wind: asNumber(currentBlock.wind_speed_10m) ?? 0,
    code,
    isDay: asNumber(currentBlock.is_day) !== 0,
  };

  const daily = asRecord(root.daily);
  const dates = Array.isArray(daily.time) ? daily.time : [];
  const codes = Array.isArray(daily.weather_code) ? daily.weather_code : [];
  const minima = Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min : [];
  const maxima = Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max : [];

  const days: WeatherDay[] = [];
  for (let index = 0; index < dates.length && index < 4; index += 1) {
    const dayCode = asNumber(codes[index]);
    const min = asNumber(minima[index]);
    const max = asNumber(maxima[index]);
    const date = asString(dates[index], "");
    if (dayCode === null || min === null || max === null || date.length === 0) continue;
    days.push({ date, code: dayCode, min, max });
  }

  return {
    place: current.city,
    now,
    days,
    updatedAt: Date.now(),
    units: current.units,
  };
}

/** Выполняет GET и разбирает JSON; сетевые ошибки не пробрасываются наружу. */
async function requestJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      log("warn", `Погода: сервис ответил ${response.status}`);
      return null;
    }
    return (await response.json()) as unknown;
  } catch (error) {
    log("warn", "Погода: запрос не выполнен", error);
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

interface CachedWeather {
  at: number;
  units: Settings["units"];
  place: string;
  latitude: number;
  longitude: number;
  data: Weather;
}

interface CachedResult {
  data: Weather;
  /** `true`, если снимок моложе `CACHE_TTL_MS` и его можно отдавать без запроса. */
  fresh: boolean;
}

/** Читает кэш и проверяет, что он относится к тому же городу и единицам. */
function readCache(current: Settings): CachedResult | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<CachedWeather> | null;
    if (!parsed || typeof parsed.at !== "number" || parsed.units !== current.units) return null;
    if (Date.now() - parsed.at > STALE_TTL_MS) return null;

    const data = parsed.data;
    if (!data || data.place !== current.city) return null;
    if (
      parsed.latitude === undefined ||
      parsed.longitude === undefined ||
      current.latitude === null ||
      current.longitude === null ||
      Math.abs(parsed.latitude - current.latitude) > COORD_TOLERANCE ||
      Math.abs(parsed.longitude - current.longitude) > COORD_TOLERANCE
    ) {
      return null;
    }

    return { data, fresh: Date.now() - parsed.at <= CACHE_TTL_MS };
  } catch (error) {
    log("warn", "Погода: кэш повреждён", error);
    return null;
  }
}

function writeCache(weather: Weather, current: Settings): void {
  try {
    const payload: CachedWeather = {
      at: Date.now(),
      units: weather.units,
      place: weather.place,
      latitude: current.latitude ?? 0,
      longitude: current.longitude ?? 0,
      data: weather,
    };
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch (error) {
    log("warn", "Погода: не удалось сохранить кэш", error);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}
