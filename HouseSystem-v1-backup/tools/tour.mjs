// 自动演示并截图：依次执行各功能，检查画面与报错，并记录帧率。
// 用法: node tools/tour.mjs <url> <输出目录> [步骤名过滤]
import { chromium } from 'playwright';
import fs from 'node:fs';

const [url = 'http://127.0.0.1:5188/', out = 'dev/tour', only = ''] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });

// 每一步：名称、在页面中执行的代码、等待毫秒数
const steps = [
  ['01_overview', `app.activateTab('overview')`, 1500],
  ['02_top_labels', `app.features.overview.setLabels(true); app.setRoof(false); app.rig.flyTo([0,26,9],[0,0,0.5],0.1)`, 2500],
  ['03_living_view', `app.features.overview.setLabels(false); app.rig.flyTo([-3.9,2.3,4.7],[-7.0,0.7,1.9],0.1)`, 2500],
  ['04_kitchen_view', `app.rig.flyTo([5.0,5.4,6.6],[6.2,0.8,2.4],0.1)`, 2500],
  ['05_bedroom_view', `app.rig.flyTo([-3.6,2.5,-1.4],[-6.0,0.8,-3.8],0.1)`, 2500],
  ['06_safety_fire', `app.activateTab('safety'); app.features.safety.startFire()`, 5000],
  ['07_safety_evac', `app.rig.flyTo([0,20,11],[0,0,0.5],0.1)`, 6000],
  ['08_safety_reset_sos', `app.features.safety.resetFire(); app.features.safety.triggerSOS('sos-elder')`, 4000],
  ['09_safety_inspect', `app.features.safety.cancelSOS(); app.features.safety.inspect()`, 3000],
  ['10_comfort_sun', `app.activateTab('comfort'); app.setTime(15.5); app.setRoof(true); app.rig.flyTo([-3.9,2.3,4.7],[-7.0,0.7,1.9],0.1)`, 2500],
  ['11_comfort_air', `app.features.comfort.scheme('B'); app.setRoof(false); app.rig.flyTo([0,18,12],[0,0,0],0.1)`, 3500],
  ['12_comfort_temp', `app.devices.byId['ac-living'].set(true,24); app.features.layers.setHeatmap('temp'); app.rig.flyTo([0,24,10],[0,0,0.5],0.1)`, 3500],
  ['13_comfort_sunchart', `app.features.layers.setHeatmap('none'); app.features.comfort.scheme('A'); app.features.comfort.runSunAnalysis(); document.getElementById('left').scrollTop = 300`, 2000],
  ['14_comfort_access', `app.features.comfort.runAccessibility(); document.getElementById('left').scrollTop = 99999`, 4000],
  ['15_green', `app.features.comfort.clearAccess(); app.activateTab('green'); app.setTime(12)`, 3500],
  ['16_green_night', `app.setTime(21); document.getElementById('left').scrollTop = 99999`, 3000],
  ['17_smart_movie', `app.setTime(20); app.activateTab('smart'); app.features.smart.setMode('movie')`, 3500],
  ['18_smart_sleep', `app.features.smart.setMode('sleep'); app.setRoof(false); app.rig.flyTo([0,20,11],[0,0,0],0.1)`, 3500],
  ['19_smart_gas', `app.features.smart.setMode('auto'); app.setTime(10); app.features.smart.startGasLeak()`, 9000],
  ['20_smart_twin', `app.features.smart.stopGasLeak(); app.features.smart.simulateFault()`, 3500],
  ['21_layers_cut', `app.features.smart.repair(); app.activateTab('layers'); app.features.layers.setCut(1.2); app.rig.flyTo([6,16,14],[0,0,0],0.1)`, 2500],
  ['22_layers_activity', `app.features.layers.setCut(3.4); app.features.layers.setHeatmap('activity'); app.rig.flyTo([0,24,10],[0,0,0.5],0.1)`, 3000],
  ['23_walk', `app.features.layers.setHeatmap('none'); app.activateTab('overview'); app.rig.setMode('walk')`, 2500],
  ['24_night_exterior', `app.rig.setMode('orbit'); app.setTime(19.6); app.setRoof(true); app.features.smart.setMode('home'); app.rig.flyTo([20,8,22],[0,1.5,0],0.1)`, 3500],
  ['25_rain', `app.clock.weather='rainy'; app.setTime(14); app.rig.flyTo([-16,4,14],[-4,1.5,0],0.1)`, 3000],
];

const browser = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-features=Vulkan'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text().slice(0, 200)); });
await page.goto(url);
await page.waitForFunction(() => window.app && !document.getElementById('loading'), null, { timeout: 60000 });
await page.waitForTimeout(2000);
for (const [name, code, wait] of steps) {
  if (only && !name.includes(only)) continue;
  try { await page.evaluate(code); } catch (e) { console.log('[step error]', name, e.message); errors.push(name + ': ' + e.message); }
  await page.waitForTimeout(wait);
  const fps = await page.evaluate(() => app.fps.toFixed(1));
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(name, 'fps', fps);
}
console.log('errors:', errors.length);
await browser.close();
