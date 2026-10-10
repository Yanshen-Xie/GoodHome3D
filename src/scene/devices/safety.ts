import { INDOOR_ROOMS, ceilingMountSpot, wallMountSpot } from '../layout.js';
import type { DeviceAssemblyContext, DeviceFacing } from '../deviceAssemblyContext.js';
import type { HouseDeviceType } from '../deviceAssemblies.js';
import type { SceneModuleContract } from '../../modules/contracts.js';
import {
  createHouseCamera,
  createHouseDistributionPanel,
  createHouseEmergencyLight,
  createHouseEnvironmentSensor,
  createHouseExitSign,
  createHouseExtinguisher,
  createHouseFireBlanket,
  createHouseFloodlight,
  createHouseGateway,
  createHouseGasValve,
  createHouseGasDetector,
  createHouseIntercom,
  createHousePresenceSensor,
  createHouseSmartLock,
  createHouseSmokeSensor,
  createHouseSosButton,
  createHouseStrobe,
  createHouseWaterLeakSensor,
  createHouseWaterValve,
} from './houseSafetyDevices.js';
import type {
  HouseCameraConfig,
  HouseExitSignConfig,
  HouseFloodlightConfig,
  HouseGasValveConfig,
  HouseSafetyFactoryContext,
  HouseSmartLockConfig,
  HouseSosButtonConfig,
  HouseStrobeConfig,
  HouseWaterValveConfig,
} from './houseSafetyDevices.js';

