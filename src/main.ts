// “好房子”三维可视化系统 —— 程序入口
// 负责：创建渲染器 / 场景 / 摄像机，搭建房屋与环境，加载人物，初始化各功能模块，运行每帧的更新循环。
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import './ui/style.css';
import { NavWorld } from './systems/nav.js';
import { Environment, WEATHER } from './scene/environment.js';
import { buildHouse } from './scene/house.js';
import { buildFurniture } from './scene/furniture.js';
import { buildDevices } from './scene/devices.js';
import { SceneModuleCatalog } from './modules/runtime.js';
import { registerBuiltInSceneModules } from './modules/registerBuiltins.js';
import { sectionPlane } from './scene/common.js';
import { STAIR, FLOORS } from './scene/layout.js';
import { People } from './characters/people.js';
import { CameraRig, VIEWPOINTS } from './systems/cameraRig.js';
import { Selection } from './systems/selection.js';
import { EnvModel } from './systems/envModel.js';
import { Heatmap } from './systems/heatmap.js';
import { mergeStatic } from './systems/optimize.js';
import { el, toast } from './ui/ui.js';
import { Dashboard } from './ui/dashboard.js';
import { OverviewFeature } from './features/overview.js';
import { SafetyFeature } from './features/safety.js';
import { ComfortFeature } from './features/comfort.js';
import { GreenFeature } from './features/green.js';
import { SmartFeature } from './features/smart.js';
import { LayersFeature } from './features/layers.js';

const loadingBar = document.querySelector<HTMLElement>('#loading .bar div')!;
const loadingText = document.querySelector<HTMLElement>('#loading p')!;
const progress = (p, text) => { loadingBar.style.width = p + '%'; loadingText.textContent = text; };
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

// 各楼层显示方式对应的剖切高度：整栋不剖切；只看一层切在一层天花板下；看二层切掉屋顶
const CUT = { all: 100, 0: FLOORS[1].y - 0.25, 1: FLOORS[1].y * 2 - 0.35 };

