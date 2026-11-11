import { escapeHtml, formatBytes, formatPercent, formatRate, formatUptime, ratio } from "../../lib/format";
import {
  getBattery,
  getSystemSnapshot,
  subscribeBattery,
  systemSnapshot,
  systemStatus,
  type SystemStatus,
} from "../../services/system";
import type { BatteryInfo, SystemSnapshot } from "../../types";
import type { AppContext } from "../context";
import { requireElement } from "../dom";
import type { PageFactory, PageInstance } from "../panel";
import { renderMetric } from "../widgets";

/** Раздел «Система»: нагрузка, сеть, процессы и сведения о машине. */
export const systemPage: PageFactory = (root: HTMLElement, context: AppContext): PageInstance => {
  root.innerHTML = `
    <div class="status-line" data-ref="status"></div>
    <section class="metric-grid" data-ref="metrics"></section>
    <section class="card">
      <div class="metric-head">
        <p class="card-kicker">СЕТЬ</p>
        <strong data-ref="vpn">VPN не обнаружен</strong>
      </div>
      <div class="net-grid">
        <div class="net-cell"><span class="net-arrow">↓</span><strong data-ref="rx">0 Б/с</strong><span class="muted">приём</span></div>
        <div class="net-cell"><span class="net-arrow">↑</span><strong data-ref="tx">0 Б/с</strong><span class="muted">отдача</span></div>
        <div class="net-cell"><strong data-ref="total">0 Б</strong><span class="muted">за сеанс</span></div>
      </div>
    </section>
    <section class="card">
      <p class="card-kicker">ТОП ПРОЦЕССОВ</p>
      <div class="process-list" data-ref="processes"></div>
    </section>
    <section class="card meta-card" data-ref="meta"></section>
  `;

  const statusNode = requireElement<HTMLElement>('[data-ref="status"]', root);
  const metricsNode = requireElement<HTMLElement>('[data-ref="metrics"]', root);
  const processesNode = requireElement<HTMLElement>('[data-ref="processes"]', root);
  const metaNode = requireElement<HTMLElement>('[data-ref="meta"]', root);
  const vpnNode = requireElement<HTMLElement>('[data-ref="vpn"]', root);
  const rxNode = requireElement<HTMLElement>('[data-ref="rx"]', root);
  const txNode = requireElement<HTMLElement>('[data-ref="tx"]', root);
  const totalNode = requireElement<HTMLElement>('[data-ref="total"]', root);

  const renderStatus = (status: SystemStatus): void => {
    statusNode.innerHTML =
      status === "live"
        ? ""
        : '<p class="status-note">Нативные данные недоступны. Запустите приложение через <code>npm run tauri dev</code>.</p>';
  };

  const render = (snapshot: SystemSnapshot, battery: BatteryInfo | null): void => {
    const memoryFill = ratio(snapshot.memoryUsed, snapshot.memoryTotal);
    const disk = snapshot.disks[0];
    const diskFill = disk ? ratio(disk.total - disk.available, disk.total) : 0;

    metricsNode.innerHTML = [
      renderMetric({
        label: "CPU",
        value: formatPercent(snapshot.cpuUsage),
        hint: `${snapshot.cpuCores} потоков · ${snapshot.cpuBrand || "процессор"}`,
        fill: snapshot.cpuUsage / 100,
        tone: snapshot.cpuUsage > 85 ? "warning" : "accent",
      }),
      renderMetric({
        label: "Память",
        value: formatPercent(memoryFill * 100),
        hint: `${formatBytes(snapshot.memoryUsed)} из ${formatBytes(snapshot.memoryTotal)}`,
        fill: memoryFill,
        tone: memoryFill > 0.9 ? "warning" : "accent",
      }),
      renderMetric({
        label: "Диск",
        value: disk ? formatPercent(ratio(disk.total - disk.available, disk.total) * 100) : "—",
        hint: disk ? `${formatBytes(disk.available)} свободно · ${disk.mount}` : "нет данных",
        fill: diskFill,
        tone: diskFill > 0.9 ? "warning" : "accent",
      }),
      renderMetric({
        label: "Батарея",
        value: battery ? formatPercent(battery.level * 100) : "—",
        hint: battery ? (battery.charging ? "заряжается" : "от батареи") : "нет батареи",
        fill: battery ? battery.level : 0,
        tone: battery && battery.level < 0.15 ? "warning" : "accent",
      }),
    ].join("");

    vpnNode.textContent = snapshot.network.vpnInterface
      ? `VPN: ${snapshot.network.vpnInterface}`
      : "VPN не обнаружен";
    vpnNode.classList.toggle("is-active", snapshot.network.vpnInterface !== null);

    rxNode.textContent = formatRate(snapshot.network.rxPerSec);
    txNode.textContent = formatRate(snapshot.network.txPerSec);
    totalNode.textContent = `↓${formatBytes(snapshot.network.totalRx)} ↑${formatBytes(snapshot.network.totalTx)}`;

    processesNode.innerHTML =
      snapshot.processes.length === 0
        ? '<p class="muted">Процессы не получены.</p>'
        : snapshot.processes
            .map(
              (process) => `
                <div class="process-row">
                  <span class="process-name" title="${escapeHtml(process.name)}">${escapeHtml(process.name)}</span>
                  <span class="process-cpu">${formatPercent(process.cpu)}</span>
                  <span class="process-mem">${formatBytes(process.memory)}</span>
                </div>`,
            )
            .join("");

    metaNode.innerHTML = `
      <p class="card-kicker">СИСТЕМА</p>
      <div class="meta-grid">
        <span class="muted">Компьютер</span><strong>${escapeHtml(snapshot.hostName || "—")}</strong>
        <span class="muted">ОС</span><strong>${escapeHtml(`${snapshot.osName} ${snapshot.osVersion}`.trim() || "—")}</strong>
        <span class="muted">Аптайм</span><strong>${escapeHtml(formatUptime(snapshot.uptimeSecs))}</strong>
        <span class="muted">Процессов</span><strong>${snapshot.processCount}</strong>
        <span class="muted">Интерфейсов</span><strong>${snapshot.network.interfaces}</strong>
      </div>
    `;
  };

  const paint = (): void => {
    const snapshot = getSystemSnapshot();
    if (!snapshot) {
      renderStatus("offline");
      return;
    }
    renderStatus("live");
    render(snapshot, getBattery());
  };

  paint();

  const unsubscribeSnapshot = systemSnapshot.subscribe(paint);
  const unsubscribeStatus = systemStatus.subscribe(renderStatus);
  const unsubscribeBattery = subscribeBattery(() => {
    const snapshot = getSystemSnapshot();
    if (snapshot) render(snapshot, getBattery());
  });

  void context;

  return {
    destroy(): void {
      unsubscribeSnapshot();
      unsubscribeStatus();
      unsubscribeBattery();
    },
  };
};
