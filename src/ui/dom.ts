/** Помощники для работы с DOM: шаблон острова статичен, поэтому ошибки поиска — это баг. */

/**
 * Возвращает элемент по селектору.
 *
 * @throws Error если элемент отсутствует — значит, шаблон и код разошлись.
 */
export function requireElement<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Island: не найден элемент «${selector}»`);
  return element;
}

/** Возвращает элемент по селектору или `null`, если его нет. */
export function findElement<T extends Element>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

/** Обновляет текст элемента, если он существует (без лишних перерисовок). */
export function setText(root: ParentNode, selector: string, value: string): void {
  const element = root.querySelector<HTMLElement>(selector);
  if (element && element.textContent !== value) element.textContent = value;
}

/** Переключает CSS-класс у элемента, если он существует. */
export function setClass(element: Element | null, name: string, active: boolean): void {
  element?.classList.toggle(name, active);
}

/** Перезапускает CSS-анимацию элемента по имени класса. */
export function replayAnimation(element: HTMLElement, className: string): void {
  element.classList.remove(className);
  // Чтение offsetWidth заставляет браузер применить состояние без анимации.
  void element.offsetWidth;
  element.classList.add(className);
}