async function main() {
  const container = document.getElementById('app');
  // ---------- 渲染器 ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;  // 软阴影
  renderer.localClippingEnabled = true;                // 材质级剖切（分层查看）
  renderer.toneMapping = THREE.ACESFilmicToneMapping;   // 电影级色调映射
  renderer.toneMappingExposure = 0.68;
  container.append(renderer.domElement);
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.domElement.className = 'label-layer';
  container.append(labelRenderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.15, 6000);
  camera.position.set(...VIEWPOINTS[0].pos);

  // ---------- 场景搭建 ----------
  progress(8, '生成导航网格与室外环境…'); await nextFrame();
  const nav = new NavWorld(STAIR, FLOORS.map((f) => f.y));
  const env = new Environment(scene, renderer, nav);
  progress(22, '搭建两层房屋主体、楼梯、电梯与坡屋顶…'); await nextFrame();
  const house = buildHouse(nav);
  scene.add(house.root);
  progress(38, '布置家具（含 OBJ 模型解析）…'); await nextFrame();
  const furniture = buildFurniture();
  for (const { bounds, floor } of furniture.navFootprints) nav.blockRect(floor, bounds.x0, bounds.x1, bounds.z0, bounds.z1);
  scene.add(furniture.root);
  progress(48, '安装智能设备、消防设施与光伏系统…'); await nextFrame();
  const moduleCatalog = new SceneModuleCatalog();
  registerBuiltInSceneModules(moduleCatalog);
  const devices = buildDevices({
    entryDoorPivot: house.doors['door-entry'].pivot,
    pvRoof: house.roofParts,
  });
  scene.add(devices.root);
  // 房屋、家具、设备的所有材质都响应剖切平面（默认不裁剪，分层查看时生效）
  for (const root of [house.root, furniture.root, devices.root]) root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (!m.clippingPlanes) m.clippingPlanes = [sectionPlane];
  });
  nav.buildClearance();
  // 静态几何合并：同一件物体里同材质的网格合并为一个，大幅减少绘制调用
  // （调试用：网址后加 ?nomerge 可跳过合并，便于逐件检查模型）
  const merged = location.search.includes('nomerge') ? 0 : [house.root, furniture.root, devices.root, env.group].reduce((s, r) => s + mergeStatic(r), 0);
  console.log('合并静态网格：减少', merged, '个绘制对象');
  progress(58, '加载真人角色模型并重定向动画…'); await nextFrame();
  const people = await new People(scene, nav).load();

  const app: any = {
    renderer, scene, camera, nav, env, house, furniture, devices, people, moduleCatalog,
    sceneModules: [...furniture.modules, ...devices.modules],
    envModel: new EnvModel(),
    heatmaps: [new Heatmap(scene, 0), new Heatmap(scene, 1)],
    clock: { hour: 10, day: 172, weather: 'sunny', playing: false, speed: 300 },
    labels: [],
    events: [],
    view: 'all',
    pickables: [house.root, furniture.root, devices.root, env.group, ...people.all.map((p) => p.object)],
    /** 在三维场景中放一个 HTML 标签 */
    makeLabel(html, cls, x, y, z, parent = scene) {
      const div = el('div', { class: 'lbl ' + (cls || '') });
      div.innerHTML = html;
      const obj = new CSS2DObject(div);
      obj.position.set(x, y, z);
      parent.add(obj);
      app.labels.push(obj);
      return obj;
    },
    /** 显示哪一层：'all' 整栋（含屋顶）、0 只看一层、1 看到二层（去掉屋顶） */
    viewFloor(v) {
      app.view = v;
      app.features?.layers?.applySection();
      app.ui?.syncView?.();
    },
    setRoof(visible) { app.viewFloor(visible ? 'all' : 1); },
    /** 统一的事件记录（数据大屏的告警列表显示） */
    log(level, text) {
      const h = app.clock.hour;
      app.events.unshift({ time: `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`, level, text });
      if (app.events.length > 60) app.events.pop();
    },
    onTimeChanged: [],
    setTime: (h) => setTime(app, h),
    highQuality: true,
    setQuality(high) {
      app.highQuality = high;
      renderer.setPixelRatio(high ? Math.min(window.devicePixelRatio, 1.5) : 1);
      env.sun.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024);
      env.sun.shadow.map?.dispose();
      env.sun.shadow.map = null;
    },
    CUT,
  };
  app.rig = new CameraRig(camera, renderer.domElement, nav);
  app.rig.controls.target.set(...VIEWPOINTS[0].target);
  app.selection = new Selection(app);

  progress(72, '初始化功能模块…'); await nextFrame();
  const tabs: { id: string; name: string; color: string; feature: any }[] = [
    { id: 'overview', name: '总览', color: '#1f7ae0', feature: new OverviewFeature(app) },
    { id: 'safety', name: '安全耐久', color: '#d64541', feature: new SafetyFeature(app) },
    { id: 'comfort', name: '健康舒适', color: '#e08a1f', feature: new ComfortFeature(app) },
    { id: 'green', name: '绿色低碳', color: '#2e9d57', feature: new GreenFeature(app) },
    { id: 'smart', name: '智慧便捷', color: '#6c5ce7', feature: new SmartFeature(app) },
    { id: 'layers', name: '分层查看', color: '#34495e', feature: new LayersFeature(app) },
  ];
  app.features = Object.fromEntries(tabs.map((t) => [t.id, t.feature]));
  app.dashboard = new Dashboard(app);
  buildUI(app, tabs);
  setTime(app, app.clock.hour);
  app.log('ok', '系统启动，全屋设备在线');

  progress(90, '编译着色器…'); await nextFrame();
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  document.getElementById('loading').remove();

  // ---------- 主循环 ----------
  const timer = new THREE.Clock();
  let frames = 0, fpsTime = 0, slowTick = 0;
  const fpsEl = document.getElementById('fps');
  app.fps = 60;
  const fpsHistory = [];
  function loop() {
    requestAnimationFrame(loop);
    try { frame(); } catch (e) { console.error(e); } // 某个功能出错时不影响整个画面继续运行
  }
  function frame() {
    const dt = Math.min(timer.getDelta(), 0.05);
    if (app.clock.playing) {
      let h = app.clock.hour + (dt * app.clock.speed) / 3600;
      if (h >= 24) h -= 24;
      setTime(app, h);
    }
    for (const d of (Object.values(house.doors) as any[])) d.update(dt);
    for (const w of (Object.values(house.windows) as any[])) if (w.update && !house.doors[w.op.id]) w.update(dt);
    for (const module of app.sceneModules) module.update(dt);
    people.update(dt);
    env.update(dt, camera);
    app.rig.update(dt);
    for (const t of tabs) t.feature.update?.(dt, t.id === app.activeTab);
    app.selection.update();
    devices.lightPool.update(camera, sectionPlane.constant);
    slowTick += dt;
    if (slowTick > 0.5) {
      stepEnvironment(app, slowTick);
      for (const t of tabs) t.feature.slowUpdate?.(slowTick, t.id === app.activeTab);
      app.dashboard.slowUpdate();
      app.selection.refreshData();
      slowTick = 0;
    }
    // 被剖切掉的楼层上的标签也隐藏
    const cut = sectionPlane.constant;
    for (const l of app.labels) l.element.style.opacity = l.position.y > cut + 0.3 ? '0' : '';
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    frames++; fpsTime += dt;
    if (fpsTime >= 1) {
      app.fps = frames / fpsTime;
      fpsHistory.push(app.fps); if (fpsHistory.length > 60) fpsHistory.shift();
      const avg = fpsHistory.reduce((a, b) => a + b, 0) / fpsHistory.length;
      fpsEl.textContent = `FPS ${app.fps.toFixed(0)}（平均 ${avg.toFixed(0)}）`;
      fpsEl.classList.toggle('low', app.fps < 25);
      frames = 0; fpsTime = 0;
    }
  }
  loop();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
    app.dashboard.resize();
  });
  (window as any).app = app;
}

