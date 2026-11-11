import { escapeHtml, formatClock } from "../../lib/format";
import { askAssistant, getChat, chatChanged, clearChat } from "../../services/assistant";
import { focusTimer } from "../../services/focus";
import { getMedia, mediaControl } from "../../services/media";
import { getSystemSnapshot } from "../../services/system";
import { getWeather } from "../../services/weather";
import type { AppContext } from "../context";
import { requireElement } from "../dom";
import type { PageFactory, PageInstance } from "../panel";

const SUGGESTIONS = ["Таймер 25", "Что играет?", "Загрузка CPU", "Погода", "Пауза"] as const;

/** Раздел «Ассистент»: локальные команды и чат с моделью. */
export const assistantPage: PageFactory = (root: HTMLElement, context: AppContext): PageInstance => {
  // Фиксированный лейаут: прокручивается только лента сообщений, а чипы и
  // композер остаются на месте. Без этого чат сжимался как flex-элемент и
  // сообщения вылезали поверх поля ввода.
  root.classList.add("is-fixed");
  root.innerHTML = `
    <div class="chat" data-ref="chat" aria-live="polite"></div>

    <div class="suggest-row">
      ${SUGGESTIONS.map(
        (suggestion) => `<button class="chip" type="button" data-suggestion="${escapeHtml(suggestion)}">${escapeHtml(suggestion)}</button>`,
      ).join("")}
      <button class="link-button" type="button" data-action="clear">Очистить</button>
    </div>

    <form class="composer" data-ref="form">
      <input class="input" data-ref="input" type="text" placeholder="Спросите Island…" autocomplete="off" />
      <button class="primary-button" type="submit" data-ref="send">Отправить</button>
    </form>
  `;

  const chatNode = requireElement<HTMLElement>('[data-ref="chat"]', root);
  const formNode = requireElement<HTMLFormElement>('[data-ref="form"]', root);
  const inputNode = requireElement<HTMLInputElement>('[data-ref="input"]', root);
  const sendNode = requireElement<HTMLButtonElement>('[data-ref="send"]', root);

  let busy = false;

  const renderChat = (): void => {
    const messages = getChat();
    chatNode.innerHTML =
      messages.length === 0
        ? `<p class="muted chat-empty">Спросите о системе, погоде или треке. <br />Локальные команды работают без ключа API.</p>`
        : messages
            .map(
              (message) => `
                <div class="bubble bubble-${message.role} ${message.pending ? "is-pending" : ""}">
                  <p>${escapeHtml(message.text)}</p>
                  <time>${escapeHtml(formatClock(new Date(message.at)))}</time>
                </div>`,
            )
            .join("");
    chatNode.scrollTop = chatNode.scrollHeight;
  };

  const execute = async (intent: Awaited<ReturnType<typeof askAssistant>>): Promise<void> => {
    if (!intent) return;

    switch (intent.kind) {
      case "focus-start":
        focusTimer.start(intent.minutes);
        context.shell.flash(`Фокус на ${intent.minutes} мин`);
        break;
      case "focus-stop":
        focusTimer.stop();
        context.shell.flash("Таймер остановлен");
        break;
      case "media":
        await mediaControl(intent.action);
        break;
      case "navigate":
        context.shell.setPage(intent.page);
        break;
      case "open":
        await context.shell.openTarget(intent.target);
        break;
    }
  };

  const send = async (text: string): Promise<void> => {
    if (busy || text.trim().length === 0) return;
    busy = true;
    sendNode.disabled = true;
    inputNode.value = "";

    try {
      const intent = await askAssistant(text, {
        settings: context.settings.value,
        system: getSystemSnapshot(),
        weather: getWeather(),
        media: getMedia(),
      });
      await execute(intent);
    } finally {
      busy = false;
      sendNode.disabled = false;
      inputNode.focus();
    }
  };

  formNode.addEventListener("submit", (event) => {
    event.preventDefault();
    void send(inputNode.value);
  });

  root.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;

    const suggestion = target?.closest<HTMLElement>("[data-suggestion]")?.dataset.suggestion;
    if (suggestion) {
      void send(suggestion);
      return;
    }

    if (target?.closest<HTMLElement>('[data-action="clear"]')) {
      clearChat();
    }
  });

  renderChat();
  const unsubscribe = chatChanged.subscribe(renderChat);
  inputNode.focus();

  return {
    destroy(): void {
      unsubscribe();
      root.classList.remove("is-fixed");
    },
  };
};