export function buildSafetyDevices(context: DeviceAssemblyContext): void {
  const { assembly, registerModule } = context;
  const factoryContext: HouseSafetyFactoryContext = { lightPool: context.lightPool };
  const pose = (position: readonly [number, number, number], facing?: DeviceFacing) => ({
    position,
    ...(facing ? { rotation: [0, context.facing[facing], 0] as const } : {}),
  });
  const register = (module: SceneModuleContract, type: HouseDeviceType, room?: string | null, floor?: number) =>
    registerModule(module, { type, room, floor });

  // 房间坐标只在装配层决定；传感器工厂只负责一只传感器的模型、状态和接口。
  for (const room of INDOOR_ROOMS) {
    // 挂墙传感器：优先东墙、距北端 0.5 m、离地 1.5 m；该处是门窗洞口或没有墙时，顺延到最近的实墙
    const envSpot = wallMountSpot(room, 1.5);
    if (!envSpot) throw new Error('房间没有可安装环境传感器的实墙：' + room.id);
    // 吸顶传感器：优先西北角；落在楼梯洞、电梯井上方时换到其他角
    const ceilingSpot = ceilingMountSpot(room);
    if (!ceilingSpot) throw new Error('房间没有可安装人体存在传感器的天花板：' + room.id);
    const env = {
      kind: 'environmentSensor' as const,
      id: 'env-' + room.id,
      name: '温湿度 / PM2.5 传感器',
      room: room.id,
      floor: room.floor,
      pose: pose([envSpot.x, context.floorY(room.floor) + 1.5, envSpot.z], envSpot.facing),
      info: { category: '智慧 / 传感器', func: '每 10 秒上报温度、湿度、PM2.5、CO₂', data: {} },
    };
    register(createHouseEnvironmentSensor(env), 'envSensor', env.room, env.floor);

    const presence = {
      kind: 'presenceSensor' as const,
      id: 'presence-' + room.id,
      name: '毫米波人体存在传感器',
      room: room.id,
      floor: room.floor,
      pose: pose([ceilingSpot.x, context.ceilingY(room.floor) - 0.01, ceilingSpot.z]),
      info: {
        category: '智慧 / 传感器',
        func: '检测房间内是否有人、人的位置和姿态，用于灯光联动与跌倒检测（不拍摄图像，保护隐私）',
        data: { 检测结果: '无人' },
      },
    };
    register(createHousePresenceSensor(presence), 'presence', presence.room, presence.floor);
  }

  const smokeRooms = [
    ['elder', 0, -4.6, -2.2], ['living', 0, -2.0, 3.8], ['kitchen', 0, 4.4, 2.3],
    ['hall1', 0, -1.5, -0.2], ['dining', 0, 2.4, 1.3], ['utility', 0, 4.6, -2.2],
    ['stair2', 1, 2.6, -1.5], ['master', 1, -4.0, -2.0], ['kid', 1, 4.6, -2.2],
    ['study', 1, -4.6, 2.0], ['family', 1, 1.2, 1.6], ['guest', 1, 4.4, 1.8], ['hall2', 1, -1.5, -0.2],
  ] as const;
  for (const [room, floor, x, z] of smokeRooms) {
    const config = {
      kind: 'smokeSensor' as const,
      id: 'smoke-' + room,
      name: '光电感烟火灾探测器',
      room,
      floor,
      pose: pose([x, context.ceilingY(floor) - 0.045, z]),
      info: {
        category: '消防设施',
        func: '检测烟雾浓度，超限时本地声光报警并上报物业消防控制中心',
        maintain: '月度自检：2026-09 正常',
        data: { 烟雾浓度: '0.00 dB/m' },
      },
    };
    register(createHouseSmokeSensor(config), 'smoke', room, floor);
  }

  const gasDetector = {
    kind: 'gasDetector' as const,
    id: 'gas-detector',
    name: '可燃气体探测器',
    room: 'kitchen',
    floor: 0,
    pose: pose([7.88, 2.55, 1.05], '-x'),
    info: {
      category: '安全 / 智慧',
      func: '安装在燃气灶上方靠近天花板处（天然气比空气轻），浓度超标时联动关阀、开窗、启动排风',
      maintain: '标定：2026-03',
      data: { 甲烷浓度: '0 %LEL' },
    },
  };
  register(createHouseGasDetector(gasDetector), 'gasDetector', gasDetector.room, gasDetector.floor);

  const gasValve: HouseGasValveConfig = {
    kind: 'gasValve', id: 'gas-valve', name: '燃气管道 + 电动切断阀', room: 'kitchen', floor: 0,
    pose: pose([7.88, 0, 1.05], '-x'), initialOpen: true,
    info: {
      category: '安全 / 智慧',
      func: '检测到燃气泄漏或火灾时自动切断气源；可远程控制',
      maintain: '管道气密性检测：2026-04 合格',
      data: { 阀门: '开启', 管道压力: '2.0 kPa' },
    },
  };
  register(createHouseGasValve(gasValve), 'valve', gasValve.room, gasValve.floor);

  const extinguisher = (id: string, room: string, floor: number, position: readonly [number, number, number], name: string, func: string, maintain: string) => {
    const config = {
      kind: 'extinguisher' as const, id, room, floor, name, pose: { position },
      info: { category: '消防设施', func, maintain, data: { 压力: '1.2 MPa（绿区）' } },
    };
    register(createHouseExtinguisher(config), 'extinguisher', room, floor);
  };
  extinguisher('ext-kitchen', 'kitchen', 0, [3.45, context.floorY(0) + 0.02, 2.6], '干粉灭火器（2kg）', '可扑救初期固体、液体、气体火灾', '压力正常，有效期至 2029-06');
  extinguisher('ext-hall1', 'hall1', 0, [-7.75, context.floorY(0) + 0.02, 0.45], '干粉灭火器（4kg）', '玄关处配置，疏散时可就近取用', '有效期至 2029-06');
  extinguisher('ext-hall2', 'hall2', 1, [-7.75, context.floorY(1) + 0.02, 0.45], '干粉灭火器（4kg）', '二层走廊配置', '有效期至 2029-06');

  const fireBlanket = {
    kind: 'blanket' as const,
    id: 'fire-blanket',
    name: '灭火毯',
    room: 'kitchen',
    floor: 0,
    pose: pose([3.34, 1.3, 3.0], '+x'),
    info: { category: '消防设施', func: '覆盖油锅起火，隔绝空气灭火' },
  };
  register(createHouseFireBlanket(fireBlanket), 'blanket', fireBlanket.room, fireBlanket.floor);

  const strobes = [
    ['strobe-hall1', 'hall1', 0, -7.88, 2.4, 0.45],
    ['strobe-kitchen', 'kitchen', 0, 3.32, 2.4, 3.8],
    ['strobe-elder', 'elder', 0, -7.88, 2.4, -1.4],
    ['strobe-hall2', 'hall2', 1, -7.88, 2.4, 0.45],
  ] as const;
  for (const [id, room, floor, x, y, z] of strobes) {
    const config: HouseStrobeConfig = {
      kind: 'alarm', id, name: '壁挂式声光报警器', room, floor,
      pose: pose([x, context.floorY(floor) + y, z], '+x'),
      lightPosition: [0, 0, 0],
      info: {
        category: '消防设施',
        func: '火灾、燃气泄漏、入侵、一键呼叫时发出声光警报',
        maintain: '2026-09 测试正常',
      },
    };
    register(createHouseStrobe(config, factoryContext), 'strobe', room, floor);
  }

  const exitSigns: readonly HouseExitSignConfig[] = [
    { kind: 'exitSign', id: 'exit-入户门', name: '安全出口标志（入户门）', room: 'hall1', floor: 0, pose: pose([-7.88, context.floorY(0) + 2.45, -0.2], '+x'), textLines: ['安全出口', 'EXIT'], info: { category: '消防设施', func: '自带蓄电池，断电后持续点亮 ≥ 90 分钟', maintain: '2026-09 巡检正常' } },
    { kind: 'exitSign', id: 'exit-后门', name: '安全出口标志（后门）', room: 'hall1', floor: 0, pose: pose([7.88, context.floorY(0) + 2.45, -0.2], '-x'), textLines: ['安全出口', 'EXIT'], info: { category: '消防设施', func: '自带蓄电池，断电后持续点亮 ≥ 90 分钟', maintain: '2026-09 巡检正常' } },
    { kind: 'exitSign', id: 'exit-客厅落地门', name: '安全出口标志（客厅落地门）', room: 'hall1', floor: 0, pose: pose([-4.6, context.floorY(0) + 2.72, 4.88], '-z'), textLines: ['安全出口', 'EXIT'], info: { category: '消防设施', func: '自带蓄电池，断电后持续点亮 ≥ 90 分钟', maintain: '2026-09 巡检正常' } },
    { kind: 'exitSign', id: 'exit-二层楼梯', name: '安全出口标志（二层楼梯）', room: 'hall2', floor: 1, pose: pose([0.7, context.floorY(1) + 2.55, -0.88], '+z'), textLines: ['疏散楼梯 ↓', 'EXIT'], info: { category: '消防设施', func: '自带蓄电池，断电后持续点亮 ≥ 90 分钟', maintain: '2026-09 巡检正常' } },
  ];
  for (const config of exitSigns) register(createHouseExitSign(config), 'exitSign', config.room, config.floor);

  for (const [x, floor] of [[-6, 0], [0, 0], [5.5, 0], [-6, 1], [3, 1]] as const) {
    const config = {
      kind: 'emergencyLight' as const,
      id: `emergency-${floor}-${x}`,
      name: '应急照明灯',
      room: floor ? 'hall2' : 'hall1',
      floor,
      pose: pose([x, context.ceilingY(floor) - 0.1, -0.84]),
      info: { category: '消防设施', func: '火灾或停电时自动点亮，照亮疏散通道' },
    };
    register(createHouseEmergencyLight(config), 'emergency', config.room, floor);
  }

  const sosConfigs: readonly HouseSosButtonConfig[] = [
    { kind: 'sosButton', id: 'sos-elder', name: '一键呼叫按钮（老人房床头）', room: 'elder', floor: 0, pose: pose([-6.4, 0.85, -4.88], '+z'), info: { category: '安全 / 适老', func: '紧急情况下按下按钮或拉动拉绳（跌倒在地也能够到），立即向家属手机和物业值班终端发送求助信息', data: { 状态: '待机' } } },
    { kind: 'sosButton', id: 'sos-bath', name: '一键呼叫按钮（卫生间）', room: 'bath1', floor: 0, pose: pose([-3.08, 0.85, -2.45], '+x'), info: { category: '安全 / 适老', func: '紧急情况下按下按钮或拉动拉绳，立即向家属手机和物业值班终端发送求助信息', data: { 状态: '待机' } } },
  ];
  for (const config of sosConfigs) register(createHouseSosButton(config), 'sos', config.room, config.floor);

  const leakSensors = [
    ['leak-bath1', 'bath1', -1.4, -4.6, 0],
    ['leak-bath2', 'bath2', -1.0, -3.6, 1],
    ['leak-utility', 'utility', 4.6, -4.2, 0],
  ] as const;
  for (const [id, room, x, z, floor] of leakSensors) {
    const config = {
      kind: 'waterLeakSensor' as const, id, name: '水浸传感器', room, floor,
      pose: pose([x, context.floorY(floor) + 0.015, z]),
      info: { category: '安全 / 智慧', func: '检测地面积水，联动关闭进水总阀并推送提醒' },
    };
    register(createHouseWaterLeakSensor(config), 'leak', room, floor);
  }

  const waterValve: HouseWaterValveConfig = {
    kind: 'waterValve', id: 'water-valve', name: '自来水进水总阀（电动）', room: 'utility', floor: 0,
    pose: pose([3.52, 0, -4.0], '+x'), initialOpen: true,
    info: {
      category: '安全 / 智慧',
      func: '水浸传感器报警时自动关闭，防止漏水扩大',
      data: { 阀门: '开启', 今日用水: '0.42 m³' },
    },
  };
  register(createHouseWaterValve(waterValve), 'valve', waterValve.room, waterValve.floor);

  const panel = {
    kind: 'distributionPanel' as const, id: 'distribution', name: '智能配电箱', room: 'hall1', floor: 0,
    pose: pose([-5.9, 1.35, -0.9], '+z'),
    info: { category: '安全 / 绿色', func: '漏电保护、过载保护；分回路计量用电，数据接入能源管理系统', maintain: '绝缘测试：2026-07 合格', data: { 总电流: '—', 漏电流: '2 mA' } },
  };
  register(createHouseDistributionPanel(panel), 'distribution', panel.room, panel.floor);

  const gateway = {
    kind: 'gateway' as const, id: 'gateway', name: '家庭智能网关', room: 'hall1', floor: 0,
    pose: pose([-5.3, 1.5, -0.9], '+z'),
    info: { category: '智慧', func: '连接全屋传感器与设备（Zigbee / Wi-Fi），执行场景联动规则，上报物业平台', data: { 在线设备: '—' } },
  };
  register(createHouseGateway(gateway), 'gateway', gateway.room, gateway.floor);

  const intercom = {
    kind: 'intercom' as const, id: 'intercom', name: '可视对讲室内机', room: 'hall1', floor: 0,
    pose: pose([-7.88, 1.4, 0.48], '+x'),
    info: { category: '智慧 / 安防', func: '查看门口访客画面，远程开门' },
  };
  register(createHouseIntercom(intercom), 'intercom', intercom.room, intercom.floor);

  const lockConfig: HouseSmartLockConfig = {
    kind: 'smartLock', id: 'smart-lock', name: '智能门锁', room: 'hall1', floor: 0, initiallyLocked: true, doorId: 'door-entry',
    pose: { position: [0.85, 0.95, 0.045] },
    info: { category: '智慧 / 安防', func: '指纹 / 人脸 / 手机开锁；火灾时自动解锁便于疏散', data: { 状态: '已上锁', 电量: '86%' } },
  };
  register(createHouseSmartLock(lockConfig, { openings: assembly.openings }), 'lock', lockConfig.room, lockConfig.floor);

  const cameraConfigs: readonly HouseCameraConfig[] = [
    { kind: 'camera', id: 'camera', name: '门口摄像头', room: null, floor: 0, pose: pose([-8.14, 2.5, 1.1], '-x'), info: { category: '智慧 / 安防', func: 'AI 摄像头：离家模式下自动布防，识别人形入侵并推送提醒、联动灯光与声光报警', data: { 状态: '在线' } } },
    { kind: 'camera', id: 'camera-back', name: '后院摄像头', room: null, floor: 0, pose: pose([8.14, 2.6, -4.6], '+x'), yawOffset: 0.5, info: { category: '智慧 / 安防', func: 'AI 摄像头：离家模式下自动布防，识别人形入侵并推送提醒、联动灯光与声光报警', data: { 状态: '在线' } } },
  ];
  for (const config of cameraConfigs) register(createHouseCamera(config), 'camera', config.room, config.floor);

  const floodlight: HouseFloodlightConfig = {
    kind: 'floodlight', id: 'floodlight', name: '庭院感应投光灯', room: null, floor: 0,
    pose: { position: [0, 0, -3.8] },
    fixtures: [[8.12, 3.0, 0], [-8.12, 3.0, 0]],
    lightPosition: [9.5, 3.0, -1.7],
    info: { category: '安防照明', func: '夜间入侵时照亮庭院及建筑外墙', data: { 状态: '关闭' } },
  };
  register(createHouseFloodlight(floodlight, factoryContext), 'flood', floodlight.room, floodlight.floor);
}
