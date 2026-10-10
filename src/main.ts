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
import { SimulationClock } from './systems/clock.js';
import { FrameScheduler } from './systems/scheduler.js';
import { FootprintService } from './systems/nav.js';
import { SceneModuleHost } from './modules/host.js';
import { mergeStatic } from './systems/optimize.js';
import { el, toast, disposeAllCharts } from './ui/ui.js';
import { Disposer } from './systems/disposer.js';
import { Dashboard } from './ui/dashboard.js';
import type { AppEvent } from './ui/dashboard.js';
import { OverviewFeature } from './features/overview.js';
import { SafetyFeature } from './features/safety.js';
import { ComfortFeature } from './features/comfort.js';
import { GreenFeature } from './features/green.js';
import { SmartFeature } from './features/smart.js';
import { LayersFeature } from './features/layers.js';
import type { FeatureServices, FloorView, HomeStatus, LogLevel, Weather } from './features/services.js';

/** 取页面上必须存在的元素；缺了说明 index.html 和代码不一致，直接报清楚 */
function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error('页面缺少元素 #' + id);
  return element as T;
}

const loadingBar = document.querySelector<HTMLElement>('#loading .bar div')!;
const loadingText = document.querySelector<HTMLElement>('#loading p')!;
const progress = (p, text) => { loadingBar.style.width = p + '%'; loadingText.textContent = text; };
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

// 各楼层显示方式对应的剖切高度：整栋不剖切；只看一层切在一层天花板下；看二层切掉屋顶
const CUT: Record<string, number> = { all: 100, 0: FLOORS[1].y - 0.25, 1: FLOORS[1].y * 2 - 0.35 };

interface Feature {
  buildPanel(root: HTMLElement): void;
  enter?(): void;
  leave?(): void;
  update?(dt: number, active: boolean): void;
  slowUpdate?(dt: number, active: boolean): void;
  onSelect?(object: THREE.Object3D | null): void;
}