/** 设置模拟时间：更新太阳、天空、光照，并通知各模块 */
export function setTime(app, hour) {
  app.clock.hour = hour;
  const s = app.env.set(hour, app.clock.day, app.clock.weather);
  app.sun = s;
  app.sunFactor = Math.max(0, Math.min(1, s.elevation / 25)) * WEATHER[app.clock.weather].sun;
  app.envModel.updateOutdoor(hour, app.clock.day, app.clock.weather);
  for (const f of app.onTimeChanged) f(hour);
}

/** 每 0.5 秒推进一次室内环境模拟 */
function stepEnvironment(app, dt) {
  const { house, devices, people } = app;
  const registry = devices.registry;
  const roomWindows: Record<string, boolean> = {};
  for (const w of (Object.values(house.windows) as any[])) if (w.isOpen) roomWindows[w.op.room] = true;
  const count: Record<string, number> = {};
  for (const p of people.list) if (p.room && p.object.visible) count[p.room] = (count[p.room] ?? 0) + 1;
  const acByRoom: Record<string, any> = {};
  for (const d of registry.byType('ac')) acByRoom[d.room] = registry.getClimate(d.id);
  const curtainByRoom: Record<string, number> = {};
  for (const d of registry.byType('curtain')) curtainByRoom[d.room] = registry.getCurtain(d.id)?.getOpenRatio() ?? 0;
  const ventilation = registry.getVentilation('fresh-air');
  const ventRooms = new Set(ventilation?.getOutlets?.().map((v) => v.room) ?? []);
  const openPlan = (id) => id === 'living' || id === 'dining';
  const ctx = {
    sun: app.sun, sunFactor: app.sunFactor,
    windowsOpen: (id) => roomWindows[id] || (openPlan(id) && (roomWindows.living || roomWindows.dining)) || (id === 'hall2' && roomWindows.family),
    acOn: (id) => acByRoom[id]?.isOn() || (id === 'dining' && acByRoom.living?.isOn()),
    acSet: (id) => (acByRoom[id] ?? acByRoom.living)?.getSetpoint() ?? 26,
    curtainOpen: (id) => curtainByRoom[id],
    people: (id) => count[id] ?? 0,
    cooking: people.list.some((p) => p.activity.includes('做饭')),
    fresh: { on: ventilation?.isOn() ?? false, level: ventilation?.getLevel() ?? 0, rooms: ventRooms },
    shading: app.features?.comfort?.shadingOn ?? false,
    tvOn: app.features?.smart?.tvOn ?? false,
  };
  const simDt = dt * (app.clock.playing ? Math.max(1, app.clock.speed / 20) : 1) * 6;
  app.envModel.step(simDt, ctx);
}

