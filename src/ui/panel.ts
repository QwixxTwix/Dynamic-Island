import { APP_AUTHOR, APP_SIGNATURE, APP_VERSION } from "../app-info";
import { log } from "../core/logger";
import type { PageId } from "../types";
import type { AppContext } from "./context";
import { requireElement } from "./dom";
import { icon, type IconName } from "./icons";

/** Раздел панели: рисует себя внутри переданного контейнера и убирает подписки при закрытии. */
export interface PageInstance {
  destroy(): void;
}

/** Фабрика раздела — передаётся из `main.ts`, чтобы оболочка не зависела от страниц. */
export type PageFactory = (root: HTMLElement, context: AppContext) => PageInstance;

/** Описание раздела для вкладок. */
interface PageMeta {
  id: PageId;
  title: string;
  subtitle: string;
  /** Иконка вкладки из набора SF-подобных символов. */
  symbol: IconName;
  label: string;
}

const PAGES: readonly PageMeta[] = [
  { id: "overview", title: "Обзор", subtitle: "Рабочий стол", symbol: "grid", label: "Обзор" },
  { id: "system", title: "Система", subtitle: "Мониторинг", symbol: "gauge", label: "Система" },
  { id: "focus", title: "Фокус", subtitle: "Таймер", symbol: "timer", label: "Фокус" },
  { id: "assistant", title: "Ассистент", subtitle: "Помощник", symbol: "sparkles", label: "Ассистент" },
  { id: "settings", title: "Настройки", subtitle: APP_SIGNATURE, symbol: "sliders", label: "Настройки" },
];

/** Раскрытая панель острова. */
export interface PanelView {
  element: HTMLElement;
  /** Открывает раздел; если панель свёрнута, запоминает выбор. */
  setPage(page: PageId): void;
  /** Показывает или скрывает панель, монтируя раздел по требованию. */
  setExpanded(expanded: boolean): void;
  /** Текст и тон индикатора в подвале. */
  setStatus(text: string, tone: "ok" | "warn"): void;
  /** Короткое сообщение в подвале (например, результат действия). */
  flash(message: string): void;
  /** Текущий открытый раздел. */
  currentPage(): PageId;
}

/** Параметры создания панели. */
export interface PanelOptions {
  factories: Record<PageId, PageFactory>;
  context: AppContext;
  onRefresh: () => void;
  onCollapse: () => void;
  onNavigate?: (page: PageId) => void;
}

/**
 * Создаёт оболочку панели: заголовок, вкладки, контейнер раздела и подвал.
 *
 * Раздел монтируется только когда панель раскрыта — свёрнутый остров не тратит
 * ресурсы на подписки и таймеры.
 */
export function createPanel(options: PanelOptions): PanelView {
  const element = document.createElement("section");
  element.className = "panel";
  element.id = "island-panel";
  element.hidden = true;
  element.setAttribute("aria-label", "Панель Island");
  element.innerHTML = `
    <header class="panel-header">
      <div class="panel-heading">
        <p class="eyebrow" data-ref="subtitle">Рабочий стол</p>
        <h1 data-ref="title">Обзор</h1>
      </div>
      <div class="panel-actions">
        <button class="icon-button" type="button" data-action="refresh" title="Обновить данные" aria-label="Обновить данные">${icon("refresh")}</button>
        <button class="icon-button" type="button" data-action="collapse" title="Свернуть (Esc)" aria-label="Свернуть панель">${icon("close")}</button>
      </div>
    </header>
    <nav class="tabs" role="tablist" aria-label="Разделы">
      ${PAGES.map(
        (page) =>
          `<button class="tab" type="button" role="tab" data-page="${page.id}" aria-selected="false">
             <span class="tab-glyph" aria-hidden="true">${icon(page.symbol)}</span>
             <span class="tab-label">${page.label}</span>
           </button>`,
      ).join("")}
    </nav>
    <div class="page" data-ref="page"></div>
    <footer class="panel-footer">
      <span class="footer-dot" data-ref="dot" aria-hidden="true"></span>
      <span class="footer-status" data-ref="status" aria-live="polite">Инициализация…</span>
      <span class="footer-credit">${APP_AUTHOR}</span>
      <span class="footer-version">${APP_VERSION}</span>
    </footer>
  `;

  const pageRoot = requireElement<HTMLElement>('[data-ref="page"]', element);
  const titleNode = requireElement<HTMLElement>('[data-ref="title"]', element);
  const subtitleNode = requireElement<HTMLElement>('[data-ref="subtitle"]', element);
  const statusNode = requireElement<HTMLElement>('[data-ref="status"]', element);
  const dotNode = requireElement<HTMLElement>('[data-ref="dot"]', element);
  const tabs = [...element.querySelectorAll<HTMLButtonElement>(".tab")];

  let current: PageId = "overview";
  let instance: PageInstance | null = null;
  let expanded = false;
  let flashTimer = 0;

  const destroyPage = (): void => {
    instance?.destroy();
    instance = null;
    // Сбрасываем модификаторы лейаута, которые раздел мог включить себе сам.
    pageRoot.className = "page";
    pageRoot.innerHTML = "";
  };

  const mountPage = (page: PageId): void => {
    destroyPage();
    const meta = PAGES.find((entry) => entry.id === page) ?? PAGES[0]!;
    titleNode.textContent = meta.title;
    subtitleNode.textContent = meta.subtitle;

    for (const tab of tabs) {
      const active = tab.dataset.page === page;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    }

    if (!expanded) return;

    try {
      instance = options.factories[page](pageRoot, options.context);
    } catch (error) {
      log("error", `Раздел «${page}» не открылся`, error);
      pageRoot.innerHTML = '<p class="empty-state">Раздел не загрузился. Подробности в «Настройки → Диагностика».</p>';
    }
  };

  const select = (page: PageId): void => {
    if (page === current && instance) return;
    current = page;
    mountPage(page);
    options.onNavigate?.(page);
  };

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      const page = tab.dataset.page as PageId | undefined;
      if (page) select(page);
    });
  }

  requireElement<HTMLButtonElement>('[data-action="refresh"]', element).addEventListener("click", () => {
    options.onRefresh();
  });
  requireElement<HTMLButtonElement>('[data-action="collapse"]', element).addEventListener("click", () => {
    options.onCollapse();
  });

  return {
    element,

    setPage(page: PageId): void {
      select(page);
    },

    setExpanded(next: boolean): void {
      if (expanded === next) return;
      expanded = next;
      element.hidden = !next;
      if (next) mountPage(current);
      else destroyPage();
    },

    setStatus(text: string, tone: "ok" | "warn"): void {
      statusNode.textContent = text;
      dotNode.classList.toggle("is-warn", tone === "warn");
    },

    flash(message: string): void {
      statusNode.textContent = message;
      statusNode.classList.add("is-flash");
      window.clearTimeout(flashTimer);
      flashTimer = window.setTimeout(() => {
        statusNode.classList.remove("is-flash");
      }, 2400);
    },

    currentPage(): PageId {
      return current;
    },
  };
}
