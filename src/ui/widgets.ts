import { log } from "../core/logger";
import { escapeHtml, formatDuration, ratio } from "../lib/format";
import type { MediaSnapshot } from "../types";
import { mediaControl, seekMedia, type MediaAction } from "../services/media";
import { icon } from "./icons";

/** Шаг перемотки с клавиатуры, мс. */
const KEY_SEEK_STEP_MS = 5000;

/** Ключ трека: по нему интерфейс понимает, нужно ли перерисовывать карточку. */
export function trackKey(media: MediaSnapshot): string {
  return `${media.title}|${media.artist}|${media.album}`;
}

/**
 * Ключ состояния карточки: трек + воспроизведение.
 *
 * Пауза не меняет трек, поэтому без состояния кнопка «плей/пауза» осталась бы
 * с прежним глифом до смены песни.
 */
function stateKey(media: MediaSnapshot): string {
  return `${trackKey(media)}|${media.playing ? "play" : "stop"}|${media.durationMs > 0 ? "seek" : "live"}`;
}

/** Приводит первую букву каждого слова к верхнему регистру. */
function titleize(value: string): string {
  return value
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Приводит идентификатор приложения-источника к короткой подписи: «Spotify». */
export function prettifySource(app: string): string {
  const trimmed = app.trim();
  if (trimmed.length === 0) return "Медиа";

  // Источники вида `Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic`:
  // берём часть после «!», отбрасываем хвост пакета и служебные разделители.
  const tail = trimmed.includes("!") ? trimmed.split("!").pop() ?? trimmed : trimmed;
  const withoutSuffix = tail.replace(/\.exe$/i, "").split("_")[0] ?? tail;
  const segments = withoutSuffix.split(".").filter((segment) => segment.length > 0);
  const label = segments.length > 0 ? segments[segments.length - 1]! : withoutSuffix;
  const words = titleize(label.replace(/[-_]+/g, " ").trim());

  return words.length > 0 ? words : "Медиа";
}

/** Позиция трека с поправкой на время, прошедшее после опроса SMTC. */
export function estimatePosition(media: MediaSnapshot, sampledAt: number): number {
  const drift = media.playing ? Math.max(0, Date.now() - sampledAt) : 0;
  const position = media.positionMs + drift;
  return media.durationMs > 0 ? Math.min(position, media.durationMs) : position;
}

/** Разметка карточки плеера. */
export function renderMediaCard(media: MediaSnapshot | null, sampledAt: number): string {
  if (!media) {
    return `
      <article class="card media-card is-empty" data-ref="media" data-state="" data-duration="0" data-position="0">
        <div class="media-art is-placeholder" aria-hidden="true">${icon("note")}</div>
        <div class="media-body">
          <span class="media-source">Медиа</span>
          <strong class="media-title">Ничего не играет</strong>
          <span class="media-artist">Запустите плеер — Island подхватит трек через SMTC.</span>
        </div>
      </article>
    `;
  }

  const position = estimatePosition(media, sampledAt);
  const progress = media.durationMs > 0 ? ratio(position, media.durationMs) : 0;
  const seekable = media.durationMs > 0;
  const art = media.art ? escapeHtml(media.art) : "";
  const artist = media.artist || media.album || "Неизвестный исполнитель";
  const total = seekable ? formatDuration(media.durationMs) : "—:—";

  return `
    <article
      class="card media-card ${media.playing ? "is-playing" : "is-paused"}"
      data-ref="media"
      data-state="${escapeHtml(stateKey(media))}"
      data-duration="${media.durationMs}"
      data-position="${Math.round(position)}"
    >
      <div class="media-art">${art ? `<img src="${art}" alt="" />` : `<span aria-hidden="true">${icon("note")}</span>`}</div>
      <div class="media-body">
        <div class="media-head">
          <span class="media-source">${escapeHtml(prettifySource(media.app))}</span>
          <span class="media-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        </div>
        <strong class="media-title" title="${escapeHtml(media.title)}">${escapeHtml(media.title)}</strong>
        <span class="media-artist" title="${escapeHtml(artist)}">${escapeHtml(artist)}</span>
        <div
          class="media-timeline"
          data-ref="timeline"
          data-seekable="${seekable}"
          role="slider"
          tabindex="0"
          aria-label="Позиция трека"
          aria-valuemin="0"
          aria-valuemax="${Math.round(media.durationMs / 1000)}"
          aria-valuenow="${Math.round(position / 1000)}"
          aria-valuetext="${formatDuration(position)} из ${total}"
        >
          <span class="media-timeline-track"></span>
          <span class="media-timeline-fill" data-ref="progress" style="width:${(progress * 100).toFixed(2)}%"></span>
        </div>
        <div class="media-times">
          <span data-ref="elapsed">${formatDuration(position)}</span>
          <span data-ref="total">${total}</span>
        </div>
      </div>
      <div class="media-controls">
        <button class="media-button" type="button" data-media="previous" aria-label="Предыдущий трек">${icon("previous")}</button>
        <button class="media-button is-primary" type="button" data-media="playpause" aria-label="${media.playing ? "Пауза" : "Играть"}">
          ${icon(media.playing ? "pause" : "play")}
        </button>
        <button class="media-button" type="button" data-media="next" aria-label="Следующий трек">${icon("next")}</button>
      </div>
    </article>
  `;
}

/** Перерисовывает полосу и время внутри уже отрисованной карточки. */
function paintTimeline(card: HTMLElement, media: MediaSnapshot, sampledAt: number): void {
  const position = estimatePosition(media, sampledAt);
  const progress = media.durationMs > 0 ? ratio(position, media.durationMs) : 0;
  const total = media.durationMs > 0 ? formatDuration(media.durationMs) : "—:—";

  card.dataset.position = String(Math.round(position));

  const fill = card.querySelector<HTMLElement>('[data-ref="progress"]');
  const elapsed = card.querySelector<HTMLElement>('[data-ref="elapsed"]');
  const timeline = card.querySelector<HTMLElement>('[data-ref="timeline"]');
  if (fill) fill.style.width = `${(progress * 100).toFixed(2)}%`;
  if (elapsed) elapsed.textContent = formatDuration(position);

  if (timeline) {
    timeline.setAttribute("aria-valuenow", String(Math.round(position / 1000)));
    timeline.setAttribute("aria-valuetext", `${formatDuration(position)} из ${total}`);
  }
}

/**
 * Обновляет карточку плеера в контейнере.
 *
 * Если трек и состояние воспроизведения те же, меняются только полоса прогресса
 * и время — DOM не перестраивается, поэтому обложка не мигает при каждом опросе.
 */
export function updateMediaCard(host: HTMLElement, media: MediaSnapshot | null, sampledAt: number): void {
  const card = host.querySelector<HTMLElement>('[data-ref="media"]');
  const state = media ? stateKey(media) : "";

  if (!card || card.dataset.state !== state) {
    host.innerHTML = renderMediaCard(media, sampledAt);
    return;
  }

  if (!media) return;
  paintTimeline(card, media, sampledAt);
}

/**
 * Один обработчик на страницу: кнопки плеера и перемотка работают после любой
 * перерисовки карточки.
 */
export function bindMediaControls(root: HTMLElement): void {
  root.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest<HTMLElement>("[data-media]");
    if (!button) return;

    const action = button.dataset.media as MediaAction | undefined;
    if (!action) return;

    void mediaControl(action).then((accepted) => {
      if (!accepted) log("info", `Плеер не принял команду «${action}»`);
    });
  });

  let dragging = false;
  let dragCard: HTMLElement | null = null;
  let dragDuration = 0;

  const ratioFromPointer = (timeline: HTMLElement, clientX: number): number => {
    const rect = timeline.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
  };

  const preview = (value: number): void => {
    if (!dragCard) return;
    const fill = dragCard.querySelector<HTMLElement>('[data-ref="progress"]');
    const elapsed = dragCard.querySelector<HTMLElement>('[data-ref="elapsed"]');
    if (fill) fill.style.width = `${(value * 100).toFixed(2)}%`;
    if (elapsed) elapsed.textContent = formatDuration(value * dragDuration);
  };

  root.addEventListener("pointerdown", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const timeline = target?.closest<HTMLElement>('[data-ref="timeline"]');
    if (!timeline || timeline.dataset.seekable !== "true") return;

    const card = timeline.closest<HTMLElement>('[data-ref="media"]');
    if (!card) return;

    const duration = Number(card.dataset.duration ?? "0");
    if (!Number.isFinite(duration) || duration <= 0) return;

    dragDuration = duration;
    dragging = true;
    dragCard = card;
    card.classList.add("is-scrubbing");
    timeline.setPointerCapture(event.pointerId);
    preview(ratioFromPointer(timeline, event.clientX));
    event.preventDefault();
  });

  root.addEventListener("pointermove", (event) => {
    if (!dragging || !dragCard) return;
    const timeline = dragCard.querySelector<HTMLElement>('[data-ref="timeline"]');
    if (!timeline) return;
    preview(ratioFromPointer(timeline, event.clientX));
  });

  root.addEventListener("pointerup", (event) => {
    if (!dragging || !dragCard) return;
    dragging = false;

    const card = dragCard;
    dragCard = null;
    card.classList.remove("is-scrubbing");
    const timeline = card.querySelector<HTMLElement>('[data-ref="timeline"]');
    if (!timeline) return;

    const value = ratioFromPointer(timeline, event.clientX) * dragDuration;
    void seekMedia(value).then((accepted) => {
      if (!accepted) log("info", "Плеер не принял перемотку");
    });
  });

  root.addEventListener("pointercancel", () => {
    dragging = false;
    dragCard?.classList.remove("is-scrubbing");
    dragCard = null;
  });

  root.addEventListener("keydown", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const timeline = target?.closest<HTMLElement>('[data-ref="timeline"]');
    if (!timeline) return;

    const card = timeline.closest<HTMLElement>('[data-ref="media"]');
    if (!card) return;

    const duration = Number(card.dataset.duration ?? "0");
    if (!Number.isFinite(duration) || duration <= 0) return;

    const current = Number(card.dataset.position ?? "0");
    let next: number | null = null;
    if (event.key === "ArrowRight") next = current + KEY_SEEK_STEP_MS;
    else if (event.key === "ArrowLeft") next = current - KEY_SEEK_STEP_MS;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = duration - 1000;
    if (next === null) return;

    event.preventDefault();
    void seekMedia(Math.min(Math.max(next, 0), duration));
  });
}

/** Разметка карточки показателя с полосой заполнения. */
export function renderMetric(options: {
  label: string;
  value: string;
  hint: string;
  fill: number;
  tone?: "accent" | "warning";
}): string {
  const width = Math.max(0, Math.min(100, options.fill * 100)).toFixed(1);
  return `
    <article class="card metric ${options.tone === "warning" ? "is-warning" : ""}">
      <div class="metric-head">
        <span class="card-kicker">${escapeHtml(options.label)}</span>
        <strong>${escapeHtml(options.value)}</strong>
      </div>
      <div class="bar"><span style="width:${width}%"></span></div>
      <span class="muted metric-hint">${escapeHtml(options.hint)}</span>
    </article>
  `;
}
