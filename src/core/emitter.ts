import { log } from "./logger";

/** Слушатель значения сервиса. */
export type Listener<T> = (value: T) => void;

/** Минимальный наблюдатель: сервисы не знают, кто на них подписан. */
export class Emitter<T> {
  private readonly listeners = new Set<Listener<T>>();

  /** Подписывает слушателя и возвращает функцию отписки. */
  subscribe(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Передаёт значение всем слушателям; сбой одного не мешает остальным. */
  emit(value: T): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(value);
      } catch (error) {
        log("error", "Сбой обработчика события", error);
      }
    }
  }
}