/** 创建并启动整套系统；返回的 app.dispose() 会完整释放，之后可以再次调用 startApp() 重建 */
export async function startApp() {
  const container = byId('app');
  const lifetime = new Disposer(); // 本次运行的定时器和窗口监听
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
  // 场景模块统一交给宿主：负责逐帧更新、导航占地的登记 / 移动 / 撤销（家具已由布局挂到 furniture.root 下）
  const footprints = new FootprintService(nav);
  const moduleHost = new SceneModuleHost(scene, footprints);
  const solidFurniture = new Map(furniture.navFootprints.map((f) => [f.moduleId, f]));
  for (const module of furniture.modules) {
    const solid = solidFurniture.get(module.id);
    moduleHost.add(module, { mount: false, floor: solid?.floor ?? 0, footprint: !!solid });
    solidFurniture.delete(module.id);
  }
  // 不对应模块的占地（如淋浴区留空）直接登记
  for (const f of solidFurniture.values()) footprints.register(f.moduleId, f.floor, f.bounds);
  scene.add(furniture.root);
  progress(48, '安装智能设备、消防设施与光伏系统…'); await nextFrame();
  const moduleCatalog = new SceneModuleCatalog();
  registerBuiltInSceneModules(moduleCatalog);
  const devices = buildDevices({
    openings: house.openings,
    pvRoof: house.roofParts,
  });
  scene.add(devices.root);
  for (const module of devices.modules) moduleHost.add(module, { mount: false });
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

  const envModel = new EnvModel();
  const clock = new SimulationClock(env, envModel);
  clock.setTime(clock.hour); // 先算好太阳位置，功能页初始化时就能读到
  const rig = new CameraRig(camera, renderer.domElement, nav);
  rig.controls.target.set(...VIEWPOINTS[0].target);

  // 楼层显示与剖切：手动剖切高度优先，否则按当前显示的楼层
  let view: FloorView = 'all';
  let manualCut: number | null = null;
  const viewListeners: (() => void)[] = [];
  const applySection = () => {
    sectionPlane.constant = manualCut ?? CUT[view];
    for (const listener of viewListeners) listener();
  };

  // 各功能页在下面创建；跨功能页的共享状态只通过 home 读取
  let safety: SafetyFeature, comfort: ComfortFeature, green: GreenFeature, smart: SmartFeature, layers: LayersFeature;
  let activateTab: (id: string) => void = () => {};
  const home: HomeStatus = {
    get shadingOn() { return comfort.shadingOn; },
    get tvOn() { return smart.tvOn; },
    get fireActive() { return safety.fireActive; },
    get sosActive() { return !!safety.sos; },
    get fallActive() { return !!safety.fallActive; },
    get energy() { return green; },
  };

  let selection: Selection;
  let dashboard: Dashboard;
  const app = {
    renderer, scene, camera, nav, env, rig, envModel, clock, people, moduleCatalog, CUT,
    devices,
    openings: house.openings,
    moduleHost, footprints,
    heatmaps: [new Heatmap(scene, 0), new Heatmap(scene, 1)],
    labels: [] as CSS2DObject[],
    events: [] as AppEvent[],
    pickables: [house.root, furniture.root, devices.root, env.group, ...people.all.map((p) => p.object)],
    outdoor: env,
    sceneLayers: {
      house: house.root, walls: house.walls, openings: house.openingsGroup,
      furniture: furniture.root, devices: devices.root, outdoor: env.group,
    },
    house: {
      sunBlockers: [house.walls, house.floors, house.roof, house.details],
      gutterY: house.roofParts.gutterY,
      roofHalfDepth: house.roofParts.halfD,
      addFixture: (object: THREE.Object3D) => { house.root.add(object); },
    },
    home,
    get selection() { return selection; },
    get dashboard() { return dashboard; },
    features: {} as Record<string, Feature>,
    activeTab: undefined as string | undefined,
    scheduler: null as FrameScheduler | null,
    fps: 60,
    /** 在三维场景中放一个 HTML 标签 */
    makeLabel(html: string, cls: string, x: number, y: number, z: number, parent: THREE.Object3D = scene) {
      const div = el('div', { class: 'lbl ' + (cls || '') });
      div.innerHTML = html;
      const obj = new CSS2DObject(div);
      obj.position.set(x, y, z);
      parent.add(obj);
      app.labels.push(obj);
      return obj;
    },
    /** 显示哪一层：'all' 整栋（含屋顶）、0 只看一层、1 看到二层（去掉屋顶） */
    get view() { return view; },
    viewFloor(v: FloorView) { view = v; applySection(); },
    get manualCut() { return manualCut; },
    /** 手动剖切高度；≥ 8.9 或 null 表示不剖切，回到按楼层显示 */
    setCut(height: number | null) { manualCut = height === null || height >= 8.9 ? null : height; applySection(); },
    onViewChange(listener: () => void) { viewListeners.push(listener); },
    flyTo: (pos, target, duration?: number) => rig.flyTo(pos, target, duration),
    get sun() { return clock.sun; },
    get sunFactor() { return clock.sunFactor; },
    setTime: (hour: number) => clock.setTime(hour),
    setWeather: (weather: Weather) => clock.setWeather(weather),
    setPlaying: (playing: boolean, speed?: number) => clock.setPlaying(playing, speed),
    onTimeChanged: (listener: (hour: number) => void) => clock.onTimeChanged(listener),
    /** 统一的事件记录（数据大屏的告警列表显示） */
    later: (fn: () => void, ms: number) => lifetime.later(fn, ms),
    dispose: () => {},
    log(level: LogLevel, text: string) {
      app.events.unshift({ time: clock.format(), level, text });
      if (app.events.length > 60) app.events.pop();
    },
    get heatmap() { return layers; },
    activateTab: (id: string) => activateTab(id),
    toggleDashboard: () => app.dashboard.toggle(),
    highQuality: true,
    setQuality(high: boolean) {
      app.highQuality = high;
      renderer.setPixelRatio(high ? Math.min(window.devicePixelRatio, 1.5) : 1);
      env.sun.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024);
      env.sun.shadow.map?.dispose();
      env.sun.shadow.map = null;
    },
  };
  selection = new Selection(app);
  // 编译期检查：主程序实现了功能页需要的全部窄接口
  const services: FeatureServices = app;

  progress(72, '初始化功能模块…'); await nextFrame();
  // 分层查看最先创建：舒适、智慧功能页通过 heatmap 接口使用它的热力图
  layers = new LayersFeature(services);
  safety = new SafetyFeature(services);
  comfort = new ComfortFeature(services);
  green = new GreenFeature(services);
  smart = new SmartFeature(services);
  const tabs: { id: string; name: string; color: string; feature: Feature }[] = [
    { id: 'overview', name: '总览', color: '#1f7ae0', feature: new OverviewFeature(services) },
    { id: 'safety', name: '安全耐久', color: '#d64541', feature: safety },
    { id: 'comfort', name: '健康舒适', color: '#e08a1f', feature: comfort },
    { id: 'green', name: '绿色低碳', color: '#2e9d57', feature: green },
    { id: 'smart', name: '智慧便捷', color: '#6c5ce7', feature: smart },
    { id: 'layers', name: '分层查看', color: '#34495e', feature: layers },
  ];
  app.features = Object.fromEntries(tabs.map((t) => [t.id, t.feature]));
  dashboard = new Dashboard(app);
  const ui = buildUI(app, tabs);
  activateTab = ui.activate;
  clock.setTime(clock.hour);
  app.log('ok', '系统启动，全屋设备在线');

  progress(90, '编译着色器…'); await nextFrame();
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  document.getElementById('loading')?.remove();

  // ---------- 主循环 ----------
  // 统一更新调度：逐帧任务按下面的顺序执行，慢任务每 0.5 秒一次
  const scheduler = new FrameScheduler(0.5);
  scheduler.every('时钟', (dt) => clock.advance(dt));
  scheduler.every('门窗', (dt) => house.openings.update(dt));
  scheduler.every('场景模块', (dt) => moduleHost.update(dt));
  scheduler.every('人物', (dt) => people.update(dt));
  scheduler.every('室外环境', (dt) => env.update(dt, camera));
  scheduler.every('摄像机', (dt) => rig.update(dt));
  for (const t of tabs) scheduler.every('功能页 ' + t.id, (dt) => t.feature.update?.(dt, t.id === app.activeTab));
  scheduler.every('选中框', () => app.selection.update());
  scheduler.every('灯光池', () => devices.lightPool.update(camera, sectionPlane.constant));
  scheduler.slow('室内环境模拟', (dt) => stepEnvironment(app, dt));
  for (const t of tabs) scheduler.slow('功能页 ' + t.id, (dt) => t.feature.slowUpdate?.(dt, t.id === app.activeTab));
  scheduler.slow('数据大屏', () => app.dashboard.slowUpdate());
  scheduler.slow('信息卡片', () => app.selection.refreshData());
  app.scheduler = scheduler;

  const timer = new THREE.Clock();
  let frames = 0, fpsTime = 0;
  const fpsEl = byId('fps');
  const fpsHistory: number[] = [];
  let rafId = 0;
  function loop() {
    if (lifetime.isDisposed) return;
    rafId = requestAnimationFrame(loop);
    try { frame(); } catch (e) { console.error(e); } // 某个功能出错时不影响整个画面继续运行
  }
  function frame() {
    const dt = Math.min(timer.getDelta(), 0.05);
    scheduler.tick(dt);
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

  lifetime.listen(window, 'resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
    app.dashboard.resize();
  });

  // ---------- 完整销毁 ----------
  // 顺序：停主循环 → 取消定时器和窗口监听 → 各子系统的监听与动画 → 场景模块 → 图表与页面元素 → GPU 资源
  app.dispose = () => {
    if (lifetime.isDisposed) return;
    cancelAnimationFrame(rafId);
    lifetime.dispose();
    scheduler.clear();
    selection.dispose();
    rig.dispose();
    people.dispose();
    moduleHost.dispose();
    disposeAllCharts();
    dashboard.dispose();
    for (const label of app.labels) label.removeFromParent();
    app.labels.length = 0;
    disposeSceneGraph(scene);
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
    labelRenderer.domElement.remove();
    for (const id of ['tabs', 'left', 'views', 'timebar', 'info', 'toast']) byId(id).replaceChildren();
    for (const element of ui.topbarItems) element.remove();
    for (const id of ['info', 'legend', 'walkHelp', 'crosshair']) byId(id).classList.remove('show');
    sectionPlane.constant = 100;
    if ((window as any).app === app) delete (window as any).app;
  };
  (window as any).app = app;
  return app;
}

