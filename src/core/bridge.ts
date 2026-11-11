import { invoke } from "@tauri-apps/api/core";

import { log } from "./logger";

/**
 * `true`, когда интерфейс запущен внутри Tauri.
 *
 * В обычном браузере (`npm run dev` без `tauri dev`) нативные команды
 * недоступны, и интерфейс работает в демонстрационном режиме.
 */
export const isNativeRuntime =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Безопасно вызывает Rust-команду.
 *
 * @param command имя команды, зарегистрированной в `invoke_handler`.
 * @param args аргументы команды в camelCase.
 * @returns данные команды или `null`, если приложение запущено вне Tauri либо
 * команда вернула ошибку. Ошибка при этом попадает в журнал, но не роняет интерфейс.
 */
export async function call<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isNativeRuntime) return null;

  try {
    return await invoke<T>(command, args);
  } catch (error) {
    log("warn", `Команда «${command}» не выполнена`, error);
    return null;
  }
}
