// 交互测试：用真实的鼠标点击 / 键盘操作检查 选择物体、信息卡片、设备控制、楼层切换、漫游上楼、数据大屏。
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:5188/';
const browser = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-features=Vulkan'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url);
await page.waitForFunction(() => window.app && !document.getElementById('loading'), null, { timeout: 90000 });
await page.waitForTimeout(1500);
let pass = 0, fail = 0;
const ok = (name, cond) => { console.log(cond ? 'PASS' : 'FAIL', name); cond ? pass++ : fail++; };
const screenPos = (id) => page.evaluate((id) => {
  const o = app.devices.byId[id].object;
  const v = o.getWorldPosition(new app.camera.position.constructor()).add({ x: 0.1, y: 0.12, z: 0 }).project(app.camera);
  return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
}, id);

// 1. 点击场景中的客厅空调，弹出信息卡片并控制
await page.evaluate(() => { app.viewFloor('all'); app.rig.flyTo([-3.9, 2.3, 4.7], [-7.0, 1.6, 2.8], 0.05); });
await page.waitForTimeout(800);
let pos = await screenPos('ac-living');
await page.mouse.click(pos.x, pos.y);
await page.waitForTimeout(500);
let title = await page.textContent('#info h2').catch(() => null);
ok('点击空调弹出信息卡片（' + title + '）', title === '客厅空调');
await page.click('#info .switch span');
await page.waitForTimeout(300);
ok('信息卡片开关控制空调', await page.evaluate(() => app.devices.byId['ac-living'].on));
// 2. 楼层切换按钮
await page.click('.floor-switch button:has-text("一层")');
await page.waitForTimeout(300);
ok('楼层切换：只看一层（剖切高度 ' + (await page.evaluate(() => app.CUT[app.view])) + '）', await page.evaluate(() => app.view === 0));
await page.click('.floor-switch button:has-text("二层")');
ok('楼层切换：二层', await page.evaluate(() => app.view === 1));
await page.click('.floor-switch button:has-text("整栋")');
// 3. 点击电梯并呼叫到 2 层
await page.evaluate(() => { app.rig.flyTo([3.1, 5.0, 0.4], [2.75, 1.2, -4.0], 0.05); });
await page.waitForTimeout(800);
await page.evaluate(() => app.selection.selectDevice('elevator', false));
await page.waitForTimeout(300);
await page.click('#info button:has-text("呼叫到 2 层")');
await page.waitForTimeout(9000);
ok('电梯呼叫到 2 层（当前高度 ' + (await page.evaluate(() => app.devices.elevator.y.toFixed(2))) + ' m）', await page.evaluate(() => Math.abs(app.devices.elevator.y - 3.2) < 0.01));
// 4. 标签页 + 场景模式
await page.click('#tabs button:has-text("智慧便捷")');
await page.click('button:has-text("观影")');
await page.waitForTimeout(500);
ok('观影模式：电视开启、客厅灯调暗', await page.evaluate(() => app.features.smart.tvOn && app.devices.byId['light-living'].level < 0.3));
await page.click('.dev-item[data-id="light-kid"]');
await page.waitForTimeout(400);
ok('设备列表点击选中儿童房灯', (await page.textContent('#info h2')) === '儿童房吸顶灯');
// 5. 数据大屏
await page.click('button:has-text("数据大屏")');
await page.waitForTimeout(1500);
ok('数据大屏打开并绘制图表', await page.evaluate(() => app.dashboard.visible && document.querySelectorAll('#dash canvas').length >= 6));
await page.click('.dash-btn');
// 6. 时间滑块
const slider = await page.$('#timebar input[type=range]');
const box = await slider.boundingBox();
await page.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2);
ok('时间滑块改到晚上（' + (await page.evaluate(() => app.clock.hour.toFixed(1))) + ' 时）', await page.evaluate(() => app.clock.hour > 20));
// 7. 漫游：前进、碰撞、走楼梯上二楼
await page.click('#views button.walk');
await page.waitForTimeout(300);
const p0 = await page.evaluate(() => app.camera.position.x);
await page.keyboard.down('KeyW'); await page.waitForTimeout(1000); await page.keyboard.up('KeyW');
const p1 = await page.evaluate(() => app.camera.position.x);
ok(`漫游 W 前进（x: ${p0.toFixed(2)} → ${p1.toFixed(2)}）`, p1 - p0 > 1);
await page.evaluate(() => { app.rig.walk.yaw = 0; app.rig.applyWalkRotation(); });
await page.keyboard.down('KeyW'); await page.waitForTimeout(2500); await page.keyboard.up('KeyW');
const z = await page.evaluate(() => app.camera.position.z);
ok(`漫游碰撞：被北墙挡住（z = ${z.toFixed(2)}）`, z > -0.9);
await page.evaluate(() => { app.camera.position.set(0.1, 1.6, -1.0); app.rig.walk.ground = 0; app.rig.walk.yaw = 0; app.rig.applyWalkRotation(); });
await page.keyboard.down('KeyW'); await page.waitForTimeout(2600); await page.keyboard.up('KeyW');
await page.evaluate(() => { app.rig.walk.yaw = -Math.PI / 2; app.rig.applyWalkRotation(); });
await page.keyboard.down('KeyW'); await page.waitForTimeout(900); await page.keyboard.up('KeyW');
await page.evaluate(() => { app.rig.walk.yaw = Math.PI; app.rig.applyWalkRotation(); });
await page.keyboard.down('KeyW'); await page.waitForTimeout(2800); await page.keyboard.up('KeyW');
await page.waitForTimeout(400);
const y = await page.evaluate(() => app.rig.walk.ground);
ok(`漫游沿楼梯走上二楼（脚下高度 ${y.toFixed(2)} m）`, Math.abs(y - 3.2) < 0.01);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
ok('Esc 退出漫游', await page.evaluate(() => app.rig.mode === 'orbit'));
// 8. 人物能上下楼：让妈妈走到二楼儿童房
const up = await page.evaluate(() => { const m = app.people.mom; m.mode = 'stop'; m.path = []; m.setPosition(-6.0, 2.0, 0); return m.goTo(6.0, -3.0, { floor: 1 }); });
await page.waitForTimeout(25000);
ok('人物从一层客厅沿楼梯走到二楼儿童房（规划成功 ' + up + '，楼层 ' + (await page.evaluate(() => app.people.mom.floor)) + '，房间 ' + (await page.evaluate(() => app.people.mom.room)) + '）', up && await page.evaluate(() => app.people.mom.floor === 1 && app.people.mom.room === 'kid'));
ok('无页面错误', errors.length === 0);
if (errors.length) console.log(errors);
console.log(`结果：${pass} 项通过，${fail} 项失败`);
await browser.close();
