import { escapeHtml, formatClock, formatDateLong, formatRelative, formatWeekday } from "../../lib/format";
import { getMedia, getMediaSampledAt, mediaChanged } from "../../services/media";
import { listNotifications, markAllRead, subscribeNotifications } from "../../services/notifications";
import { settings } from "../../services/settings";
import {
  describeWeatherCode,
  formatTemperature,
  formatWind,
  getWeather,
  weatherChanged,
} from "../../services/weather";
import type { AppContext } from "../context";
import { requireElement } from "../dom";
import { icon, type IconName } from "../icons";
import type { PageFactory, PageInstance } from "../panel";
import { bindMediaControls, updateMediaCard } from "../widgets";

/** Плитка быстрых действий; `tone` задаёт системный цвет иконки, как в Пункте управления. */
const QUICK_ACTIONS: ReadonlyArray<{ target: string; symbol: IconName; label: string; tone: string }> = [
  { target: "screenshot", symbol: "camera", label: "Снимок", tone: "blue" },
  { target: "recorder", symbol: "record", label: "Запись", tone: "rose" },
  { target: "vpn", symbol: "shield", label: "VPN", tone: "green" },
  { target: "sound", symbol: "speaker", label: "Звук", tone: "violet" },
  { target: "network", symbol: "arrows", label: "Сеть", tone: "teal" },
  { target: "display", symbol: "display", label: "Дисплей", tone: "orange" },
];

/** Как часто двигать полосу прогресса между опросами SMTC. */
const TIMELINE_TICK_MS = 500;

