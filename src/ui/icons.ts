/**
 * Иконки в стиле SF Symbols: тонкий штрих 1.7, скруглённые окончания, сетка 24×24.
 *
 * Рисуются инлайновым SVG, чтобы интерфейс не зависел от эмодзи-шрифтов Windows
 * и одинаково выглядел при любом масштабе. Размер задаётся `font-size` контейнера:
 * иконка занимает ровно `1em`.
 */
export type IconName =
  | "grid"
  | "gauge"
  | "timer"
  | "sparkles"
  | "sliders"
  | "camera"
  | "record"
  | "shield"
  | "speaker"
  | "arrows"
  | "display"
  | "refresh"
  | "close"
  | "chevron"
  | "check"
  | "play"
  | "pause"
  | "next"
  | "previous"
  | "note";

const ICONS: Record<IconName, string> = {
  grid: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
  gauge: '<path d="M4 16.5a8 8 0 1 1 16 0"/><path d="M12 16.5l3.6-4.8"/><circle cx="12" cy="16.5" r="1.4" fill="currentColor" stroke="none"/>',
  timer: '<circle cx="12" cy="13.5" r="7"/><path d="M12 13.5V10"/><path d="M9.5 3h5"/>',
  sparkles:
    '<path d="M11 3.5l1.7 4.3 4.3 1.7-4.3 1.7L11 15.5 9.3 11.2 5 9.5l4.3-1.7z"/><path d="M17.5 14.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/>',
  sliders:
    '<path d="M4 7.5h16"/><path d="M4 12h16"/><path d="M4 16.5h16"/><circle cx="9" cy="7.5" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="16.5" r="2"/>',
  camera:
    '<path d="M4 9a2.5 2.5 0 0 1 2.5-2.5h1.2l1-1.5h6.6l1 1.5h1.2A2.5 2.5 0 0 1 20 9v7.5A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.75" r="3.2"/>',
  record: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/>',
  shield: '<path d="M12 3.5l7 2.6v5.3c0 4.2-2.8 7.3-7 9-4.2-1.7-7-4.8-7-9V6.1z"/>',
  speaker:
    '<path d="M5 10v4h2.8l4.2 3.6V6.4L7.8 10z"/><path d="M15.6 9.5a3.6 3.6 0 0 1 0 5"/><path d="M18.2 7a7.2 7.2 0 0 1 0 10"/>',
  arrows: '<path d="M6.5 7.5h11l-3.2-3.2"/><path d="M17.5 16.5h-11l3.2 3.2"/>',
  display: '<rect x="3.5" y="4.5" width="17" height="12" rx="2.5"/><path d="M9 20h6"/><path d="M12 16.5V20"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.4-5.5"/><path d="M19.5 4.5v4.2h-4.2"/>',
  close: '<path d="M6.5 6.5l11 11"/><path d="M17.5 6.5l-11 11"/>',
  chevron: '<path d="M6.5 9.5l5.5 5.5 5.5-5.5"/>',
  check: '<path d="M5 12.5l4.7 4.7L19 6.8"/>',
  play: '<path d="M8.5 5.6l10 6.4-10 6.4z" fill="currentColor" stroke="none"/>',
  pause:
    '<rect x="7.2" y="5.5" width="3.6" height="13" rx="1.4" fill="currentColor" stroke="none"/><rect x="13.2" y="5.5" width="3.6" height="13" rx="1.4" fill="currentColor" stroke="none"/>',
  next: '<path d="M6.5 5.6l9 6.4-9 6.4z" fill="currentColor" stroke="none"/><rect x="16.4" y="5.5" width="2.2" height="13" rx="1.1" fill="currentColor" stroke="none"/>',
  previous:
    '<rect x="5.4" y="5.5" width="2.2" height="13" rx="1.1" fill="currentColor" stroke="none"/><path d="M17.5 5.6l-9 6.4 9 6.4z" fill="currentColor" stroke="none"/>',
  note: '<path d="M15.5 5.5v9.9"/><circle cx="12.6" cy="16.4" r="2.9"/><path d="M15.5 5.5l4-1.1v2.8l-4 1.1"/>',
};

/**
 * Возвращает разметку иконки.
 *
 * @param name имя из набора `IconName`.
 * @param className дополнительный класс (например, «is-muted»).
 */
export function icon(name: IconName, className = ""): string {
  const classes = className.length > 0 ? `icon ${className}` : "icon";
  return `<svg class="${classes}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
}
