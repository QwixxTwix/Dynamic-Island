import { getCurrentWindow } from "@tauri-apps/api/window";

import "./style.css";
import { call, isNativeRuntime } from "./core/bridge";
import { log } from "./core/logger";
import { formatClock, formatDateLong, formatDuration, formatPercent } from "./lib/format";
import { focusTimer } from "./services/focus";
import { getMedia, mediaChanged, refreshMedia, startMediaPolling } from "./services/media";
import { pushNotification, unreadCount } from "./services/notifications";
import { settings } from "./services/settings";
import {
  getBattery,
  getSystemSnapshot,
  startSystemPolling,
  systemSnapshot,
  systemStatus,
  watchBattery,
} from "./services/system";
import { describeWeatherCode, formatTemperature, getWeather, loadWeather } from "./services/weather";
import type { PageId } from "./types";
import { createCapsule, type CapsuleActivity } from "./ui/capsule";
import type { AppContext, ShellApi } from "./ui/context";
import { requireElement } from "./ui/dom";
import { createDrips } from "./ui/drips";
import { resolveMood, type Mood } from "./ui/mascot";
import { assistantPage } from "./ui/pages/assistant";
import { focusPage } from "./ui/pages/focus";
import { overviewPage } from "./ui/pages/overview";
import { settingsPage } from "./ui/pages/settings";
import { systemPage } from "./ui/pages/system";
import { createPanel, type PageFactory, type PanelView } from "./ui/panel";
import { prettifySource } from "./ui/widgets";

/**
 * Размер окна в свёрнутом состоянии: пилюля `--capsule-height` (40px), полоса
 * капель `--drip-height` (36px) под ней и поля `#app` по 8px. Должен совпадать
 * с `COMPACT_SIZE` в Rust и окном в `tauri.conf.json`.
 */
const COMPACT = { width: 264, height: 92 } as const;
const EXPANDED = { width: 500, height: 560 } as const;

const WEATHER_REFRESH_MS = 15 * 60_000;
const CPU_ALERT_COOLDOWN_MS = 10 * 60_000;
const CLOCK_TICK_MS = 1000;

const island = requireElement<HTMLElement>("#island");

const FACTORIES: Record<PageId, PageFactory> = {
  overview: overviewPage,
  system: systemPage,
  focus: focusPage,
  assistant: assistantPage,
  settings: settingsPage,
};

let expanded = false;
let clickThrough = false;
let clickThroughTimer = 0;
let stopSystemPolling: (() => void) | null = null;
let pollingIntervalMs = 0;
let lastCpuAlertAt = 0;
let previousTrackKey = "";
let hasMediaSample = false;
let previousSettings = settings.value;

const shell: ShellApi = {
  setPage(page: PageId): void {
    if (!expanded) void setExpanded(true);
    panel.setPage(page);
  },
  collapse(): void {
    void setExpanded(false);
  },
  refresh: (): Promise<void> => shellRefresh(),
  openTarget: (target: string): Promise<void> => openTarget(target),
  enableClickThrough: (seconds: number): void => enableClickThrough(seconds),
  quit(): void {
    void call("quit_app");
  },
  flash: (message: string): void => panel.flash(message),
};

const context: AppContext = { shell, settings, notify: pushNotification };

const capsule = createCapsule(() => void setExpanded(!expanded));
island.append(capsule.element);

const panel: PanelView = createPanel({
  factories: FACTORIES,
  context,
  onRefresh: () => void shellRefresh(),
  onCollapse: () => void setExpanded(false),
});
island.append(panel.element);

// Капельки живут отдельным слоем НАД корпусом: canvas накрывает пилюлю и полосу
// под ней, но рисует только СНАРУЖИ силуэта (`clip("evenodd")` в `drips.ts`).
// Поэтому вода стекает по всей нижней кромке, включая скругления, и не обрезается
// `overflow: hidden` корпуса.
const drips = createDrips();
requireElement<HTMLElement>("#app").append(drips.element);

/** Меняет размер окна через Rust: `dock_window` центрирует остров сверху. */
async function dock(next: boolean): Promise<void> {
  const size = next ? EXPANDED : COMPACT;
  await call<null>("dock_window", { width: size.width, height: size.height });
}