/** 释放场景里全部几何体、材质和贴图（包括共享材质；共享材质下次使用时会自动重新上传） */
function disposeSceneGraph(scene: THREE.Scene) {
  const textures = new Set<THREE.Texture>();
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material;
    for (const m of material ? (Array.isArray(material) ? material : [material]) : []) {
      for (const value of Object.values(m)) if (value instanceof THREE.Texture) textures.add(value);
      m.dispose();
    }
  });
  for (const t of [scene.environment, scene.background]) if (t instanceof THREE.Texture) textures.add(t);
  for (const texture of textures) texture.dispose();
  scene.clear();
}

/** 每 0.5 秒推进一次室内环境模拟 */
function stepEnvironment(app, dt) {
  const { openings, devices, people, clock, home } = app;
  const registry = devices.registry;
  const roomWindows: Record<string, boolean> = {};
  for (const w of openings.list(['window', 'slide'])) if (w.isOpen() && w.room) roomWindows[w.room] = true;
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
    sun: clock.sun, sunFactor: clock.sunFactor,
    windowsOpen: (id) => roomWindows[id] || (openPlan(id) && (roomWindows.living || roomWindows.dining)) || (id === 'hall2' && roomWindows.family),
    acOn: (id) => acByRoom[id]?.isOn() || (id === 'dining' && acByRoom.living?.isOn()),
    acSet: (id) => (acByRoom[id] ?? acByRoom.living)?.getSetpoint() ?? 26,
    curtainOpen: (id) => curtainByRoom[id],
    people: (id) => count[id] ?? 0,
    cooking: people.list.some((p) => p.activity.includes('做饭')),
    fresh: { on: ventilation?.isOn() ?? false, level: ventilation?.getLevel() ?? 0, rooms: ventRooms },
    shading: home.shadingOn,
    tvOn: home.tvOn,
  };
  const simDt = dt * (clock.playing ? Math.max(1, clock.speed / 20) : 1) * 6;
  app.envModel.step(simDt, ctx);
}

