import { APP_SIGNATURE } from "../app-info";
import { findElement, requireElement } from "./dom";
import { icon } from "./icons";
import { createMascot, MOOD_LABEL, type Mood } from "./mascot";

/** Одна «живая активность», которую показывает пилюля. */
export interface CapsuleActivity {
  id: string;
  glyph: string;
  /** Короткий заголовок: «Медиа», «Фокус», «Система». */
  label: string;
  /** Значение: название трека, остаток таймера, загрузка CPU. */
  value: string;
}

/** Состояние пилюли. */
export interface CapsuleState {
  time: string;
  expanded: boolean;
  activities: readonly CapsuleActivity[];
  unread: number;
  clickThrough: boolean;
  offline: boolean;
  /** Настроение мини-персонажа слева. */
  mood: Mood;
  /** Включена ли «жизнь» персонажа: моргание, взгляд, смена выражения. */
  liveMascot: boolean;
}

/** Пилюля острова. */
export interface CapsuleView {
  element: HTMLButtonElement;
  update(state: CapsuleState): void;
}

const ROTATE_MS = 5200;

const IDLE_ACTIVITY: CapsuleActivity = {
  id: "idle",
  glyph: "◷",
  label: "Island",
  value: "Готов к работе",
};

/**
 * Создаёт свёрнутую пилюлю.
 *
 * Пилюля сама переключает живые активности, чтобы в узком окне помещалось
 * больше информации; наведение мыши и раскрытая панель останавливают ротацию.
 *
 * @param onToggle вызывается по клику — оболочка раскрывает или сворачивает остров.
 */
export function createCapsule(onToggle: () => void): CapsuleView {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "capsule";
  element.title = APP_SIGNATURE;
  element.setAttribute("aria-controls", "island-panel");
  element.setAttribute("aria-expanded", "false");
  element.innerHTML = `
    <span data-ref="mascot"></span>
    <span class="capsule-copy">
      <span class="capsule-title">
        <span class="capsule-name">ISLAND</span>
        <span class="capsule-badge" data-ref="badge" hidden></span>
      </span>
      <span class="capsule-activity" data-ref="activity">
        <span class="capsule-glyph" data-ref="glyph" aria-hidden="true">◷</span>
        <span class="capsule-label" data-ref="label">Island</span>
        <span class="capsule-value" data-ref="value">Готов к работе</span>
      </span>
    </span>
    <span class="capsule-meta">
      <span class="capsule-time" data-ref="time">--:--</span>
      <span class="capsule-chevron" aria-hidden="true">${icon("chevron")}</span>
    </span>
  `;

  const mascot = createMascot();
  requireElement<HTMLElement>('[data-ref="mascot"]', element).replaceWith(mascot.element);

  const activityNode = requireElement<HTMLElement>('[data-ref="activity"]', element);
  const glyphNode = requireElement<HTMLElement>('[data-ref="glyph"]', element);
  const labelNode = requireElement<HTMLElement>('[data-ref="label"]', element);
  const valueNode = findElement<HTMLElement>('[data-ref="value"]', element);
  const timeNode = requireElement<HTMLElement>('[data-ref="time"]', element);
  const badgeNode = findElement<HTMLElement>('[data-ref="badge"]', element);

  let activities: readonly CapsuleActivity[] = [];
  let index = 0;
  let expanded = false;
  let hovered = false;
  let currentMood: Mood | null = null;

  const renderActivity = (animate: boolean): void => {
    const activity = activities[index] ?? IDLE_ACTIVITY;
    glyphNode.textContent = activity.glyph;
    labelNode.textContent = activity.label;
    if (valueNode) valueNode.textContent = activity.value;

    if (!animate) return;
    activityNode.classList.remove("is-swapping");
    void activityNode.offsetWidth;
    activityNode.classList.add("is-swapping");
  };

  const rotate = (): void => {
    if (hovered || expanded || activities.length < 2) return;
    index = (index + 1) % activities.length;
    renderActivity(true);
  };

  const timer = window.setInterval(rotate, ROTATE_MS);
  void timer;

  element.addEventListener("mouseenter", () => {
    hovered = true;
  });
  element.addEventListener("mouseleave", () => {
    hovered = false;
  });
  element.addEventListener("click", () => onToggle());

  return {
    element,

    update(state: CapsuleState): void {
      expanded = state.expanded;
      activities = state.activities;
      index = activities.length === 0 ? 0 : Math.min(index, activities.length - 1);

      timeNode.textContent = state.time;
      element.setAttribute("aria-expanded", String(state.expanded));
      element.classList.toggle("is-expanded", state.expanded);
      element.classList.toggle("is-click-through", state.clickThrough);
      element.classList.toggle("is-offline", state.offline);

      // Замороженный персонаж всегда спокоен: настроение приложения его не касается.
      const mood = state.liveMascot ? state.mood : "calm";
      if (mood !== currentMood) {
        currentMood = mood;
        mascot.setMood(mood);
        // Подсказка называет подпись приложения и текущее настроение персонажа.
        element.title = `${APP_SIGNATURE} · ${MOOD_LABEL[mood]}`;
      }

      mascot.setLive(state.liveMascot);

      if (badgeNode) {
        badgeNode.hidden = state.unread === 0;
        badgeNode.textContent = String(state.unread);
      }

      renderActivity(false);
    },
  };
}
