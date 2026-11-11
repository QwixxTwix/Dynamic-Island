import { call } from "../core/bridge";
import { Emitter } from "../core/emitter";
import { log } from "../core/logger";
import type { BatteryInfo, SystemSnapshot } from "../types";

/** Состояние источника системных данных. */
export type SystemStatus = "live" | "offline";

/** Последний успешный снимок системы. */
export const systemSnapshot = new Emitter<SystemSnapshot>();
/** Изменение доступности нативных данных. */
export const systemStatus = new Emitter<SystemStatus>();

let latest: SystemSnapshot | null = null;
let status: SystemStatus | null = null;
let battery: BatteryInfo | null = null;

const batteryChanged = new Emitter<BatteryInfo | null>();

/** Последний снимок системы или `null`, если данных ещё нет. */
export function getSystemSnapshot(): SystemSnapshot | null {
  return latest;
}

/** Последнее известное состояние батареи. */
export function getBattery(): BatteryInfo | null {
  return battery;
}

/** Подписка на состояние батареи. */
export function subscribeBattery(listener: (value: BatteryInfo | null) => void): () => void {
  return batteryChanged.subscribe(listener);
}

/**
 * Запускает опрос системы.
 *
 * @param intervalMs интервал между запросами; значения меньше секунды приводятся к секунде.
 * @returns функция остановки опроса.
 */
export function startSystemPolling(intervalMs: number): () => void {
  let stopped = false;
  let busy = false;

  const sample = async (): Promise<void> => {
    if (stopped || busy) return;
    busy = true;
    const data = await call<SystemSnapshot>("system_snapshot");
    busy = false;
    if (stopped) return;

    if (!data) {
      publishStatus("offline");
      return;
    }

    latest = data;
    publishStatus("live");
    systemSnapshot.emit(data);
  };

  const publishStatus = (next: SystemStatus): void => {
    if (status === next) return;
    status = next;
    systemStatus.emit(next);
  };

  void sample();
  const timer = window.setInterval(() => void sample(), Math.max(1000, intervalMs));
  return () => {
    stopped = true;
    window.clearInterval(timer);
  };
}

interface BatteryManagerLike {
  level: number;
  charging: boolean;
  addEventListener(type: "levelchange" | "chargingchange", listener: () => void): void;
}

type NavigatorWithBattery = Navigator & { getBattery?: () => Promise<BatteryManagerLike> };

/**
 * Подписывается на батарею через Battery Status API (поддерживает WebView2).
 *
 * @returns функция отписки; если API недоступен, ничего не делает.
 */
export function watchBattery(): () => void {
  const getBattery = (navigator as NavigatorWithBattery).getBattery?.bind(navigator);
  if (!getBattery) return () => {};

  let active = true;
  const publish = (manager: BatteryManagerLike): void => {
    battery = { level: manager.level, charging: manager.charging };
    batteryChanged.emit(battery);
  };

  void getBattery()
    .then((manager) => {
      if (!active) return;
      publish(manager);
      manager.addEventListener("levelchange", () => publish(manager));
      manager.addEventListener("chargingchange", () => publish(manager));
    })
    .catch((error: unknown) => {
      log("warn", "Состояние батареи недоступно", error);
    });

  return () => {
    active = false;
  };
}
