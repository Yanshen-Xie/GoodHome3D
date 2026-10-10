// 自动演示并截图：依次执行各功能，检查画面与报错，并记录帧率。
// 用法: node tools/tour.mjs <url> <输出目录> [步骤名过滤]
import { chromium } from 'playwright';
import fs from 'node:fs';

const [url = 'http://127.0.0.1:5188/', out = 'dev/tour', only = ''] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });

const fly = (p, t, v) => `app.viewFloor(${JSON.stringify(v)}); app.rig.flyTo(${JSON.stringify(p)}, ${JSON.stringify(t)}, 0.1)`;
const steps = [
  ['01_overview', `app.activateTab('overview')`, 1500],
  ['02_f1_labels', `app.features.overview.setLabels(true); ${fly([0, 24, 10], [0, 0, 0.5], 0)}`, 2500],
  ['03_f2_labels', `${fly([0, 27, 10], [0, 3.2, 0.5], 1)}`, 2500],
  ['04_living', `app.features.overview.setLabels(false); ${fly([-3.9, 2.3, 4.7], [-7.0, 0.8, 1.9], 'all')}`, 2500],
  ['05_kitchen', `${fly([5.0, 5.4, 6.6], [6.2, 0.8, 2.4], 0)}`, 2500],
  ['06_stair', `${fly([3.1, 5.0, 0.4], [0.9, 1.6, -3.2], 'all')}`, 2500],
  ['07_family', `${fly([2.4, 5.0, 4.4], [-2.6, 3.9, 2.4], 'all')}`, 2500],
  ['08_master', `${fly([-3.8, 8.4, 1.2], [-5.4, 3.8, -3.2], 1)}`, 2500],
  ['09_fire', `app.activateTab('safety'); app.features.safety.startFire()`, 5000],
  ['10_evac', `app.rig.flyTo([12, 16, 17], [1.5, 1.5, 0.5], 0.1)`, 7000],
  ['11_sos', `app.features.safety.resetFire(); app.features.safety.triggerSOS('sos-elder')`, 6000],
  ['12_fall', `app.features.safety.cancelSOS(); app.features.safety.triggerFall()`, 6000],
  ['13_intrusion', `app.features.safety.resolveFall(); app.setTime(22); app.features.safety.triggerIntrusion()`, 9000],
  ['14_comfort_sun', `app.features.safety.resetIntrusion(); app.activateTab('comfort'); app.setTime(15.5); ${fly([-3.9, 2.3, 4.7], [-7.0, 0.8, 1.9], 'all')}`, 2500],
  ['15_air', `app.features.comfort.scheme('B'); ${fly([0, 22, 13], [0, 0, 0], 0)}`, 3500],
  ['16_temp2', `const ac = app.devices.registry.getClimate('ac-master'); ac.setSetpoint(24); ac.setOn(true); app.features.layers.setHeatmap('temp', 1)`, 3500],
  ['17_sunchart', `app.features.layers.setHeatmap('none'); app.features.comfort.scheme('A'); app.features.comfort.runSunAnalysis(); document.getElementById('left').scrollTop = 300`, 2500],
  ['18_access', `app.features.comfort.runAccessibility(); document.getElementById('left').scrollTop = 99999`, 5000],
  ['19_green', `app.features.comfort.clearAccess(); app.activateTab('green'); app.setTime(12)`, 3500],
  ['20_rain', `app.features.green.setIrrigation(false); document.querySelectorAll('button').forEach(b => { if (b.textContent.includes('下雨集水演示')) b.click(); })`, 5000],
  ['21_irrigate', `app.setPlaying(false); app.setWeather('sunny'); app.setTime(16); app.features.green.setIrrigation(true); app.rig.flyTo([14, 6, 16], [6, 0, 6], 0.1)`, 3500],
  ['22_movie', `app.features.green.setIrrigation(false); app.outdoor.showTankSection(false); app.setTime(20); app.activateTab('smart'); app.features.smart.setMode('movie')`, 3500],
  ['23_sleep', `app.features.smart.setMode('sleep'); ${fly([0, 27, 10], [0, 3.2, 0.5], 1)}`, 3500],
  ['24_gas', `app.features.smart.setMode('auto'); app.setTime(10); app.features.smart.startGasLeak()`, 9000],
  ['25_leak', `app.features.smart.stopGasLeak(); app.features.smart.startLeak()`, 5000],
  ['26_twin', `app.features.smart.stopLeak(); app.features.smart.simulateFault()`, 3500],
  ['27_cut', `app.features.smart.repair(); app.features.smart.setTwin(false); app.activateTab('layers'); app.setCut(4.6); app.rig.flyTo([16, 14, 16], [0, 2, 0], 0.1)`, 2500],
  ['28_activity', `app.setCut(null); app.features.layers.setHeatmap('activity', 0)`, 3000],
  ['29_dashboard', `app.features.layers.setHeatmap('none'); app.activateTab('overview'); app.dashboard.toggle()`, 3500],
  ['30_walk_stairs', `app.dashboard.toggle(); app.rig.setMode('walk'); app.camera.position.set(0.1, 1.6, -1.0); app.rig.walk.yaw = 0; app.rig.applyWalkRotation(); app.rig.walk.keys.add('KeyW')`, 3000],
  ['31_walk_up2', `app.rig.walk.keys.delete('KeyW'); app.rig.walk.yaw = -Math.PI/2; app.rig.applyWalkRotation(); app.rig.walk.keys.add('KeyW')`, 1000],
  ['32_walk_up3', `app.rig.walk.keys.delete('KeyW'); app.rig.walk.yaw = Math.PI; app.rig.applyWalkRotation(); app.rig.walk.keys.add('KeyW')`, 3500],
  ['33_night', `app.rig.walk.keys.delete('KeyW'); app.rig.setMode('orbit'); app.setTime(19.6); app.features.smart.setMode('home'); ${fly([22, 8, 24], [0, 3, 0], 'all')}`, 4000],
  ['34_rainday', `app.setWeather('rainy'); app.setTime(14); ${fly([-18, 4, 16], [-4, 3, 0], 'all')}`, 3000],
];

const browser = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-features=Vulkan'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('willReadFrequently')) console.log('[console]', m.type(), m.text().slice(0, 200)); });
await page.goto(url);
await page.waitForFunction(() => window.app && !document.getElementById('loading'), null, { timeout: 90000 });
await page.waitForTimeout(2000);
for (const [name, code, wait] of steps) {
  if (only && !new RegExp(only).test(name)) continue; // 过滤条件是正则表达式，如 "night|twin"
  try { await page.evaluate(code); } catch (e) { console.log('[step error]', name, e.message); errors.push(name + ': ' + e.message); }
  await page.waitForTimeout(wait);
  const info = await page.evaluate(() => `fps ${app.fps.toFixed(0)} cam ${app.camera.position.toArray().map((v) => v.toFixed(1)).join(',')}`);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(name, info);
}
console.log('errors:', errors.length);
await browser.close();
