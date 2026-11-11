/**
 * Мини-персонаж островка — только пара глаз.
 *
 * Глаза живут постоянно: моргают (иногда дважды подряд), следят за курсором и,
 * если мышь давно не двигалась, лениво оглядываются. Настроение приходит из
 * состояния приложения: тревожные события (нет связи, садится батарея, перегружен
 * CPU) перекрывают приятные, поэтому персонаж никогда не улыбается, когда на
 * машине проблемы.
 *
 * Глаза НИКОГДА не подменяются дугами: при любом настроении видны овал склеры и
 * зрачок, меняется только форма века и наклон. Раньше «радость» показывала дуги
 * `^ ^`, а глаза прятала в `opacity: 0` — в пилюле это читалось как «персонаж
 * всегда спит», поэтому выражение теперь строится на подвижных глазах.
 *
 * Разметка — инлайновый SVG, как в `icons.ts`: размер задаётся CSS, цвет
 * наследуется от контейнера, шрифты Windows не участвуют. Геометрия глаз задана
 * в пикселях viewBox (1 единица = 1px при ширине 26px), поэтому ход зрачка —
 * честные 2.2px: движение видно без приглядывания.
 *
 * Жизнь можно выключить: `setLive(false)` замораживает взгляд и моргание,
 * оставляя спокойное открытое лицо (настройка «Живой персонаж»).
 */

/** Настроение персонажа. */
export type Mood = "calm" | "happy" | "focused" | "sleepy" | "worried";

/** Подписи настроений — попадают в подсказку пилюли. */
export const MOOD_LABEL: Record<Mood, string> = {
  calm: "спокойный",
  happy: "довольный",
  focused: "сосредоточенный",
  sleepy: "сонный",
  worried: "обеспокоенный",
};

/** Что персонаж знает о приложении, чтобы выбрать выражение. */
export interface MoodInput {
  /** Локальный час 0–23. */
  hour: number;
  focusRunning: boolean;
  mediaPlaying: boolean;
  /** Загрузка CPU в процентах; `null`, если снимка системы ещё нет. */
  cpu: number | null;
  /** Батарея ниже 20% и не заряжается. */
  batteryLow: boolean;
  /** Нативные данные недоступны (браузерный предпросмотр или сбой). */
  offline: boolean;
}

/**
 * Переводит состояние приложения в настроение персонажа.
 *
 * Порядок веток — приоритет: проблема на машине важнее музыки и таймера.
 */
export function resolveMood(input: MoodInput): Mood {
  if (input.offline || input.batteryLow) return "worried";
  if (input.cpu !== null && input.cpu >= 85) return "worried";
  if (input.focusRunning) return "focused";
  if (input.mediaPlaying) return "happy";
  if (input.hour < 6 || input.hour >= 23) return "sleepy";
  return "calm";
}

/** Живой персонаж: элемент для вставки в пилюлю и управление настроением. */
export interface MascotView {
  element: HTMLSpanElement;
  setMood(mood: Mood): void;
  /** Включает и выключает «жизнь»: моргание, взгляд и реакцию на настроение. */
  setLive(live: boolean): void;
  destroy(): void;
}

const BLINK_MIN_MS = 2100;
const BLINK_MAX_MS = 5200;
/** Сколько веки остаются сомкнутыми. */
const BLINK_MS = 120;
/** Пауза между двумя морганиями «подряд». */
const DOUBLE_BLINK_MS = 140;
const DOUBLE_BLINK_CHANCE = 0.26;
const REACT_MS = 420;
/** Сколько ждать после движения мыши, прежде чем снова оглядываться. */
const GAZE_HOLD_MS = 2000;
const GAZE_WANDER_MS = 3000;
/** Делители, переводящие смещение курсора в наклон зрачков. */
const GAZE_RANGE_X = 90;
const GAZE_RANGE_Y = 70;

/**
 * Геометрия: два глаза с крупным зрачком и бликом внутри.
 * Радужка и блик лежат в общей группе `.mascot-pupil`, поэтому ездят вместе.
 */
const FACES = `
  <g class="mascot-eyes">
    <g class="mascot-eye mascot-eye-left">
      <ellipse class="mascot-socket" cx="7.4" cy="8.5" rx="5" ry="5.9" />
      <g class="mascot-pupil">
        <circle class="mascot-iris" cx="7.4" cy="8.5" r="2.6" />
        <circle class="mascot-glint" cx="6.4" cy="7.4" r="0.9" />
      </g>
    </g>
    <g class="mascot-eye mascot-eye-right">
      <ellipse class="mascot-socket" cx="18.6" cy="8.5" rx="5" ry="5.9" />
      <g class="mascot-pupil">
        <circle class="mascot-iris" cx="18.6" cy="8.5" r="2.6" />
        <circle class="mascot-glint" cx="17.6" cy="7.4" r="0.9" />
      </g>
    </g>
  </g>
`;

