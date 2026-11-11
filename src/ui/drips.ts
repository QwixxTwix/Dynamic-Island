/**
 * Капли, стекающие с островка.
 *
 * Canvas накрывает корпус пилюли и прозрачную полосу под ней, а рисует только
 * СНАРУЖИ силуэта: путь пилюли вычитается из области отсечения (`clip("evenodd")`).
 * Поэтому вода ползёт по всей нижней кромке — от нижних скруглений слева до
 * скруглений справа, — а не висит в одной точке, и срывается вниз уже за
 * пределами острова.
 *
 * Две сущности:
 *  - бусины (`beads`) — постоянная «мокрая» текстура: мелкие капли, разложенные
 *    по кромке с отталкиванием друг от друга, поэтому они всегда распределены;
 *  - капли (`drops`) — бусина набухает, срывается и падает, на её место тут же
 *    встаёт новая в самом свободном месте кромки.
 *
 * Рисуем только в свёрнутом виде: над раскрытой панелью воде нечего делать.
 * Цикл живёт на `requestAnimationFrame` и полностью останавливается, когда
 * эффект выключен, остров раскрыт или окно скрыто. При `prefers-reduced-motion`
 * рисуется один статичный кадр без анимации.
 */

/** Управление слоем капель. */
export interface DripsView {
  element: HTMLCanvasElement;
  /** Включает анимацию, когда остров свёрнут, и выключает при раскрытии. */
  setActive(active: boolean): void;
  destroy(): void;
}

/** Капля: сначала набухает на кромке, потом падает. */
interface Drop {
  x: number;
  /** Высота от верхней кромки острова вниз, px; у висящей капли считается на месте. */
  y: number;
  radius: number;
  /** Скорость падения, px/s; у висящей капли — 0. */
  speed: number;
  /** Сколько ещё миллисекунд капля набухает на кромке. */
  hang: number;
  /** Боковой снос при падении, px/s. */
  drift: number;
  phase: number;
  alpha: number;
  falling: boolean;
}

/** Неподвижная влажная бусина на кромке. */
interface Bead {
  x: number;
  radius: number;
  alpha: number;
  phase: number;
  /** Время появления: по нему бусина проявляется плавно. */
  born: number;
}

const MAX_DROPS = 12;
/** Сколько бусин держим на кромке постоянно. */
const BEAD_COUNT = 16;
const SPAWN_MIN_MS = 220;
const SPAWN_MAX_MS = 760;
/** Ускорение свободного падения, px/s². */
const GRAVITY = 900;
/** Начальная скорость срыва, px/s. */
const DETACH_SPEED = 18;
/** Отступ от боковых стенок пилюли, чтобы капли не висели в прозрачных углах. */
const EDGE_INSET = 3;
/** Сколько миллисекунд бусина проявляется. */
const BEAD_FADE_MS = 520;

/**
 * Создаёт слой капель. Анимация запускается только через `setActive(true)`.
 */
