// 界面辅助函数：用少量代码创建按钮、滑块、开关、数值卡片、图表容器等。
import * as echarts from 'echarts';

type Refreshable<T extends HTMLElement = HTMLElement> = T & { refresh(): void };
type ChartContainer = HTMLDivElement & { getChart(): echarts.ECharts; _chart?: echarts.ECharts };
type LogContainer = HTMLDivElement & {
  add(time: string, text: string, cls?: string): void;
  clear(): void;
};

/** 创建 DOM 元素：el('div', {class:'x'}, 子元素或文字...) */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, any>, ...children: any[]): HTMLElementTagNameMap[K];
export function el(tag: string, attrs?: Record<string, any>, ...children: any[]): HTMLElement;
export function el(tag: string, attrs: Record<string, any> = {}, ...children: any[]): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}

export function section(title, desc = '') {
  const s = el('div', { class: 'sec' }, el('h3', {}, title));
  if (desc) s.append(el('p', { class: 'desc' }, desc));
  return s;
}

export function button(label, onClick, cls = '') {
  return el('button', { class: 'btn ' + cls, onclick: onClick }, label);
}

/** 一组互斥按钮（如场景模式），返回容器，调用 set(value) 可更新高亮 */
export function buttonGroup(options, get, set) {
  const box = el('div', { class: 'btns' }) as Refreshable<HTMLDivElement>;
  const refresh = () => [...box.children].forEach((b, i) => b.classList.toggle('on', options[i].value === get()));
  options.forEach((o) => box.append(button(o.label, () => { set(o.value); refresh(); })));
  refresh();
  box.refresh = refresh;
  return box;
}

export function toggle(label, get, set) {
  const input = el('input', { type: 'checkbox' });
  input.checked = !!get();
  input.addEventListener('change', () => set(input.checked));
  const row = el('div', { class: 'row toggle-row' }, el('span', {}, label), el('label', { class: 'switch' }, input, el('span'))) as Refreshable<HTMLDivElement>;
  row.refresh = () => { input.checked = !!get(); };
  return row;
}

export function slider(label, min, max, step, get, set, fmt = (v) => v) {
  const input = el('input', { type: 'range', min, max, step });
  input.value = get();
  const val = el('span', { class: 'val' }, fmt(get()));
  input.addEventListener('input', () => { set(+input.value); val.textContent = fmt(+input.value); });
  const row = el('div', { class: 'row' }, el('label', {}, label), input, val) as Refreshable<HTMLDivElement>;
  row.refresh = () => { input.value = get(); val.textContent = fmt(get()); };
  return row;
}

export function select(label, options, get, set) {
  const s = el('select', {}, ...options.map((o) => el('option', { value: o.value }, o.label)));
  s.value = get();
  s.addEventListener('change', () => set(s.value));
  const row = el('div', { class: 'row' }, el('label', {}, label), s) as Refreshable<HTMLDivElement>;
  row.refresh = () => { s.value = get(); };
  return row;
}

/**
 * 数值卡片组：items = [{k:'标题', v:()=>数值字符串, unit}]
 * 返回的容器有 refresh() 方法，每隔一段时间调用一次刷新数值。
 */
export function stats(items, cols = 2) {
  const box = el('div', { class: 'stats' + (cols === 3 ? ' three' : '') }) as Refreshable<HTMLDivElement>;
  const vals = items.map((it) => {
    const v = el('div', { class: 'v' });
    box.append(el('div', { class: 'stat' }, el('div', { class: 'k' }, it.k), v));
    return v;
  });
  box.refresh = () => items.forEach((it, i) => { vals[i].innerHTML = `${it.v()}${it.unit ? `<small>${it.unit}</small>` : ''}`; });
  box.refresh();
  return box;
}

/** 图表容器。echarts 需要在元素显示后才能正确计算尺寸，所以延迟初始化 */
export function chart(height = 190) {
  const div = el('div', { class: 'chart', style: `height:${height}px` }) as ChartContainer;
  div.getChart = () => {
    if (!div._chart) div._chart = echarts.init(div, null, { renderer: 'canvas' });
    return div._chart;
  };
  return div;
}

export function logBox() {
  const box = el('div', { class: 'log' }) as LogContainer;
  box.add = (time, text, cls = '') => {
    box.append(el('div', { class: cls }, el('span', { class: 't' }, time), text));
    box.scrollTop = box.scrollHeight;
  };
  box.clear = () => { box.innerHTML = ''; };
  return box;
}

export function hint(text) {
  const d = el('div', { class: 'hint' });
  d.innerHTML = text;
  return d;
}

/** 顶部弹出提示 */
export function toast(text, cls = '', ms = 2600) {
  const t = el('div', { class: cls }, text);
  document.getElementById('toast').append(t);
  setTimeout(() => t.remove(), ms);
}

/** 图表通用样式 */
export const chartBase = {
  grid: { left: 42, right: 14, top: 30, bottom: 26 },
  textStyle: { fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif', fontSize: 11 },
  tooltip: { trigger: 'axis' },
  legend: { top: 0, itemWidth: 12, itemHeight: 8, textStyle: { fontSize: 11 } },
};