/**
 * Капли стекают только с свёрнутой пилюли и только когда эффект включён в
 * настройках: над раскрытой панелью воде нечего делать.
 */
function syncDrips(): void {
  drips.setActive(!expanded && settings.value.showDrips);
}

/** Раскрывает или сворачивает остров. */
async function setExpanded(next: boolean): Promise<void> {
  if (next === expanded) return;
  expanded = next;

  if (!next) {
    panel.setExpanded(false);
    island.classList.remove("expanded");
    document.documentElement.dataset.view = "compact";
    renderCapsule();
    await dock(false);
    // Включаем капли после того, как окно вернулось к размеру пилюли:
    // иначе canvas измерит ещё раскрытую панель.
    syncDrips();
    return;
  }

  syncDrips();
  await dock(true);
  island.classList.add("expanded");
  document.documentElement.dataset.view = "expanded";
  panel.setExpanded(true);
  renderCapsule();
}

/** Принудительно обновляет данные, которые не опрашиваются автоматически. */
async function shellRefresh(): Promise<void> {
  await Promise.all([refreshMedia(), loadWeather(settings.value, { force: true })]);
  panel.flash("Данные обновлены");
}

/** Открывает разрешённое системное действие. */
async function openTarget(target: string): Promise<void> {
  const opened = await call<boolean>("open_target", { target });
  if (opened !== true) panel.flash("Действие недоступно");
}

/** Включает сквозные клики на время, чтобы добраться до рабочего стола под островом. */
function enableClickThrough(seconds: number): void {
  if (!isNativeRuntime) {
    panel.flash("Сквозные клики доступны в приложении");
    return;
  }

  const appWindow = getCurrentWindow();
  void appWindow.setIgnoreCursorEvents(true).catch((error: unknown) => {
    log("warn", "Сквозные клики недоступны", error);
  });

  clickThrough = true;
  renderCapsule();
  window.clearTimeout(clickThroughTimer);
  clickThroughTimer = window.setTimeout(
    () => {
      void appWindow.setIgnoreCursorEvents(false).catch((error: unknown) => {
        log("warn", "Не удалось вернуть перехват кликов", error);
      });
      clickThrough = false;
      renderCapsule();
    },
    Math.max(5, seconds) * 1000,
  );
}

/** Поднимает акцент темы на корневой элемент документа. */
function applyAccent(): void {
  document.documentElement.dataset.accent = settings.value.accent;
}

/** Применяет настройки окна, доступные только в Tauri. */
async function applyWindowSettings(): Promise<void> {
  if (!isNativeRuntime) return;
  try {
    await getCurrentWindow().setAlwaysOnTop(settings.value.alwaysOnTop);
  } catch (error) {
    log("warn", "Не удалось применить режим «поверх окон»", error);
  }
}

/** Перезапускает опрос системы при смене интервала. */
function syncPolling(intervalMs: number): void {
  if (stopSystemPolling && pollingIntervalMs === intervalMs) return;
  stopSystemPolling?.();
  pollingIntervalMs = intervalMs;
  stopSystemPolling = startSystemPolling(intervalMs);
}

/** Собирает живые активности для свёрнутой пилюли. */
function collectActivities(): CapsuleActivity[] {
  const activities: CapsuleActivity[] = [];
  const timer = focusTimer.current;

  if (timer.totalMs > 0) {
    activities.push({
      id: "focus",
      glyph: "◔",
      label: timer.running ? "Фокус" : "Пауза",
      value: formatDuration(timer.remainingMs),
    });
  }

  const media = getMedia();
  if (media) {
    activities.push({
      id: "media",
      glyph: media.playing ? "❙❙" : "▶",
      label: prettifySource(media.app),
      value: media.artist ? `${media.artist} — ${media.title}` : media.title,
    });
  }

  const weather = getWeather();
  if (weather) {
    activities.push({
      id: "weather",
      glyph: describeWeatherCode(weather.now.code).glyph,
      label: "Погода",
      value: `${formatTemperature(weather.now.temperature, weather.units)} · ${weather.place}`,
    });
  }

  const system = getSystemSnapshot();
  if (system) {
    const memory = (system.memoryUsed / Math.max(system.memoryTotal, 1)) * 100;
    activities.push({
      id: "system",
      glyph: "▤",
      label: "Система",
      value: `CPU ${formatPercent(system.cpuUsage)} · RAM ${formatPercent(memory)}`,
    });
  }

  activities.push({
    id: "clock",
    glyph: "◷",
    label: "Island",
    value: formatDateLong(new Date()),
  });

  return activities;
}