// ---------------- 界面 ----------------
function buildUI(app, tabs) {
  const tabBox = document.getElementById('tabs');
  const left = document.getElementById('left');
  const panels: Record<string, HTMLElement> = {};
  for (const t of tabs) {
    const b = el('button', { onclick: () => activate(t.id) }, t.name);
    b.dataset.id = t.id;
    tabBox.append(b);
    const panel = el('div', { style: 'display:none' });
    t.feature.buildPanel(panel);
    left.append(panel);
    panels[t.id] = panel;
  }
  function activate(id) {
    const prev = app.activeTab;
    if (prev === id) return;
    if (prev) tabs.find((t) => t.id === prev).feature.leave?.();
    app.activeTab = id;
    const t = tabs.find((x) => x.id === id);
    document.documentElement.style.setProperty('--tab-color', t.color);
    for (const b of Array.from(tabBox.children) as HTMLElement[]) b.classList.toggle('active', b.dataset.id === id);
    for (const [k, p] of Object.entries(panels)) p.style.display = k === id ? '' : 'none';
    left.scrollTop = 0;
    t.feature.enter?.();
  }
  app.activateTab = activate;

  // 右上角：楼层切换 + 数据大屏
  const right = document.querySelector('#topbar .right');
  const floorBox = el('div', { class: 'floor-switch' });
  const floorBtns = [['all', '整栋'], [0, '一层'], [1, '二层']].map(([v, label]) => {
    const b = el('button', { onclick: () => app.viewFloor(v) }, label);
    b.dataset.v = String(v);
    floorBox.append(b);
    return b;
  });
  app.ui = { syncView: () => floorBtns.forEach((b) => b.classList.toggle('on', b.dataset.v === String(app.view))) };
  app.ui.syncView();
  right.prepend(floorBox, el('button', { class: 'btn dash-btn', onclick: () => app.dashboard.toggle() }, '📊 数据大屏'));

  // 视点按钮
  const views = document.getElementById('views');
  for (const v of VIEWPOINTS) views.append(el('button', { onclick: () => { app.rig.flyTo(v.pos, v.target); app.viewFloor(v.view); } }, v.name));
  const walkBtn = el('button', { class: 'walk', onclick: () => app.rig.setMode(app.rig.mode === 'walk' ? 'orbit' : 'walk') }, '第一人称漫游');
  views.append(walkBtn);
  app.rig.onModeChange = (m) => {
    walkBtn.textContent = m === 'walk' ? '退出漫游' : '第一人称漫游';
    document.getElementById('walkHelp').classList.toggle('show', m === 'walk');
    document.getElementById('crosshair').classList.toggle('show', m === 'walk');
    if (m === 'walk') { app.viewFloor('all'); toast('漫游模式：W/A/S/D 移动，鼠标拖动转向，走到楼梯可以上下楼，Esc 退出'); }
  };

  // 时间栏
  const tb = document.getElementById('timebar');
  const clockEl = el('span', { class: 'clock' });
  const sunEl = el('span', { class: 'sun' });
  const range = el('input', { type: 'range', min: 0, max: 23.99, step: 0.05 });
  range.addEventListener('input', () => setTime(app, +range.value));
  const playBtn = el('button', { class: 'btn', onclick: () => { app.clock.playing = !app.clock.playing; syncTime(); } });
  const speedSel = el('select', {}, ...[[60, '1 分钟/秒'], [300, '5 分钟/秒'], [1200, '20 分钟/秒']].map(([v, l]) => el('option', { value: v }, l)));
  speedSel.value = '300';
  speedSel.addEventListener('change', () => { app.clock.speed = +speedSel.value; });
  const daySel = el('select', {}, ...[[172, '夏至（6月21日）'], [80, '春分（3月21日）'], [266, '秋分（9月23日）'], [355, '冬至（12月21日）']].map(([v, l]) => el('option', { value: v }, l)));
  daySel.value = app.clock.day;
  daySel.addEventListener('change', () => { app.clock.day = +daySel.value; setTime(app, app.clock.hour); });
  const weatherSel = el('select', {}, ...Object.entries(WEATHER).map(([k, w]) => el('option', { value: k }, w.name)));
  weatherSel.addEventListener('change', () => { app.clock.weather = weatherSel.value; setTime(app, app.clock.hour); });
  tb.append(clockEl, range, playBtn, speedSel, daySel, weatherSel, sunEl);
  function syncTime() {
    const h = app.clock.hour;
    clockEl.textContent = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
    if (document.activeElement !== range) range.value = h;
    playBtn.textContent = app.clock.playing ? '⏸ 暂停' : '▶ 播放';
    const s = app.sun;
    sunEl.textContent = s.elevation > 0 ? `太阳高度角 ${s.elevation.toFixed(1)}°  方位 ${s.azimuth >= 0 ? '偏西' : '偏东'}${Math.abs(s.azimuth).toFixed(0)}°` : '夜间（太阳在地平线以下）';
    weatherSel.value = app.clock.weather;
    daySel.value = app.clock.day;
  }
  app.onTimeChanged.push(syncTime);
  app.syncTime = syncTime;

  app.selection.onSelect = (obj) => { for (const t of tabs) t.feature.onSelect?.(obj); };
  activate('overview');
}

main().catch((e) => {
  console.error(e);
  const p = document.querySelector('#loading p');
  if (p) p.textContent = '加载失败：' + e.message + '（请使用最新版 Chrome 或 Edge，并确认已开启硬件加速）';
});
