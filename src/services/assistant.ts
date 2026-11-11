import { Emitter } from "../core/emitter";
import { log } from "../core/logger";
import { formatBytes, formatPercent, formatUptime } from "../lib/format";
import type { ChatMessage, MediaSnapshot, PageId, Settings, SystemSnapshot, Weather } from "../types";
import type { MediaAction } from "./media";
import { describeWeatherCode, formatTemperature } from "./weather";

/** Действие, которое ассистент просит выполнить интерфейс. */
export type AssistantIntent =
  | { kind: "focus-start"; minutes: number }
  | { kind: "focus-stop" }
  | { kind: "media"; action: MediaAction }
  | { kind: "navigate"; page: PageId }
  | { kind: "open"; target: string };

/** Данные, которые ассистент видит в контексте запроса. */
export interface AssistantContext {
  settings: Settings;
  system: SystemSnapshot | null;
  weather: Weather | null;
  media: MediaSnapshot | null;
}

const MAX_MESSAGES = 40;
const REQUEST_TIMEOUT_MS = 30_000;

/** Изменение истории диалога. */
export const chatChanged = new Emitter<readonly ChatMessage[]>();

let conversation: readonly ChatMessage[] = [];

/** Текущая история диалога. */
export function getChat(): readonly ChatMessage[] {
  return conversation;
}

/** Очищает историю диалога. */
export function clearChat(): void {
  conversation = [];
  chatChanged.emit(conversation);
}

/**
 * Разбирает локальные команды ассистента.
 *
 * Работает без сети и без ключа API: «таймер 25», «пауза», «погода» и т. п.
 *
 * @returns намерение либо `null`, если запрос нужно отдать языковой модели.
 */
export function parseIntent(input: string): AssistantIntent | null {
  const text = input.trim().toLowerCase();

  const timer = /^(?:таймер|фокус|помодоро)\s*(\d{1,3})?/.exec(text);
  if (timer) {
    const minutes = Number.parseInt(timer[1] ?? "", 10);
    return { kind: "focus-start", minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 25 };
  }
  if (/^(?:стоп|останови|отмена|сброс)/.test(text)) return { kind: "focus-stop" };
  if (/^(?:пауза|pause)/.test(text)) return { kind: "media", action: "pause" };
  if (/^(?:играй|играть|продолжи|play)/.test(text)) return { kind: "media", action: "play" };
  if (/^(?:дальше|следующий|next)/.test(text)) return { kind: "media", action: "next" };
  if (/^(?:назад|предыдущий|previous)/.test(text)) return { kind: "media", action: "previous" };
  if (/^(?:настройки|settings)/.test(text)) return { kind: "navigate", page: "settings" };
  if (/^(?:система|монитор|cpu)/.test(text)) return { kind: "navigate", page: "system" };
  if (/^(?:скриншот|снимок)/.test(text)) return { kind: "open", target: "screenshot" };
  if (/^(?:vpn|впн)/.test(text)) return { kind: "open", target: "vpn" };

  return null;
}

/**
 * Отвечает на запрос пользователя.
 *
 * Сначала пробует локальные команды, затем — модель по OpenAI-совместимому API.
 * Ключ хранится только в настройках устройства и уходит лишь провайдеру,
 * которого выбрал пользователь.
 *
 * @returns намерение, которое интерфейс должен выполнить, либо `null`.
 */
export async function askAssistant(input: string, context: AssistantContext): Promise<AssistantIntent | null> {
  const text = input.trim();
  if (text.length === 0) return null;

  push({ role: "user", text, at: Date.now() });

  const intent = parseIntent(text);
  if (intent) {
    push({ role: "assistant", text: describeIntent(intent), at: Date.now() });
    return intent;
  }

  if (context.settings.assistant.apiKey.trim().length === 0) {
    push({
      role: "assistant",
      text:
        "Я запускаю таймер, управляю плеером и открываю системные разделы без интернета. " +
        "Для свободных вопросов добавьте ключ API в «Настройки → Ассистент».",
      at: Date.now(),
    });
    return null;
  }

  push({ role: "assistant", text: "Думаю…", at: Date.now(), pending: true });
  try {
    const reply = await requestCompletion(context, text);
    replacePending(reply);
  } catch (error) {
    log("warn", "Ассистент: запрос к модели не выполнен", error);
    replacePending("Не удалось получить ответ. Проверьте ключ, модель и подключение к сети.");
  }
  return null;
}

async function requestCompletion(context: AssistantContext, question: string): Promise<string> {
  const { baseUrl, model, apiKey } = context.settings.assistant;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: 400,
        messages: [
          { role: "system", content: buildSystemPrompt(context) },
          { role: "user", content: question },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const content = readCompletion((await response.json()) as unknown);
    if (content.length === 0) throw new Error("пустой ответ модели");
    return content;
  } finally {
    window.clearTimeout(timeout);
  }
}

function readCompletion(payload: unknown): string {
  const root = asRecord(payload);
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const choice = asRecord(choices[0]);
  const message = asRecord(choice.message);
  return typeof message.content === "string" ? message.content.trim() : "";
}

function buildSystemPrompt(context: AssistantContext): string {
  const facts: string[] = [
    "Ты — встроенный ассистент виджета Island для Windows.",
    "Отвечай по-русски, коротко: 1–3 предложения, без markdown и списков.",
  ];

  if (context.weather) {
    const description = describeWeatherCode(context.weather.now.code).label.toLowerCase();
    facts.push(
      `Погода в ${context.weather.place}: ${formatTemperature(context.weather.now.temperature, context.weather.units)}, ${description}.`,
    );
  }
  if (context.system) {
    facts.push(
      `Компьютер ${context.system.hostName}: загрузка CPU ${formatPercent(context.system.cpuUsage)}, ` +
        `память ${formatBytes(context.system.memoryUsed)} из ${formatBytes(context.system.memoryTotal)}, ` +
        `аптайм ${formatUptime(context.system.uptimeSecs)}.`,
    );
  }
  if (context.media) {
    facts.push(`Сейчас играет: ${context.media.artist || "неизвестный исполнитель"} — ${context.media.title}.`);
  }

  return facts.join(" ");
}

function describeIntent(intent: AssistantIntent): string {
  switch (intent.kind) {
    case "focus-start":
      return `Запускаю фокус на ${intent.minutes} мин.`;
    case "focus-stop":
      return "Останавливаю таймер.";
    case "media":
      return `Отправляю плееру команду «${intent.action}».`;
    case "navigate":
      return `Открываю раздел «${intent.page}».`;
    case "open":
      return `Запускаю системное действие «${intent.target}».`;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function push(message: ChatMessage): void {
  conversation = [...conversation, message].slice(-MAX_MESSAGES);
  chatChanged.emit(conversation);
}

function replacePending(text: string): void {
  const index = conversation.findIndex((entry) => entry.pending === true);
  conversation =
    index === -1
      ? [...conversation, { role: "assistant", text, at: Date.now() }]
      : conversation.map((entry, position) =>
          position === index ? { role: "assistant", text, at: Date.now() } : entry,
        );
  chatChanged.emit(conversation);
}