export function createDrips(): DripsView {
  const element = document.createElement("canvas");
  element.className = "drips";
  element.setAttribute("aria-hidden", "true");

  const context = element.getContext("2d");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  let drops: Drop[] = [];
  let beads: Bead[] = [];
  /** Ширина пилюли — canvas совпадает с ней по ширине. */
  let width = 0;
  /** Полная высота canvas: корпус пилюли + полоса капель. */
  let height = 0;
  /** Высота корпуса: от неё зависит геометрия скруглений. */
  let pillHeight = 0;
  let frame = 0;
  let previous = 0;
  let spawnTimer = 0;
  let wanted = false;
  let active = false;
  let disposed = false;
  /** Цвет капли: почти белая вода с оттенком акцента темы. */
  let tint = "233, 238, 255";

  /** Акцент темы → цвет воды. */
  const readTint = (): void => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    const match = /^#([\da-f]{6})$/i.exec(raw);
    if (!match) return;

    const value = Number.parseInt(match[1], 16);
    const mix = (channel: number): number => Math.round(255 * 0.7 + channel * 0.3);
    tint = `${mix((value >> 16) & 0xff)}, ${mix((value >> 8) & 0xff)}, ${mix(value & 0xff)}`;
  };

  /**
   * Добавляет контур корпуса пилюли (стадион: прямые бока со скруглением ровно
   * в полувысоту) в текущий путь. `beginPath` НЕ вызывается — контур нужен как
   * подпуть, чтобы отсечение `evenodd` умело вычесть его из прямоугольника.
   * `outset` выдвигает контур наружу, чтобы капля не «тонула» в стекле.
   */
  const addPill = (outset: number): void => {
    if (!context) return;
    const radius = Math.max(0.5, pillHeight / 2 + outset);
    const left = -outset;
    const right = width + outset;
    const top = -outset;
    const bottom = pillHeight + outset;

    context.moveTo(left + radius, top);
    context.lineTo(right - radius, top);
    context.arcTo(right, top, right, top + radius, radius);
    context.lineTo(right, bottom - radius);
    context.arcTo(right, bottom, right - radius, bottom, radius);
    context.lineTo(left + radius, bottom);
    context.arcTo(left, bottom, left, bottom - radius, radius);
    context.lineTo(left, top + radius);
    context.arcTo(left, top, left + radius, top, radius);
    context.closePath();
  };

  /**
   * Точка нижней кромки для координаты x: прямая часть и два нижних скругления.
   * Возвращает высоту от верха пилюли — капля «растёт» именно из этой точки.
   */
  const surfaceAt = (x: number): number => {
    const radius = pillHeight / 2;
    const half = width / 2;
    const overhang = Math.abs(x - half) - (half - radius);
    if (overhang <= 0) return pillHeight;
    return radius + Math.sqrt(Math.max(0, radius * radius - overhang * overhang));
  };

  /** Отсечение «всё, что снаружи корпуса»: вода не залезает на стекло. */
  const clipOutside = (): void => {
    if (!context) return;
    context.beginPath();
    context.rect(0, 0, width, height);
    addPill(0.6);
    context.clip("evenodd");
  };

  const resize = (): void => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const nextWidth = element.clientWidth;
    const nextHeight = element.clientHeight;
    if (nextWidth === width && nextHeight === height) return;

    const changed = nextWidth !== width;
    width = nextWidth;
    height = nextHeight;

    const styles = getComputedStyle(document.documentElement);
    const capsule = Number.parseFloat(styles.getPropertyValue("--capsule-height"));
    pillHeight = Math.min(Number.isFinite(capsule) ? capsule : 40, height);

    element.width = Math.max(1, Math.round(width * ratio));
    element.height = Math.max(1, Math.round(height * ratio));
    context?.setTransform(ratio, 0, 0, ratio, 0, 0);

    // Кромка поменяла длину — старые координаты бусин больше не годятся.
    if (changed) seedBeads();
  };

  /** Свободная точка на кромке: из нескольких кандидатов берём самую далёкую от занятых. */
  const spreadEdgeX = (): number => {
    const min = EDGE_INSET;
    const max = Math.max(min + 1, width - EDGE_INSET);
    const occupied = beads.map((bead) => bead.x);
    let best = min + Math.random() * (max - min);
    let bestGap = -1;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const candidate = min + Math.random() * (max - min);
      const gap = occupied.reduce((minGap, x) => Math.min(minGap, Math.abs(x - candidate)), Number.POSITIVE_INFINITY);
      if (gap > bestGap) {
        bestGap = gap;
        best = candidate;
      }
    }

    return best;
  };

  const makeBead = (x: number, born: number): Bead => ({
    x,
    radius: 0.8 + Math.random() * 1.2,
    alpha: 0.32 + Math.random() * 0.42,
    phase: Math.random() * Math.PI * 2,
    born,
  });

  /** Раскладывает бусины по всей кромке — по одной в самых свободных местах. */
  function seedBeads(): void {
    beads = [];
    if (width <= EDGE_INSET * 2) return;
    for (let index = 0; index < BEAD_COUNT; index += 1) {
      beads.push(makeBead(spreadEdgeX(), 0));
    }
  }

  /** Свободная капля: капля рождается из бусины, а на её место встаёт новая. */
  const spawn = (time: number): void => {
    if (drops.length >= MAX_DROPS || width <= EDGE_INSET * 2) return;

    const sourceIndex = beads.length > 0 ? Math.floor(Math.random() * beads.length) : -1;
    const source = sourceIndex >= 0 ? beads.splice(sourceIndex, 1)[0] : null;
    const x = source ? source.x : spreadEdgeX();

    drops.push({
      x,
      y: 0,
      radius: (source?.radius ?? 1.3) * 1.25 + Math.random() * 0.5,
      speed: 0,
      hang: 260 + Math.random() * 920,
      drift: (Math.random() - 0.5) * 26,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.44 + Math.random() * 0.4,
      falling: false,
    });

    while (beads.length < BEAD_COUNT) beads.push(makeBead(spreadEdgeX(), time));
  };

  /** Тело капли с бликом: без блика она читается как белая точка, а не стекло. */
  const paintDroplet = (x: number, y: number, radius: number, alpha: number, stretch: number): void => {
    if (!context || alpha <= 0.015 || radius <= 0.1) return;

    const rx = radius * 0.94;
    const ry = radius * stretch;

    // Тёмный контур-тень: на светных обоях белая вода иначе почти не видна.
    context.fillStyle = `rgba(6, 8, 14, ${Math.min(0.3, alpha * 0.42)})`;
    context.beginPath();
    context.ellipse(x, y, rx * 1.22, ry * 1.22, 0, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = `rgba(${tint}, ${Math.min(1, alpha)})`;
    context.beginPath();
    context.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = `rgba(255, 255, 255, ${Math.min(0.92, alpha * 1.6)})`;
    context.beginPath();
    context.ellipse(x - rx * 0.3, y - ry * 0.34, Math.max(0.25, rx * 0.32), Math.max(0.25, ry * 0.3), 0, 0, Math.PI * 2);
    context.fill();
  };

  /** Влажная кромка по всему силуэту: половинка обводки видна снаружи отсечения. */
  const paintSheen = (): void => {
    if (!context) return;
    context.beginPath();
    addPill(0.4);
    context.lineWidth = 2.6;
    context.strokeStyle = `rgba(${tint}, 0.09)`;
    context.stroke();
  };

  const paintBead = (bead: Bead, time: number): void => {
    const appear = Math.min(1, Math.max(0, (time - bead.born) / BEAD_FADE_MS));
    if (appear <= 0) return;

    const pulse = 0.5 + 0.5 * Math.sin(bead.phase + time * 0.0011);
    const radius = bead.radius * (0.82 + pulse * 0.2);
    const alpha = bead.alpha * (0.62 + pulse * 0.38) * appear;
    // Центр чуть НИЖЕ кромки — поэтому отсечение оставляет только «горбик» воды.
    paintDroplet(bead.x, surfaceAt(bead.x) + radius * 0.58, radius, alpha, 1);
  };

  const paintDrop = (drop: Drop): void => {
    if (!context) return;

    const y = drop.falling ? drop.y : surfaceAt(drop.x) + drop.radius * 0.5;
    const stretch = drop.falling ? Math.min(1.9, 1 + drop.speed * 0.007) : 1;
    const fade = drop.falling ? Math.min(1, Math.max(0, (height - y) / 12)) : 1;
    const alpha = drop.alpha * fade;
    if (alpha <= 0.02) return;

    // След: он и создаёт ощущение движения воды.
    if (drop.falling && drop.speed > 45) {
      const tail = Math.min(drop.radius * 4.5, drop.speed * 0.02);
      const gradient = context.createLinearGradient(drop.x, y - tail, drop.x, y);
      gradient.addColorStop(0, `rgba(${tint}, 0)`);
      gradient.addColorStop(1, `rgba(${tint}, ${alpha * 0.42})`);
      context.fillStyle = gradient;
      const tailWidth = Math.max(0.7, drop.radius * 0.5);
      context.fillRect(drop.x - tailWidth / 2, y - tail, tailWidth, tail);
    }

    paintDroplet(drop.x, y, drop.radius, alpha, stretch);
  };

  const render = (time: number): void => {
    if (!context) return;
    context.clearRect(0, 0, width, height);
    if (width === 0 || height === 0) return;

    context.save();
    clipOutside();
    paintSheen();
    for (const bead of beads) paintBead(bead, time);
    for (const drop of drops) paintDrop(drop);
    context.restore();
  };

  const step = (drop: Drop, delta: number, time: number): boolean => {
    if (!drop.falling) {
      // Набухает на кромке и слегка покачивается, как настоящая капля.
      drop.hang -= delta * 1000;
      drop.radius = Math.min(3.4, drop.radius + delta * 0.85);
      drop.x += Math.sin(drop.phase + time * 0.0016) * delta * 2.6;
      drop.x = Math.min(width - 1.5, Math.max(1.5, drop.x));

      if (drop.hang <= 0) {
        drop.falling = true;
        drop.speed = DETACH_SPEED + Math.random() * 22;
        drop.y = surfaceAt(drop.x) + drop.radius * 0.5;
      }
      return true;
    }

    drop.speed += GRAVITY * delta;
    drop.y += drop.speed * delta;
    drop.x += drop.drift * delta;

    return drop.y < height + 8;
  };

  const tick = (time: number): void => {
    if (!active) return;

    if (width === 0) {
      // Первый кадр мог прийти до раскладки — пробуем измерить ещё раз.
      resize();
      if (width === 0) {
        frame = window.requestAnimationFrame(tick);
        return;
      }
    }

    const delta = Math.min((time - previous) / 1000, 0.05);
    previous = time;

    drops = drops.filter((drop) => step(drop, delta, time));
    render(time);

    frame = window.requestAnimationFrame(tick);
  };

  const scheduleSpawn = (): void => {
    window.clearTimeout(spawnTimer);
    spawnTimer = window.setTimeout(() => {
      if (!active) return;
      spawn(performance.now());
      scheduleSpawn();
    }, SPAWN_MIN_MS + Math.random() * (SPAWN_MAX_MS - SPAWN_MIN_MS));
  };

  const start = (): void => {
    if (disposed || active || !context) return;

    readTint();
    resize();
    if (width === 0) {
      // Раскладка ещё не готова (первый кадр после старта) — повторим на следующем.
      frame = window.requestAnimationFrame(() => {
        if (wanted && !active) start();
      });
      return;
    }

    if (beads.length === 0) seedBeads();

    if (reducedMotion.matches) {
      // Без анимации показываем статичную «мокрую» кромку — эффект не мигает.
      render(performance.now());
      return;
    }

    active = true;
    previous = performance.now();
    frame = window.requestAnimationFrame(tick);
    scheduleSpawn();
    // Пара капель сразу: первый кадр не должен выглядеть сухим.
    spawn(performance.now());
    spawn(performance.now());
  };

  const stop = (): void => {
    active = false;
    window.clearTimeout(spawnTimer);
    window.cancelAnimationFrame(frame);
    frame = 0;
    drops = [];
    clearCanvas();
  };

  function clearCanvas(): void {
    context?.clearRect(0, 0, width, height);
  }

  const onVisibilityChange = (): void => {
    if (document.hidden) stop();
    else if (wanted) start();
  };

  const onResize = (): void => {
    if (active) resize();
  };

  // Акцент меняется в настройках — перекрашиваем капли без перезапуска цикла.
  const accentObserver = new MutationObserver(readTint);
  accentObserver.observe(document.documentElement, { attributeFilter: ["data-accent"] });

  const sizeObserver = new ResizeObserver(onResize);
  sizeObserver.observe(element);

  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", onVisibilityChange);

  return {
    element,

    setActive(next: boolean): void {
      wanted = next;
      if (next) start();
      else stop();
    },

    destroy(): void {
      disposed = true;
      stop();
      accentObserver.disconnect();
      sizeObserver.disconnect();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    },
  };
}
