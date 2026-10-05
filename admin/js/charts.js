import { html } from './ui.js';

const WIDTH = 860;
const HEIGHT = 280;
const MARGIN = { left: 82, right: 16, top: 24, bottom: 42 };
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;

function niceNumber(value, round) {
  if (!(value > 0) || !Number.isFinite(value)) return 1;
  const exponent = Math.floor(Math.log10(value));
  const fraction = value / (10 ** exponent);
  let niceFraction;
  if (round) niceFraction = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
  else niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * (10 ** exponent);
}

function axisFor(values, zeroBaseline) {
  let min = Math.min(...values), max = Math.max(...values);
  if (zeroBaseline) min = 0;
  else {
    const pad = max === min ? Math.max(Math.abs(max) * 0.025, 1) : (max - min) * 0.08;
    min -= pad;
    max += pad;
  }
  if (max <= min) max = min + 1;
  const step = niceNumber((max - min) / 5, true);
  // All metrics displayed here are nonnegative, so never print a misleading negative tick at zero.
  const low = zeroBaseline ? 0 : Math.max(0, Math.floor(min / step) * step);
  const high = Math.ceil(max / step) * step || step;
  const ticks = [];
  for (let tick = low, count = 0; tick <= high + step * 1e-8 && count < 9; tick += step, count++) {
    ticks.push(Math.abs(tick) < step * 1e-10 ? 0 : tick);
  }
  return { min: low, max: high, ticks: ticks.length ? ticks : [low, high] };
}

function timeLabel(value, rangeSeconds) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const options = rangeSeconds <= 86_400
    ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
    : rangeSeconds <= 7 * 86_400
      ? { day: 'numeric', month: 'short' }
      : { day: '2-digit', month: 'short' };
  return new Intl.DateTimeFormat('en-IN', { ...options, timeZone: 'Asia/Kolkata' }).format(date);
}

function seriesPath(points, key, axis, valueY) {
  let path = '', open = false;
  points.forEach((point, index) => {
    const value = point[key] === null || point[key] === undefined ? null : Number(point[key]);
    if (value === null || !Number.isFinite(value)) { open = false; return; }
    const x = points.length === 1 ? MARGIN.left + PLOT_WIDTH / 2 : MARGIN.left + (index / (points.length - 1)) * PLOT_WIDTH;
    const y = valueY(value, axis);
    path += `${open ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)} `;
    open = true;
  });
  return path.trim();
}

/** Render an accessible responsive SVG line chart with readable, unit-formatted Y-axis ticks. */
export function lineChart(points = [], series = [], { rangeSeconds = 604_800, formatAxis = (n) => String(n), zeroBaseline = false, label = 'Historical metrics' } = {}) {
  const validPoints = Array.isArray(points) ? points.filter((point) => point && Number.isFinite(Date.parse(point.at))) : [];
  const values = [];
  for (const point of validPoints) for (const metric of series) {
    const value = point[metric.key] === null || point[metric.key] === undefined ? null : Number(point[metric.key]);
    if (value !== null && Number.isFinite(value)) values.push(value);
  }
  if (!values.length) return html`<div class="db-chart-empty">No samples are available for this metric yet.</div>`;

  const axis = axisFor(values, zeroBaseline);
  const y = (value) => MARGIN.top + ((axis.max - value) / (axis.max - axis.min)) * PLOT_HEIGHT;
  const latestIndex = validPoints.length - 1;
  const xTicks = [...new Set([0, Math.round(latestIndex * 0.25), Math.round(latestIndex * 0.5), Math.round(latestIndex * 0.75), latestIndex])];
  const horizontal = axis.ticks.map((tick) => {
    const yPos = y(tick);
    return html`<line class="db-chart-gridline" x1="${MARGIN.left}" y1="${yPos}" x2="${WIDTH - MARGIN.right}" y2="${yPos}" />
      <text class="db-chart-y-label" x="${MARGIN.left - 10}" y="${yPos + 4}" text-anchor="end">${formatAxis(tick)}</text>`;
  });
  const vertical = xTicks.map((index) => {
    const point = validPoints[index];
    const x = validPoints.length === 1 ? MARGIN.left + PLOT_WIDTH / 2 : MARGIN.left + (index / latestIndex) * PLOT_WIDTH;
    const anchor = index === 0 ? 'start' : index === latestIndex ? 'end' : 'middle';
    return html`<line class="db-chart-x-tick" x1="${x}" y1="${MARGIN.top + PLOT_HEIGHT}" x2="${x}" y2="${MARGIN.top + PLOT_HEIGHT + 4}" />
      <text class="db-chart-x-label" x="${x}" y="${HEIGHT - 12}" text-anchor="${anchor}">${timeLabel(point.at, rangeSeconds)}</text>`;
  });
  const lines = series.map((metric) => {
    const path = seriesPath(validPoints, metric.key, axis, y);
    let lastIndex = -1;
    for (let index = validPoints.length - 1; index >= 0; index--) {
      const value = validPoints[index][metric.key];
      if (value !== null && value !== undefined && Number.isFinite(Number(value))) { lastIndex = index; break; }
    }
    if (!path || lastIndex < 0) return '';
    const point = validPoints[lastIndex], value = Number(point[metric.key]);
    const x = validPoints.length === 1 ? MARGIN.left + PLOT_WIDTH / 2 : MARGIN.left + (lastIndex / (validPoints.length - 1)) * PLOT_WIDTH;
    const yPos = y(value);
    return html`<path class="db-chart-line ${metric.color || ''}" d="${path}"><title>${metric.label}</title></path>
      <circle class="db-chart-point ${metric.color || ''}" cx="${x}" cy="${yPos}" r="3.5"><title>${metric.label}: ${formatAxis(value)} at ${timeLabel(point.at, rangeSeconds)}</title></circle>`;
  });
  return html`<svg class="db-chart-svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${label}" preserveAspectRatio="none">
    <title>${label}</title>
    ${horizontal}
    <line class="db-chart-axis" x1="${MARGIN.left}" y1="${MARGIN.top}" x2="${MARGIN.left}" y2="${MARGIN.top + PLOT_HEIGHT}" />
    <line class="db-chart-axis" x1="${MARGIN.left}" y1="${MARGIN.top + PLOT_HEIGHT}" x2="${WIDTH - MARGIN.right}" y2="${MARGIN.top + PLOT_HEIGHT}" />
    ${vertical}
    ${lines}
  </svg>`;
}
