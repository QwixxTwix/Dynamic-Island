import { call } from "../core/bridge";
import { Emitter } from "../core/emitter";
import type { MediaSnapshot } from "../types";

/** Команды, которые понимает SMTC. */
export type MediaAction = "playpause" | "play" | "pause" | "next" | "previous";

/** Изменение состояния плеера. */
export const mediaChanged = new Emitter<MediaSnapshot | null>();

let latest: MediaSnapshot | null = null;
let sampledAt = 0;
let busy = false;

/** Последнее состояние плеера. */
export function getMedia(): MediaSnapshot | null {
  return latest;
}

/** Момент последнего опроса — нужен для плавного движения полосы прогресса. */
export function getMediaSampledAt(): number {
  return sampledAt;
}

/**
 * Читает состояние активного медиасеанса один раз и публикует результат.
 *
 * Параллельные вызовы схлопываются: опрос и нажатие кнопки не должны
 * конкурировать за один и тот же COM-сеанс.
 */
export async function refreshMedia(): Promise<void> {
  if (busy) return;
  busy = true;
  const data = await call<MediaSnapshot>("media_snapshot");
  busy = false;

  latest = data && data.available && data.title.length > 0 ? data : null;
  sampledAt = Date.now();
  mediaChanged.emit(latest);
}

/**
 * Запускает опрос SMTC.
 *
 * @param intervalMs период опроса; SMTC не присылает события, поэтому опрос неизбежен.
 * @returns функция остановки.
 */
export function startMediaPolling(intervalMs = 2500): () => void {
  void refreshMedia();
  const timer = window.setInterval(() => void refreshMedia(), Math.max(1000, intervalMs));
  return () => window.clearInterval(timer);
}

/**
 * Отправляет команду активному плееру.
 *
 * @returns `true`, если плеер принял действие.
 */
export async function mediaControl(action: MediaAction): Promise<boolean> {
  const accepted = await call<boolean>("media_control", { action });
  // Плееры применяют команду не мгновенно — даём им время и перечитываем состояние.
  window.setTimeout(() => void refreshMedia(), 320);
  return accepted === true;
}

/**
 * Перематывает активный трек на заданную позицию.
 *
 * Позиция обновляется оптимистично: полоса в интерфейсе перескакивает сразу,
 * а подтверждение приходит из SMTC при следующем опросе.
 *
 * @param positionMs целевая позиция в миллисекундах; отрицательные значения обрезаются.
 * @returns `true`, если плеер принял запрос.
 */
export async function seekMedia(positionMs: number): Promise<boolean> {
  const target = Math.max(0, Math.round(positionMs));
  if (latest) {
    latest = { ...latest, positionMs: target };
    sampledAt = Date.now();
    mediaChanged.emit(latest);
  }

  const accepted = await call<boolean>("media_seek", { positionMs: target });
  window.setTimeout(() => void refreshMedia(), 400);
  return accepted === true;
}
