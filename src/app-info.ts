/**
 * Идентичность приложения: имя, версия и автор.
 *
 * Единая точка правды для интерфейса (подвал панели, раздел «Настройки», подпись
 * пилюли). Значения должны совпадать с `productName`/`version` в
 * `src-tauri/tauri.conf.json` и с `version` в `package.json`.
 */
export const APP_NAME = "Island";

/** Версия продукта — показывает подвал панели и карточка «О приложении». */
export const APP_VERSION = "0.1.0";

/** Автор проекта — подпись в интерфейсе и в метаданных Windows-сборки. */
export const APP_AUTHOR = "idqwixxa";

/** Готовая подпись «Island · idqwixxa» для `title` и `aria-label`. */
export const APP_SIGNATURE = `${APP_NAME} · ${APP_AUTHOR}`;
