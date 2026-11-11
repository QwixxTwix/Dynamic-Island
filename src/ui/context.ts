import type { PageId, Settings } from "../types";
import type { NotificationInput } from "../services/notifications";
import { settings, type SettingsPatch } from "../services/settings";

/** Действия, которые раздел может попросить у оболочки острова. */
export interface ShellApi {
  /** Переключает раздел панели. */
  setPage(page: PageId): void;
  /** Сворачивает остров в пилюлю. */
  collapse(): void;
  /** Перезапрашивает данные всех сервисов. */
  refresh(): Promise<void>;
  /** Запускает системное действие из белого списка Rust-команды `open_target`. */
  openTarget(target: string): Promise<void>;
  /** Включает сквозные клики на заданное время, чтобы добраться до рабочего стола. */
  enableClickThrough(seconds: number): void;
  /** Закрывает приложение. */
  quit(): void;
  /** Показывает короткое сообщение в подвале панели. */
  flash(message: string): void;
}

/**
 * Зависимости, которые оболочка передаёт разделам.
 *
 * Разделы не создают сервисы сами: единственный экземпляр настроек и оболочки
 * живёт в приложении, что делает поведение предсказуемым и тестируемым.
 */
export interface AppContext {
  shell: ShellApi;
  settings: typeof settings;
  /** Публикует уведомление в центре острова. */
  notify(input: NotificationInput): void;
}

/** Тип настроек, доступный разделам. */
export type ReadonlySettings = Readonly<Settings>;

/** Частичное обновление настроек, которое принимает оболочка. */
export type { SettingsPatch };
