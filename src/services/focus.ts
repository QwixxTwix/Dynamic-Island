import { Emitter } from "../core/emitter";

const TICK_MS = 200;

/** Состояние таймера фокуса. */
export interface FocusState {
  /** Полная длительность сессии в миллисекундах. */
  totalMs: number;
  /** Остаток в миллисекундах. */
  remainingMs: number;
  running: boolean;
  /** Подпись сессии, например «Фокус 25 мин». */
  label: string;
}

const IDLE: FocusState = { totalMs: 0, remainingMs: 0, running: false, label: "Фокус" };

/** Завершённая сессия. */
export interface FocusCompletion {
  label: string;
  minutes: number;
}

/**
 * Таймер фокуса — «живая активность» острова.
 *
 * Время считается от абсолютной метки окончания, поэтому таймер не уплывает
 * при троттлинге таймеров браузера в фоне.
 */
class FocusTimer {
  /** Изменение состояния (каждые 200 мс во время работы). */
  readonly changed = new Emitter<FocusState>();
  /** Сессия завершилась. */
  readonly completed = new Emitter<FocusCompletion>();

  private state: FocusState = IDLE;
  private endsAt = 0;
  private timer: number | null = null;

  /** Текущее состояние таймера. */
  get current(): FocusState {
    return this.state;
  }

  /** Запускает новую сессию. */
  start(minutes: number, label = "Фокус"): void {
    const safeMinutes = Math.min(Math.max(Math.round(minutes), 1), 240);
    const totalMs = safeMinutes * 60_000;
    this.endsAt = Date.now() + totalMs;
    this.state = {
      totalMs,
      remainingMs: totalMs,
      running: true,
      label: `${label} ${safeMinutes} мин`,
    };
    this.startTicker();
    this.changed.emit(this.state);
  }

  /** Ставит на паузу. */
  pause(): void {
    if (!this.state.running) return;
    this.state = { ...this.state, remainingMs: Math.max(0, this.endsAt - Date.now()), running: false };
    this.stopTicker();
    this.changed.emit(this.state);
  }

  /** Продолжает с остатка. */
  resume(): void {
    if (this.state.running || this.state.remainingMs <= 0) return;
    this.endsAt = Date.now() + this.state.remainingMs;
    this.state = { ...this.state, running: true };
    this.startTicker();
    this.changed.emit(this.state);
  }

  /** Переключает паузу и продолжение. */
  toggle(): void {
    if (this.state.running) this.pause();
    else this.resume();
  }

  /** Сбрасывает сессию. */
  stop(): void {
    this.stopTicker();
    this.state = IDLE;
    this.changed.emit(this.state);
  }

  private startTicker(): void {
    this.stopTicker();
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  private stopTicker(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    const remaining = this.endsAt - Date.now();
    if (remaining <= 0) {
      const minutes = Math.round(this.state.totalMs / 60_000);
      const label = this.state.label;

      // Сессия закрыта: интерфейс должен вернуться в исходное состояние,
      // иначе кнопка «Продолжить» осталась бы без остатка времени.
      this.stopTicker();
      this.state = IDLE;
      this.changed.emit(this.state);
      this.completed.emit({ label, minutes });
      return;
    }

    this.state = { ...this.state, remainingMs: remaining };
    this.changed.emit(this.state);
  }
}

/** Единственный таймер фокуса приложения. */
export const focusTimer = new FocusTimer();