/** Настроение персонажа в пилюле: состояние приложения → выражение глаз. */
function mascotMood(): Mood {
  const media = getMedia();
  const system = getSystemSnapshot();
  const battery = getBattery();
  const timer = focusTimer.current;

  return resolveMood({
    hour: new Date().getHours(),
    focusRunning: timer.running,
    mediaPlaying: media?.playing ?? false,
    cpu: system?.cpuUsage ?? null,
    batteryLow: battery !== null && !battery.charging && battery.level <= 0.2,
    offline: !isNativeRuntime,
  });
}

/** Обновляет пилюлю. */
function renderCapsule(): void {
  capsule.update({
    time: formatClock(new Date(), settings.value.showSeconds),
    expanded,
    clickThrough,
    offline: !isNativeRuntime,
    unread: unreadCount(),
    activities: collectActivities(),
    mood: mascotMood(),
    liveMascot: settings.value.liveMascot,
  });
}

function registerSubscriptions(): void {
  systemSnapshot.subscribe((snapshot) => {
    renderCapsule();
    const now = Date.now();
    if (snapshot.cpuUsage > 92 && now - lastCpuAlertAt > CPU_ALERT_COOLDOWN_MS) {
      lastCpuAlertAt = now;
      pushNotification({
        title: "Высокая загрузка CPU",
        body: `${formatPercent(snapshot.cpuUsage)} на ${snapshot.hostName || "этом ПК"}`,
        glyph: "▤",
        tone: "warning",
      });
    }
  });

  systemStatus.subscribe((status) => {
    panel.setStatus(
      status === "live" ? "Системные данные в реальном времени" : "Нативные данные недоступны",
      status === "live" ? "ok" : "warn",
    );
  });

  mediaChanged.subscribe((media) => {
    renderCapsule();
    if (!media) {
      previousTrackKey = "";
      return;
    }

    const key = `${media.artist}|${media.title}`;
    if (!hasMediaSample) {
      hasMediaSample = true;
      previousTrackKey = key;
      return;
    }

    if (key !== previousTrackKey) {
      previousTrackKey = key;
      pushNotification({
        title: "Сейчас играет",
        body: media.artist ? `${media.artist} — ${media.title}` : media.title,
        glyph: "♪",
        tone: "info",
      });
    }
  });

  focusTimer.changed.subscribe(() => {
    renderCapsule();
  });

  focusTimer.completed.subscribe(({ label, minutes }) => {
    pushNotification({
      title: "Фокус завершён",
      body: `${label} · ${minutes} мин`,
      glyph: "◔",
      tone: "success",
    });
  });

  settings.changed.subscribe((next) => {
    const weatherChanged = next.units !== previousSettings.units || next.city !== previousSettings.city;
    previousSettings = { ...next };

    applyAccent();
    renderCapsule();
    syncDrips();
    void applyWindowSettings();
    syncPolling(next.systemIntervalMs);
    if (weatherChanged) void loadWeather(next, { force: true });
  });
}

function bootstrap(): void {
  settings.load();
  previousSettings = { ...settings.value };
  applyAccent();
  document.documentElement.dataset.view = "compact";
  syncDrips();

  registerSubscriptions();
  renderCapsule();
  panel.setStatus("Подключение к системе…", "warn");

  void applyWindowSettings();
  syncPolling(settings.value.systemIntervalMs);
  startMediaPolling();
  watchBattery();
  void loadWeather(settings.value);
  void refreshMedia();

  window.setInterval(renderCapsule, CLOCK_TICK_MS);
  window.setInterval(() => void loadWeather(settings.value), WEATHER_REFRESH_MS);

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && expanded) {
      event.preventDefault();
      void setExpanded(false);
    }
  });

  if (isNativeRuntime) {
    pushNotification({
      title: "Island готов",
      body: "Нажмите на пилюлю, чтобы открыть панель",
      glyph: "✦",
      tone: "success",
    });
  }

  log("info", "Island запущен", isNativeRuntime ? "нативное окно" : "браузерный предпросмотр");
}

bootstrap();