// ---------------- 界面 ----------------
/** 生成标签页、楼层切换、视点和时间栏，返回切换标签页的函数 */
function buildUI(app, tabs): { activate: (id: string) => void; topbarItems: HTMLElement[] } {
  const { clock } = app;
  const tabBox = byId('tabs');
  const left = byId('left');
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

  // 右上角：楼层切换 + 数据大屏
  const right = document.querySelector('#topbar .right')!;
  const floorBox = el('div', { class: 'floor-switch' });
  const floorBtns = ([['all', '整栋'], [0, '一层'], [1, '二层']] as [FloorView, string][]).map(([v, label]) => {
    const b = el('button', { onclick: () => app.viewFloor(v) }, label);
    b.dataset.v = String(v);
    floorBox.append(b);
    return b;
  });
  const syncView = () => floorBtns.forEach((b) => b.classList.toggle('on', b.dataset.v === String(app.view)));
  app.onViewChange(syncView);
  syncView();
  const previewLink = import.meta.env.DEV
    ? el('a', {
      class: 'module-preview-link',
      href: '/src/dev/module-preview.html',
      target: '_blank',
      rel: 'opener', // 预览页通过 window.opener 读取整屋运行时的实时模块
      title: '打开家具和设备的独立模块预览页',
    }, '🧩 原子模块预览')
    : null;
  const topbarItems: HTMLElement[] = [
    floorBox,
    ...(previewLink ? [previewLink] : []),
    el('button', { class: 'btn dash-btn', onclick: () => app.dashboard.toggle() }, '📊 数据大屏'),
  ];
  right.prepend(...topbarItems);

  // 视点按钮
  const views = byId('views');
  for (const v of VIEWPOINTS) views.append(el('button', { onclick: () => { app.rig.flyTo(v.pos, v.target); app.viewFloor(v.view); } }, v.name));
  const walkBtn = el('button', { class: 'walk', onclick: () => app.rig.setMode(app.rig.mode === 'walk' ? 'orbit' : 'walk') }, '第一人称漫游');
  views.append(walkBtn);
  app.rig.onModeChange = (m) => {
    walkBtn.textContent = m === 'walk' ? '退出漫游' : '第一人称漫游';
    byId('walkHelp').classList.toggle('show', m === 'walk');
    byId('crosshair').classList.toggle('show', m === 'walk');
    if (m === 'walk') { app.viewFloor('all'); toast('漫游模式：W/A/S/D 移动，鼠标拖动转向，走到楼梯可以上下楼，Esc 退出'); }
  };

  // 时间栏
  const tb = byId('timebar');
  const clockEl = el('span', { class: 'clock' });
  const sunEl = el('span', { class: 'sun' });
  const range = el('input', { type: 'range', min: 0, max: 23.99, step: 0.05 });
  range.addEventListener('input', () => clock.setTime(+range.value));
  const playBtn = el('button', { class: 'btn', onclick: () => clock.setPlaying(!clock.playing) });
  const speedSel = el('select', {}, ...[[60, '1 分钟/秒'], [300, '5 分钟/秒'], [1200, '20 分钟/秒']].map(([v, l]) => el('option', { value: v }, l)));
  speedSel.addEventListener('change', () => clock.setPlaying(clock.playing, +speedSel.value));
  const daySel = el('select', {}, ...[[172, '夏至（6月21日）'], [80, '春分（3月21日）'], [266, '秋分（9月23日）'], [355, '冬至（12月21日）']].map(([v, l]) => el('option', { value: v }, l)));
  daySel.addEventListener('change', () => clock.setDay(+daySel.value));
  const weatherSel = el('select', {}, ...Object.entries(WEATHER).map(([k, w]) => el('option', { value: k }, w.name)));
  weatherSel.addEventListener('change', () => clock.setWeather(weatherSel.value as Weather));
  tb.append(clockEl, range, playBtn, speedSel, daySel, weatherSel, sunEl);
  function syncTime() {
    clockEl.textContent = clock.format();
    if (document.activeElement !== range) range.value = clock.hour;
    playBtn.textContent = clock.playing ? '⏸ 暂停' : '▶ 播放';
    const s = clock.sun;
    sunEl.textContent = s.elevation > 0 ? `太阳高度角 ${s.elevation.toFixed(1)}°  方位 ${s.azimuth >= 0 ? '偏西' : '偏东'}${Math.abs(s.azimuth).toFixed(0)}°` : '夜间（太阳在地平线以下）';
    weatherSel.value = clock.weather;
    daySel.value = clock.day;
    speedSel.value = String(clock.speed);
  }
  clock.onTimeChanged(syncTime);

  app.selection.onSelect = (obj) => { for (const t of tabs) t.feature.onSelect?.(obj); };
  activate('overview');
  return { activate, topbarItems };
}

(window as any).startApp = startApp;
startApp().catch((e) => {
  console.error(e);
  const p = document.querySelector('#loading p');
  if (p) p.textContent = '加载失败：' + e.message + '（请使用最新版 Chrome 或 Edge，并确认已开启硬件加速）';
});
