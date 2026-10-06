// 交互测试：用真实的鼠标点击 / 键盘操作检查 选择物体、信息卡片、设备控制、漫游移动、时间滑块。
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:5188/';
const browser = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-features=Vulkan'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url);
await page.waitForFunction(() => window.app && !document.getElementById('loading'), null, { timeout: 60000 });
await page.waitForTimeout(1500);
const ok = (name, cond) => console.log(cond ? 'PASS' : 'FAIL', name);

// 1. 点击场景中的客厅空调：先把镜头对准它，再把它的屏幕坐标算出来并点击
await page.evaluate(() => { app.setRoof(false); app.rig.flyTo([-3.9, 2.3, 4.7], [-7.0, 1.5, 2.6], 0.05); });
await page.waitForTimeout(800);
const pos = await page.evaluate(() => {
  const o = app.devices.byId['ac-living'].object;
  const v = o.getWorldPosition(new app.camera.position.constructor()).add({ x: 0.1, y: 0.12, z: 0 }).project(app.camera);
  return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
});
await page.mouse.click(pos.x, pos.y);
await page.waitForTimeout(500);
const title = await page.textContent('#info h2').catch(() => null);
ok('点击空调弹出信息卡片（' + title + '）', title === '客厅空调');
// 2. 在信息卡片里打开空调
await page.click('#info .switch span');
await page.waitForTimeout(300);
ok('信息卡片开关控制空调', await page.evaluate(() => app.devices.byId['ac-living'].on));
await page.screenshot({ path: 'dev/interact_info.png' });
// 3. 顶部标签页切换
await page.click('#tabs button:has-text("智慧便捷")');
await page.waitForTimeout(300);
ok('切换到智慧便捷页', await page.evaluate(() => app.activeTab === 'smart'));
await page.click('button:has-text("观影")');
await page.waitForTimeout(500);
ok('观影模式：电视开启、客厅灯调暗', await page.evaluate(() => app.features.smart.tvOn && app.devices.byId['light-living'].level < 0.3));
// 4. 设备列表点击
await page.click('.dev-item[data-id="light-kid"]');
await page.waitForTimeout(400);
ok('设备列表点击选中儿童房灯', (await page.textContent('#info h2')) === '儿童房吸顶灯');
// 5. 时间滑块
const slider = await page.$('#timebar input[type=range]');
const box = await slider.boundingBox();
await page.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2);
await page.waitForTimeout(300);
ok('时间滑块改到晚上（' + (await page.evaluate(() => app.clock.hour.toFixed(1))) + ' 时）', await page.evaluate(() => app.clock.hour > 20));
// 6. 漫游：按 W 前进 1 秒
await page.click('#views button.walk');
await page.waitForTimeout(300);
const p0 = await page.evaluate(() => app.camera.position.x);
await page.keyboard.down('KeyW');
await page.waitForTimeout(1000);
await page.keyboard.up('KeyW');
const p1 = await page.evaluate(() => app.camera.position.x);
ok(`漫游 W 前进（x: ${p0.toFixed(2)} → ${p1.toFixed(2)}）`, p1 - p0 > 1);
// 7. 漫游碰撞：一直向北走，应被墙挡住（走廊北墙 z=-1）
await page.evaluate(() => { app.rig.walk.yaw = 0; app.rig.applyWalkRotation(); });
await page.keyboard.down('KeyW');
await page.waitForTimeout(2500);
await page.keyboard.up('KeyW');
const z = await page.evaluate(() => app.camera.position.z);
ok(`漫游碰撞：被北墙挡住（z = ${z.toFixed(2)}，应 > -0.9）`, z > -0.9);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
ok('Esc 退出漫游', await page.evaluate(() => app.rig.mode === 'orbit'));
// 8. 双击聚焦
ok('无页面错误', errors.length === 0);
if (errors.length) console.log(errors);
await browser.close();