/** Создаёт персонажа с уже запущенным морганием и слежением за курсором. */
export function createMascot(): MascotView {
  const element = document.createElement("span");
  element.className = "mascot";
  element.dataset.mood = "calm";
  element.setAttribute("aria-hidden", "true");
  element.innerHTML = `<svg class="mascot-svg" viewBox="0 0 26 17" fill="none" aria-hidden="true" focusable="false">${FACES}</svg>`;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /** Настроение, которое просит приложение. */
  let desired: Mood = "calm";
  /** Настроение, которое сейчас нарисовано. */
  let mood: Mood = "calm";
  let live = true;
  let lookX = 0;
  let lookY = 0;
  let blinkTimer = 0;
  let blinkOffTimer = 0;
  let wanderTimer = 0;
  let reactTimer = 0;
  let gazeAt = 0;
  let frame = 0;
  let disposed = false;

  const applyLook = (x: number, y: number): void => {
    const nextX = Math.max(-1, Math.min(1, x));
    const nextY = Math.max(-1, Math.min(1, y));
    if (Math.abs(nextX - lookX) < 0.04 && Math.abs(nextY - lookY) < 0.04) return;

    lookX = nextX;
    lookY = nextY;
    element.style.setProperty("--look-x", lookX.toFixed(2));
    element.style.setProperty("--look-y", lookY.toFixed(2));
  };

  // Моргание с неровным интервалом — ровный ритм выглядит механическим.
  // Глаза моргают всегда, даже если в системе выключены эффекты: короткое
  // смыкание век не укачивает, зато персонаж остаётся живым.
  const runBlink = (): void => {
    if (disposed || !live) return;
    element.classList.add("is-blinking");
    window.clearTimeout(blinkOffTimer);
    blinkOffTimer = window.setTimeout(() => {
      element.classList.remove("is-blinking");
      if (disposed || !live) return;
      if (Math.random() < DOUBLE_BLINK_CHANCE) {
        blinkOffTimer = window.setTimeout(runBlink, DOUBLE_BLINK_MS);
        return;
      }
      scheduleBlink();
    }, BLINK_MS);
  };

  const scheduleBlink = (): void => {
    window.clearTimeout(blinkTimer);
    if (disposed || !live) return;
    const base = BLINK_MIN_MS + Math.random() * (BLINK_MAX_MS - BLINK_MIN_MS);
    blinkTimer = window.setTimeout(runBlink, reducedMotion.matches ? base * 1.6 : base);
  };

  // Оглядывание по сторонам: если курсор давно стоит, глаза «сканируют» комнату.
  const scheduleWander = (): void => {
    window.clearTimeout(wanderTimer);
    if (disposed || !live) return;
    wanderTimer = window.setTimeout(() => {
      if (disposed || !live) return;
      if (Date.now() - gazeAt > GAZE_HOLD_MS) {
        // Иногда взгляд возвращается в центр — так движение читается как живое.
        const centre = Math.random() < 0.22;
        applyLook(
          centre ? 0 : Math.random() * 1.7 - 0.85,
          centre ? 0 : Math.random() * 1.2 - 0.6,
        );
      }
      scheduleWander();
    }, GAZE_WANDER_MS);
  };

  /** Применяет нужное настроение: `animate` включает кивок и моргание. */
  const applyMood = (animate: boolean): void => {
    const next: Mood = live ? desired : "calm";
    if (next === mood) return;

    mood = next;
    element.dataset.mood = next;
    if (!animate || !live) return;

    // Короткий кивок, чтобы смена выражения не выглядела «переключением картинки».
    element.classList.remove("is-reacting");
    void element.offsetWidth;
    element.classList.add("is-reacting");

    window.clearTimeout(reactTimer);
    reactTimer = window.setTimeout(() => element.classList.remove("is-reacting"), REACT_MS);

    // Смена настроения — повод моргнуть: персонаж «переключает» выражение.
    runBlink();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!live || frame !== 0) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      if (!live) return;

      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      gazeAt = Date.now();
      applyLook(
        (event.clientX - (rect.left + rect.width / 2)) / GAZE_RANGE_X,
        (event.clientY - (rect.top + rect.height / 2)) / GAZE_RANGE_Y,
      );
    });
  };

  window.addEventListener("pointermove", onPointerMove, { passive: true });

  scheduleBlink();
  scheduleWander();

  return {
    element,

    setMood(next: Mood): void {
      desired = next;
      applyMood(true);
    },

    setLive(next: boolean): void {
      if (live === next) return;
      live = next;
      element.classList.toggle("is-frozen", !live);

      if (live) {
        scheduleBlink();
        scheduleWander();
        applyMood(true);
        return;
      }

      // Заморозка: гасим все таймеры и возвращаем глаза в центр. Веки
      // раскрываются — персонаж «замирает», а не засыпает.
      window.clearTimeout(blinkTimer);
      window.clearTimeout(blinkOffTimer);
      window.clearTimeout(wanderTimer);
      window.clearTimeout(reactTimer);
      window.cancelAnimationFrame(frame);
      frame = 0;
      element.classList.remove("is-blinking", "is-reacting");
      applyLook(0, 0);
      applyMood(false);
    },

    destroy(): void {
      disposed = true;
      window.clearTimeout(blinkTimer);
      window.clearTimeout(blinkOffTimer);
      window.clearTimeout(wanderTimer);
      window.clearTimeout(reactTimer);
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointerMove);
    },
  };
}
