import { APP_AUTHOR, APP_NAME, APP_VERSION } from "../../app-info";
import { getLogEntries } from "../../core/logger";
import { escapeHtml, formatRelative } from "../../lib/format";
import { ACCENTS } from "../../services/settings";
import {
  describeWeatherCode,
  formatTemperature,
  geocodePlaces,
  getWeather,
  placeLabel,
  weatherChanged,
} from "../../services/weather";
import type { AccentId, WeatherPlace } from "../../types";
import type { AppContext } from "../context";
import { requireElement } from "../dom";
import { icon } from "../icons";
import type { PageFactory, PageInstance } from "../panel";

const INTERVALS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1000, label: "Каждую секунду" },
  { value: 2000, label: "Каждые 2 секунды" },
  { value: 5000, label: "Каждые 5 секунд" },
];

/** Погрешность сравнения координат: геокодер и настройки хранят doubles. */
const COORD_EPSILON = 0.001;

/** Добавляет текущее значение в список, если пользователь выбрал его раньше. */
function buildIntervalOptions(currentValue: number): ReadonlyArray<{ value: number; label: string }> {
  if (INTERVALS.some((interval) => interval.value === currentValue)) return INTERVALS;
  return [...INTERVALS, { value: currentValue, label: `Каждые ${(currentValue / 1000).toFixed(1)} с` }];
}

/** Совпадают ли два места с точностью до погрешности координат. */
function samePlace(a: WeatherPlace, b: { latitude: number | null; longitude: number | null }): boolean {
  if (b.latitude === null || b.longitude === null) return false;
  return Math.abs(a.latitude - b.latitude) < COORD_EPSILON && Math.abs(a.longitude - b.longitude) < COORD_EPSILON;
}

/** Логические настройки, которые переключаются тумблерами `data-toggle`. */
type BooleanSetting = "alwaysOnTop" | "showSeconds" | "showDrips" | "liveMascot";

/** Проверяет, что `data-toggle` — известный булевый ключ настроек. */
function isBooleanSetting(value: string | undefined): value is BooleanSetting {
  return value === "alwaysOnTop" || value === "showSeconds" || value === "showDrips" || value === "liveMascot";
}

