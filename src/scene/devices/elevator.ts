import { ELEVATOR, FLOORS } from '../layout.js';
import type { DeviceAssemblyContext } from '../deviceAssemblyContext.js';
import { createHouseElevator } from './houseElevator.js';
import type { HouseElevatorConfig } from './houseElevator.js';

const HOUSE_ELEVATOR: HouseElevatorConfig = {
  kind: 'elevator',
  id: 'elevator',
  room: 'stair1',
  name: '家用电梯（无障碍）',
  position: [(ELEVATOR.x0 + ELEVATOR.x1) / 2, (ELEVATOR.z0 + ELEVATOR.z1) / 2],
  carWidth: ELEVATOR.x1 - ELEVATOR.x0,
  carDepth: ELEVATOR.z1 - ELEVATOR.z0,
  floors: FLOORS.map((floor) => ({ index: floor.id, y: floor.y, label: floor.name })),
  initialFloor: 0,
  travelSpeed: 0.6,
  doorSpeed: 1.2,
  floorOffset: 0.02,
  info: {
    category: '适老无障碍 / 安全',
    func: '载重 320kg，轿厢可容纳轮椅；配紧急呼叫、断电自动平层；火灾时停止使用，疏散走楼梯',
    maintain: '年检：2026-04 合格；下次维保 2026-10',
    data: { 年检: '合格' },
  },
};

/** House-specific placement only; elevator geometry and behavior live in its factory. */
export function buildElevatorDevice(context: DeviceAssemblyContext): void {
  const module = createHouseElevator(HOUSE_ELEVATOR);
  context.registerModule(module, { type: HOUSE_ELEVATOR.kind, room: HOUSE_ELEVATOR.room, floor: 0 });
}
