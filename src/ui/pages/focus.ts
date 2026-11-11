import { formatDuration } from "../../lib/format";
import { focusTimer, type FocusState } from "../../services/focus";
import type { AppContext } from "../context";
import { requireElement } from "../dom";
import type { PageFactory, PageInstance } from "../panel";

const PRESETS = [5, 15, 25, 45, 60] as const;
const DEFAULT_MINUTES = 25;

/** Раздел «Фокус»: таймер, который дублируется в свёрнутой пилюле. */
export const focusPage: PageFactory = (root: HTMLElement, context: AppContext): PageInstance => {
  root.innerHTML = `
    <section class="card focus-card">
      <div class="focus-ring" data-ref="ring">
        <div class="focus-ring-inner">
          <span class="focus-time" data-ref="time">25:00</span>
          <span class="focus-caption" data-ref="caption">Готов начать</span>
        </div>
      </div>
      <div class="focus-actions">
        <button class="primary-button" type="button" data-action="toggle" data-ref="toggle">Старт</button>
        <button class="ghost-button" type="button" data-action="stop">Сброс</button>
      </div>
    </section>

    <section class="card">
      <p class="card-kicker">Длительность</p>
      <div class="preset-row">
        ${PRESETS.map(
          (minutes) => `<button class="chip" type="button" data-preset="${minutes}">${minutes} мин</button>`,
        ).join("")}
      </div>
      <div class="field-row">
        <input class="input" data-ref="custom" type="number" min="1" max="240" placeholder="Свои минуты" />
        <button class="ghost-button" type="button" data-action="custom">Запустить</button>
      </div>
    </section>

    <section class="card note-card">
      <span class="card-icon" aria-hidden="true">◔</span>
      <p class="muted">Пока таймер идёт, отсчёт виден в свёрнутой пилюле, а по завершении Island пришлёт уведомление.</p>
    </section>
  `;

  const ringNode = requireElement<HTMLElement>('[data-ref="ring"]', root);
  const timeNode = requireElement<HTMLElement>('[data-ref="time"]', root);
  const captionNode = requireElement<HTMLElement>('[data-ref="caption"]', root);
  const toggleNode = requireElement<HTMLButtonElement>('[data-ref="toggle"]', root);
  const customNode = requireElement<HTMLInputElement>('[data-ref="custom"]', root);

  const render = (state: FocusState): void => {
    const hasSession = state.totalMs > 0;
    const remaining = hasSession ? state.remainingMs : DEFAULT_MINUTES * 60_000;
    const progress = hasSession && state.totalMs > 0 ? 1 - state.remainingMs / state.totalMs : 0;

    timeNode.textContent = formatDuration(remaining);
    captionNode.textContent = state.running ? state.label : hasSession ? "Пауза" : "Готов начать";
    toggleNode.textContent = state.running ? "Пауза" : hasSession ? "Продолжить" : "Старт";
    ringNode.style.setProperty("--progress", (progress * 100).toFixed(1));
    ringNode.classList.toggle("is-running", state.running);
  };

  root.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;

    const preset = target?.closest<HTMLElement>("[data-preset]")?.dataset.preset;
    if (preset) {
      focusTimer.start(Number.parseInt(preset, 10));
      return;
    }

    const action = target?.closest<HTMLElement>("[data-action]")?.dataset.action;
    if (action === "toggle") {
      if (focusTimer.current.totalMs === 0) focusTimer.start(DEFAULT_MINUTES);
      else focusTimer.toggle();
      return;
    }

    if (action === "stop") {
      focusTimer.stop();
      return;
    }

    if (action === "custom") {
      const minutes = Number.parseInt(customNode.value, 10);
      if (!Number.isFinite(minutes) || minutes < 1) {
        context.shell.flash("Введите целое число минут");
        return;
      }
      focusTimer.start(minutes);
      customNode.value = "";
    }
  });

  render(focusTimer.current);
  const unsubscribe = focusTimer.changed.subscribe(render);

  return {
    destroy(): void {
      unsubscribe();
    },
  };
};