/** Раздел «Настройки»: окно, погода для любого города, тема, ассистент и диагностика. */
export const settingsPage: PageFactory = (root: HTMLElement, context: AppContext): PageInstance => {
  const current = context.settings.value;
  let places: WeatherPlace[] = [];
  let searchError = "";

  root.innerHTML = `
    <section class="card about-card">
      <img class="about-logo" src="/icon.svg" alt="Логотип ${escapeHtml(APP_NAME)}" width="42" height="42" />
      <div class="about-copy">
        <strong>${escapeHtml(APP_NAME)} <span class="about-version">v${escapeHtml(APP_VERSION)}</span></strong>
        <span class="muted">Живые активности, медиа, погода и системный монитор.</span>
        <span class="about-credit">Автор: ${escapeHtml(APP_AUTHOR)}</span>
      </div>
    </section>

    <section class="card">
      <p class="card-kicker">Погода</p>
      <div class="setting-row">
        <div class="setting-copy">
          <strong data-ref="place-name">${escapeHtml(current.city)}</strong>
          <span class="muted" data-ref="place-meta">Текущий город прогноза</span>
        </div>
        <button class="icon-button" type="button" data-action="weather-refresh" aria-label="Обновить погоду" title="Обновить погоду">${icon("refresh")}</button>
      </div>
      <div class="search-row">
        <input class="input" type="text" data-ref="city" placeholder="Любой город: Токио, Берлин, New York…" autocomplete="off" spellcheck="false" aria-label="Название города" />
        <button class="primary-button" type="button" data-action="city">Найти</button>
      </div>
      <div class="place-results" data-ref="city-results" hidden></div>
      <div class="place-list" data-ref="city-saved"></div>
      <p class="hint">Поиск идёт по всему миру — можно писать по-русски или по-английски. Сохранённые города переключаются одним нажатием.</p>
      <div class="field-row">
        <span class="muted">Единицы</span>
        <div class="segmented">
          <button class="segment" type="button" data-units="metric" aria-pressed="false">°C</button>
          <button class="segment" type="button" data-units="imperial" aria-pressed="false">°F</button>
        </div>
      </div>
    </section>

    <section class="card">
      <p class="card-kicker">Окно</p>
      <div class="setting-row">
        <div class="setting-copy">
          <strong>Поверх всех окон</strong>
          <span class="muted">Остров остаётся видимым даже в полноэкранных приложениях</span>
        </div>
        <button class="switch" type="button" role="switch" data-toggle="alwaysOnTop" aria-checked="false" aria-label="Поверх всех окон"><span></span></button>
      </div>
      <div class="setting-row">
        <div class="setting-copy">
          <strong>Секунды в часах</strong>
          <span class="muted">Показывать секунды в пилюле</span>
        </div>
        <button class="switch" type="button" role="switch" data-toggle="showSeconds" aria-checked="false" aria-label="Секунды в часах"><span></span></button>
      </div>
      <div class="setting-row">
        <div class="setting-copy">
          <strong>Сквозные клики</strong>
          <span class="muted">На 60 секунд Island перестанет перехватывать мышь</span>
        </div>
        <button class="ghost-button" type="button" data-action="click-through">Включить</button>
      </div>
    </section>

    <section class="card">
      <p class="card-kicker">Эффекты</p>
      <div class="setting-row">
        <div class="setting-copy">
          <strong>Капли на островке</strong>
          <span class="muted">Вода собирается по всей нижней кромке пилюли и стекает за её пределами</span>
        </div>
        <button class="switch" type="button" role="switch" data-toggle="showDrips" aria-checked="true" aria-label="Капли на островке"><span></span></button>
      </div>
      <div class="setting-row">
        <div class="setting-copy">
          <strong>Живой персонаж</strong>
          <span class="muted">Глаза моргают, следят за курсором и меняют выражение по настроению</span>
        </div>
        <button class="switch" type="button" role="switch" data-toggle="liveMascot" aria-checked="true" aria-label="Живой персонаж"><span></span></button>
      </div>
    </section>

    <section class="card">
      <p class="card-kicker">Акцент</p>
      <div class="accent-row">
        ${(Object.entries(ACCENTS) as Array<[AccentId, { label: string; color: string }]>)
          .map(
            ([id, accent]) => `
              <button class="accent-chip" type="button" data-accent="${id}" aria-pressed="false" title="${escapeHtml(accent.label)}">
                <span style="background:${accent.color}"></span>${escapeHtml(accent.label)}
              </button>`,
          )
          .join("")}
      </div>
    </section>

    <section class="card">
      <p class="card-kicker">Опрос системы</p>
      <select class="input" data-ref="interval" aria-label="Интервал опроса системы">
        ${buildIntervalOptions(current.systemIntervalMs)
          .map((interval) => `<option value="${interval.value}">${interval.label}</option>`)
          .join("")}
      </select>
    </section>

    <section class="card">
      <p class="card-kicker">Ассистент</p>
      <div class="field-stack">
        <label class="field">
          <span class="muted">Адрес API (OpenAI-совместимый)</span>
          <input class="input" type="text" data-ref="base-url" value="${escapeHtml(current.assistant.baseUrl)}" placeholder="https://api.deepseek.com/v1" />
        </label>
        <label class="field">
          <span class="muted">Модель</span>
          <input class="input" type="text" data-ref="model" value="${escapeHtml(current.assistant.model)}" placeholder="deepseek-chat" />
        </label>
        <label class="field">
          <span class="muted">Ключ API</span>
          <input class="input" type="password" data-ref="api-key" value="${escapeHtml(current.assistant.apiKey)}" placeholder="sk-…" />
        </label>
        <div class="field-row">
          <button class="primary-button" type="button" data-action="save-assistant">Сохранить</button>
          <span class="muted">Ключ хранится только на этом устройстве.</span>
        </div>
      </div>
    </section>

    <section class="card">
      <p class="card-kicker">Диагностика</p>
      <div class="log-list">
        ${
          getLogEntries().length === 0
            ? '<p class="muted">Ошибок не зафиксировано.</p>'
            : [...getLogEntries()]
                .reverse()
                .map(
                  (entry) => `
                    <div class="log-entry level-${entry.level}">
                      <span class="log-time">${escapeHtml(formatRelative(entry.at))}</span>
                      <span class="log-message">${escapeHtml(entry.message)}${entry.detail ? ` — ${escapeHtml(entry.detail)}` : ""}</span>
                    </div>`,
                )
                .join("")
        }
      </div>
    </section>

    <div class="footer-actions">
      <button class="ghost-button" type="button" data-action="collapse">Свернуть</button>
      <button class="ghost-button is-danger" type="button" data-action="quit">Выйти из Island</button>
    </div>
  `;

  const cityNode = requireElement<HTMLInputElement>('[data-ref="city"]', root);
  const searchButton = requireElement<HTMLButtonElement>('[data-action="city"]', root);
  const resultsNode = requireElement<HTMLElement>('[data-ref="city-results"]', root);
  const savedNode = requireElement<HTMLElement>('[data-ref="city-saved"]', root);
  const placeNameNode = requireElement<HTMLElement>('[data-ref="place-name"]', root);
  const placeMetaNode = requireElement<HTMLElement>('[data-ref="place-meta"]', root);
  const intervalNode = requireElement<HTMLSelectElement>('[data-ref="interval"]', root);
  const baseUrlNode = requireElement<HTMLInputElement>('[data-ref="base-url"]', root);
  const modelNode = requireElement<HTMLInputElement>('[data-ref="model"]', root);
  const apiKeyNode = requireElement<HTMLInputElement>('[data-ref="api-key"]', root);

  intervalNode.value = String(current.systemIntervalMs);

  /** Подпись текущей погоды под названием города. */
  const renderCurrentWeather = (): void => {
    const value = context.settings.value;
    placeNameNode.textContent = value.city;

    const weather = getWeather();
    if (weather && weather.place === value.city) {
      const description = describeWeatherCode(weather.now.code);
      placeMetaNode.textContent = `${formatTemperature(weather.now.temperature, weather.units)} · ${description.label}`;
      return;
    }

    placeMetaNode.textContent = "Нажмите «Обновить», чтобы загрузить прогноз";
  };

  /** Список сохранённых городов: один клик — и прогноз уже для него. */
  const renderSaved = (): void => {
    const value = context.settings.value;
    const placesList = value.savedCities;

    if (placesList.length === 0) {
      savedNode.innerHTML = "";
      return;
    }

    savedNode.innerHTML = placesList
      .map((place, index) => {
        const active = samePlace(place, value);
        const meta = [place.region, place.country].filter((part) => part.length > 0 && part !== place.name).join(", ");
        return `
          <div class="place-row ${active ? "is-active" : ""}">
            <button class="place-row-main" type="button" data-place="${index}" aria-pressed="${active}">
              <span class="place-row-name">${escapeHtml(place.name)}</span>
              <span class="place-row-meta">${escapeHtml(meta.length > 0 ? meta : "Координаты сохранены")}</span>
              <span class="place-check" aria-hidden="true">${icon("check")}</span>
            </button>
            ${
              placesList.length > 1
                ? `<button class="place-row-remove" type="button" data-remove="${index}" aria-label="Убрать ${escapeHtml(place.name)}">${icon("close")}</button>`
                : ""
            }
          </div>`;
      })
      .join("");
  };

  /** Результаты поиска: показываем все совпадения, чтобы можно было выбрать нужный город. */
  const renderResults = (): void => {
    if (searchError.length > 0) {
      resultsNode.hidden = false;
      resultsNode.innerHTML = `<p class="place-empty">${escapeHtml(searchError)}</p>`;
      return;
    }

    if (places.length === 0) {
      resultsNode.hidden = true;
      resultsNode.innerHTML = "";
      return;
    }

    resultsNode.hidden = false;
    resultsNode.innerHTML = `
      <p class="card-kicker">Найдено</p>
      ${places
        .map(
          (place, index) => `
            <button class="place-result" type="button" data-result="${index}">
              <span class="place-result-name">${escapeHtml(place.name)}</span>
              <span class="place-result-meta">${escapeHtml(placeLabel(place, { withCountry: true }))}</span>
            </button>`,
        )
        .join("")}
    `;
  };

  /** Синхронизирует переключатели, акценты и единицы с настройками. */
  const sync = (): void => {
    const value = context.settings.value;

    for (const toggle of root.querySelectorAll<HTMLElement>("[data-toggle]")) {
      const key = toggle.dataset.toggle;
      if (!isBooleanSetting(key)) continue;
      const on = value[key];
      toggle.classList.toggle("on", on);
      toggle.setAttribute("aria-checked", String(on));
    }

    for (const chip of root.querySelectorAll<HTMLElement>("[data-accent]")) {
      chip.setAttribute("aria-pressed", String(chip.dataset.accent === value.accent));
    }

    for (const segment of root.querySelectorAll<HTMLElement>("[data-units]")) {
      segment.setAttribute("aria-pressed", String(segment.dataset.units === value.units));
    }

    renderCurrentWeather();
    renderSaved();
  };

  /** Ищет города по всему миру и показывает список совпадений. */
  const searchCity = async (): Promise<void> => {
    const query = cityNode.value.trim();
    if (query.length === 0) {
      context.shell.flash("Введите название города");
      cityNode.focus();
      return;
    }

    searchButton.disabled = true;
    searchButton.textContent = "Ищу…";
    searchError = "";
    context.shell.flash("Ищу город…");

    try {
      places = await geocodePlaces(query, 6);
      if (places.length === 0) searchError = "Город не найден. Уточните название — например, «Ростов Великий» или «Springfield, Illinois».";
    } finally {
      searchButton.disabled = false;
      searchButton.textContent = "Найти";
      renderResults();
    }

    if (places.length === 0) {
      context.shell.flash("Город не найден");
      return;
    }

    context.shell.flash(places.length === 1 ? "Город найден" : `Найдено городов: ${places.length}`);
  };

  /** Делает город текущим и запоминает его в списке сохранённых. */
  const choosePlace = async (place: WeatherPlace): Promise<void> => {
    const value = context.settings.value;
    const saved = [place, ...value.savedCities.filter((item) => !samePlace(item, place))].slice(0, 8);

    context.settings.update({
      city: place.name,
      latitude: place.latitude,
      longitude: place.longitude,
      savedCities: saved,
    });

    places = [];
    searchError = "";
    cityNode.value = "";
    renderResults();
    await context.shell.refresh();
    context.shell.flash(`Погода: ${place.name}`);
  };

  /** Убирает город из списка; если убрали текущий — переключаемся на первый оставшийся. */
  const removePlace = (index: number): void => {
    const value = context.settings.value;
    const removed = value.savedCities[index];
    if (!removed) return;

    const rest = value.savedCities.filter((_, position) => position !== index);
    const next = rest[0];
    const wasActive = samePlace(removed, value);

    context.settings.update({
      savedCities: rest,
      ...(wasActive && next ? { city: next.name, latitude: next.latitude, longitude: next.longitude } : {}),
    });

    if (wasActive && next) void context.shell.refresh();
    context.shell.flash(`Город убран: ${removed.name}`);
  };

  root.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;

    const resultIndex = target?.closest<HTMLElement>("[data-result]")?.dataset.result;
    if (resultIndex !== undefined) {
      const place = places[Number(resultIndex)];
      if (place) void choosePlace(place);
      return;
    }

    const placeIndex = target?.closest<HTMLElement>("[data-place]")?.dataset.place;
    if (placeIndex !== undefined) {
      const place = context.settings.value.savedCities[Number(placeIndex)];
      if (place) void choosePlace(place);
      return;
    }

    const removeIndex = target?.closest<HTMLElement>("[data-remove]")?.dataset.remove;
    if (removeIndex !== undefined) {
      removePlace(Number(removeIndex));
      return;
    }

    const toggle = target?.closest<HTMLElement>("[data-toggle]");
    if (toggle) {
      const key = toggle.dataset.toggle;
      if (!isBooleanSetting(key)) return;
      const value = context.settings.value;
      switch (key) {
        case "alwaysOnTop":
          context.settings.update({ alwaysOnTop: !value.alwaysOnTop });
          break;
        case "showSeconds":
          context.settings.update({ showSeconds: !value.showSeconds });
          break;
        case "showDrips":
          context.settings.update({ showDrips: !value.showDrips });
          context.shell.flash(value.showDrips ? "Капли выключены" : "Капли включены");
          break;
        case "liveMascot":
          context.settings.update({ liveMascot: !value.liveMascot });
          context.shell.flash(value.liveMascot ? "Персонаж замер" : "Персонаж ожил");
          break;
        default:
          break;
      }
      return;
    }

    const accent = target?.closest<HTMLElement>("[data-accent]")?.dataset.accent;
    if (accent) {
      context.settings.update({ accent: accent as AccentId });
      return;
    }

    const units = target?.closest<HTMLElement>("[data-units]")?.dataset.units;
    if (units === "metric" || units === "imperial") {
      context.settings.update({ units });
      void context.shell.refresh();
      return;
    }

    const action = target?.closest<HTMLElement>("[data-action]")?.dataset.action;
    switch (action) {
      case "click-through":
        context.shell.enableClickThrough(60);
        context.shell.flash("Клики проходят сквозь остров 60 секунд");
        break;
      case "city":
        void searchCity();
        break;
      case "weather-refresh":
        void context.shell.refresh();
        break;
      case "save-assistant":
        context.settings.update({
          assistant: {
            baseUrl: baseUrlNode.value.trim(),
            model: modelNode.value.trim(),
            apiKey: apiKeyNode.value.trim(),
          },
        });
        context.shell.flash("Настройки ассистента сохранены");
        break;
      case "collapse":
        context.shell.collapse();
        break;
      case "quit":
        context.shell.quit();
        break;
      default:
        break;
    }
  });

  cityNode.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void searchCity();
    }
    if (event.key === "Escape") {
      places = [];
      searchError = "";
      renderResults();
    }
  });

  intervalNode.addEventListener("change", () => {
    context.settings.update({ systemIntervalMs: Number(intervalNode.value) });
    context.shell.flash("Интервал опроса обновлён");
  });

  sync();
  const unsubscribeSettings = context.settings.changed.subscribe(sync);
  const unsubscribeWeather = weatherChanged.subscribe(renderCurrentWeather);

  return {
    destroy(): void {
      unsubscribeSettings();
      unsubscribeWeather();
    },
  };
};