/** Раздел «Обзор»: часы, погода с прогнозом, плеер, быстрые действия и уведомления. */
export const overviewPage: PageFactory = (root: HTMLElement, context: AppContext): PageInstance => {
  root.innerHTML = `
    <section class="hero">
      <div class="hero-clock">
        <span class="hero-time" data-ref="clock">--:--</span>
        <span class="hero-date" data-ref="date">—</span>
      </div>
    </section>

    <button class="card weather-card" type="button" data-action="weather">
      <span class="weather-main">
        <span class="weather-glyph" data-ref="weather-glyph" aria-hidden="true">◌</span>
        <span class="weather-temp" data-ref="weather-temp">—</span>
        <span class="weather-copy">
          <span class="weather-place" data-ref="weather-place">Погода</span>
          <span class="weather-desc" data-ref="weather-desc">Нет данных</span>
        </span>
      </span>
      <span class="weather-facts" data-ref="weather-facts"></span>
      <span class="forecast" data-ref="forecast"></span>
    </button>

    <div data-ref="media-host"></div>

    <section class="quick-section">
      <p class="section-label">Быстрые действия</p>
      <div class="quick-grid">
        ${QUICK_ACTIONS.map(
          (action) => `
            <button class="quick-tile" type="button" data-target="${action.target}" data-tone="${action.tone}">
              <span class="quick-icon" aria-hidden="true">${icon(action.symbol)}</span>
              <span class="quick-label">${action.label}</span>
            </button>`,
        ).join("")}
      </div>
    </section>

    <section class="card feed-card">
      <div class="feed-head">
        <p class="card-kicker">Уведомления</p>
        <button class="link-button" type="button" data-action="read-all">Прочитать все</button>
      </div>
      <div class="feed" data-ref="feed"></div>
    </section>
  `;

  const clockNode = requireElement<HTMLElement>('[data-ref="clock"]', root);
  const dateNode = requireElement<HTMLElement>('[data-ref="date"]', root);
  const weatherCard = requireElement<HTMLButtonElement>('[data-action="weather"]', root);
  const weatherGlyph = requireElement<HTMLElement>('[data-ref="weather-glyph"]', root);
  const weatherTemp = requireElement<HTMLElement>('[data-ref="weather-temp"]', root);
  const weatherPlace = requireElement<HTMLElement>('[data-ref="weather-place"]', root);
  const weatherDesc = requireElement<HTMLElement>('[data-ref="weather-desc"]', root);
  const weatherFacts = requireElement<HTMLElement>('[data-ref="weather-facts"]', root);
  const forecastNode = requireElement<HTMLElement>('[data-ref="forecast"]', root);
  const mediaHost = requireElement<HTMLElement>('[data-ref="media-host"]', root);
  const feedNode = requireElement<HTMLElement>('[data-ref="feed"]', root);

  const renderClock = (): void => {
    const now = new Date();
    clockNode.textContent = formatClock(now, settings.value.showSeconds);
    dateNode.textContent = formatDateLong(now);
  };

  const renderWeather = (): void => {
    const weather = getWeather();
    if (!weather) {
      weatherGlyph.textContent = "◌";
      weatherTemp.textContent = "—";
      weatherPlace.textContent = "Погода недоступна";
      weatherDesc.textContent = "Проверьте сеть";
      weatherFacts.textContent = "";
      forecastNode.innerHTML = "";
      weatherCard.setAttribute("aria-label", "Погода недоступна. Открыть настройки города");
      return;
    }

    const description = describeWeatherCode(weather.now.code);
    const units = weather.units;

    weatherGlyph.textContent = description.glyph;
    weatherTemp.textContent = formatTemperature(weather.now.temperature, units);
    weatherPlace.textContent = weather.place;
    weatherDesc.textContent = description.label;
    weatherFacts.innerHTML = [
      `Ощущается ${formatTemperature(weather.now.apparent, units)}`,
      formatWind(weather.now.wind, units),
      `влажность ${Math.round(weather.now.humidity)}%`,
    ]
      .map((fact) => `<span class="weather-fact">${escapeHtml(fact)}</span>`)
      .join("");

    forecastNode.innerHTML = weather.days
      .slice(0, 4)
      .map((day) => {
        const code = describeWeatherCode(day.code);
        return `
          <span class="forecast-day">
            <span class="forecast-label">${escapeHtml(formatWeekday(day.date))}</span>
            <span class="forecast-glyph" aria-hidden="true">${escapeHtml(code.glyph)}</span>
            <span class="forecast-temp">
              <b>${Math.round(day.max)}°</b>
              <span>${Math.round(day.min)}°</span>
            </span>
          </span>`;
      })
      .join("");

    weatherCard.setAttribute("aria-label", `Погода: ${weather.place}, ${description.label}. Открыть настройки города`);
  };

  const renderFeed = (): void => {
    const items = listNotifications();
    if (items.length === 0) {
      feedNode.innerHTML = '<p class="muted feed-empty">Пока тихо. Здесь появятся события острова.</p>';
      return;
    }
    feedNode.innerHTML = items
      .slice(0, 4)
      .map(
        (item) => `
          <article class="feed-item ${item.read ? "is-read" : ""} tone-${item.tone}">
            <span class="feed-glyph" aria-hidden="true">${escapeHtml(item.glyph)}</span>
            <div class="feed-copy">
              <strong>${escapeHtml(item.title)}</strong>
              <span class="muted">${escapeHtml(item.body)}</span>
            </div>
            <time class="feed-time">${escapeHtml(formatRelative(item.at))}</time>
          </article>`,
      )
      .join("");
  };

  bindMediaControls(root);
  updateMediaCard(mediaHost, getMedia(), getMediaSampledAt());

  root.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const action = target?.closest<HTMLElement>("[data-action]")?.dataset.action;

    if (action === "read-all") {
      markAllRead();
      context.shell.flash("Уведомления прочитаны");
      return;
    }

    if (action === "weather") {
      context.shell.flash("Город меняется в настройках");
      context.shell.setPage("settings");
      return;
    }

    const quick = target?.closest<HTMLElement>("[data-target]");
    if (quick?.dataset.target) {
      void context.shell.openTarget(quick.dataset.target);
    }
  });

  renderClock();
  renderWeather();
  renderFeed();

  const clockTimer = window.setInterval(renderClock, 1000);
  // SMTC не присылает позицию между опросами — двигаем полосу сами.
  const timelineTimer = window.setInterval(() => {
    const media = getMedia();
    if (media?.playing) updateMediaCard(mediaHost, media, getMediaSampledAt());
  }, TIMELINE_TICK_MS);

  const unsubscribeMedia = mediaChanged.subscribe((media) => {
    updateMediaCard(mediaHost, media, getMediaSampledAt());
  });
  const unsubscribeWeather = weatherChanged.subscribe(renderWeather);
  const unsubscribeFeed = subscribeNotifications(renderFeed);
  const unsubscribeSettings = settings.changed.subscribe(renderClock);

  return {
    destroy(): void {
      window.clearInterval(clockTimer);
      window.clearInterval(timelineTimer);
      unsubscribeMedia();
      unsubscribeWeather();
      unsubscribeFeed();
      unsubscribeSettings();
    },
  };
};
