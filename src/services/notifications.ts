import { Emitter } from "../core/emitter";
import type { AppNotification, NotificationTone } from "../types";

const MAX_ITEMS = 12;

const items: AppNotification[] = [];
const changed = new Emitter<readonly AppNotification[]>();

let counter = 0;

/** Данные для нового уведомления. */
export interface NotificationInput {
  title: string;
  body: string;
  glyph?: string;
  tone?: NotificationTone;
}

/**
 * Добавляет уведомление в центр острова.
 *
 * @returns созданную запись — её можно использовать, чтобы пометить событие прочитанным.
 */
export function pushNotification(input: NotificationInput): AppNotification {
  const item: AppNotification = {
    id: `notice-${(counter += 1)}`,
    title: input.title,
    body: input.body,
    glyph: input.glyph ?? "•",
    tone: input.tone ?? "info",
    at: Date.now(),
    read: false,
  };

  items.unshift(item);
  if (items.length > MAX_ITEMS) items.pop();
  changed.emit(items);
  return item;
}

/** Список уведомлений, новые первыми. */
export function listNotifications(): readonly AppNotification[] {
  return items;
}

/** Количество непрочитанных уведомлений. */
export function unreadCount(): number {
  return items.filter((item) => !item.read).length;
}

/** Помечает все уведомления прочитанными. */
export function markAllRead(): void {
  if (items.every((item) => item.read)) return;
  for (const item of items) item.read = true;
  changed.emit(items);
}

/** Подписка на изменения списка уведомлений. */
export function subscribeNotifications(listener: (value: readonly AppNotification[]) => void): () => void {
  return changed.subscribe(listener);
}
