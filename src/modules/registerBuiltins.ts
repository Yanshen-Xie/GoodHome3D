import type { ModuleCatalogContract } from './contracts';
import { MODULE_SERVICE } from './contracts';
import { externalModelDefinition } from './externalModel';
import { furnitureDefinitions } from '../furniture/layout';
import { deviceDefinitions } from '../scene/deviceCatalog';
import { houseElevatorDefinition } from '../scene/devices/houseElevator';
import { houseGreenDeviceDefinitions } from '../scene/devices/houseGreenDevices';
import { houseSafetyDeviceDefinitions } from '../scene/devices/houseSafetyDevices';
import { houseFloorLampDefinition } from '../scene/devices/houseFloorLamp';
import { houseLightDefinition } from '../scene/devices/houseLight';
import { houseNightLightDefinition } from '../scene/devices/houseNightLight';
import { houseTelevisionDefinition } from '../scene/devices/houseTelevision';
import { houseAirConditionerDefinition } from '../scene/devices/houseAirConditioner';
import { houseCurtainDefinition } from '../scene/devices/houseCurtain';
import { houseFreshAirDefinition } from '../scene/devices/houseFreshAir';
import { FLOOR_H } from '../scene/layout.js';
import type { DeviceFacing } from '../scene/deviceAssemblyContext.js';
import type { ModuleFactoryContext, SceneModuleDefinition } from './contracts';
import type { LightPool } from '../systems/lightPool.js';
import type { HouseAirConditionerConfig, HouseAirConditionerFactoryContext } from '../scene/devices/houseAirConditioner';
import type { HouseCurtainConfig, HouseCurtainFactoryContext } from '../scene/devices/houseCurtain';
import type { HouseFreshAirConfig, HouseFreshAirFactoryContext } from '../scene/devices/houseFreshAir';
import type { HouseLightConfig, HouseLightFactoryContext } from '../scene/devices/houseLight';

/** Register the same independently creatable module definitions in the app and inspector. */
export function registerBuiltInSceneModules(catalog: ModuleCatalogContract): void {
  catalog.register(externalModelDefinition());
  for (const definition of furnitureDefinitions()) catalog.register(definition);
  for (const definition of deviceDefinitions()) catalog.register(definition);
  for (const definition of houseComfortDefinitions()) catalog.register(definition);
  for (const definition of houseSafetyDeviceDefinitions()) catalog.register(definition);
  catalog.register(houseElevatorDefinition());
  for (const definition of houseGreenDeviceDefinitions()) catalog.register(definition);
}

const HOUSE_FACING: Readonly<Record<DeviceFacing, number>> = {
  '+x': Math.PI / 2,
  '-x': -Math.PI / 2,
  '+z': 0,
  '-z': Math.PI,
};

function service<T>(context: ModuleFactoryContext, id: string): T | undefined {
  return context.services?.get(id) as T | undefined;
}

function floorY(context: ModuleFactoryContext): (floor: number) => number {
  return service<(floor: number) => number>(context, MODULE_SERVICE.floorY) ?? ((floor) => floor * FLOOR_H);
}

function ceilingY(context: ModuleFactoryContext): (floor: number) => number {
  return service<(floor: number) => number>(context, MODULE_SERVICE.ceilingY)
    ?? ((floor) => floorY(context)(floor) + FLOOR_H - 0.2);
}

/** Actual house-device factories resolve only the narrow services each module needs. */
function houseComfortDefinitions(): SceneModuleDefinition<any>[] {
  const definition = <TConfig>(id: string, create: SceneModuleDefinition<TConfig>['create']): SceneModuleDefinition<TConfig> => ({
    id,
    kind: 'device',
    create,
  });

  return [
    definition<HouseLightConfig>('house-light', (context, config) => {
      const lightPool = service<LightPool>(context, MODULE_SERVICE.lightPool);
      if (!lightPool) throw new Error('house-light requires the scene.lightPool factory service');
      const factoryContext: HouseLightFactoryContext = { lightPool, ceilingY: ceilingY(context) };
      return houseLightDefinition(factoryContext).create(context, config);
    }),
    definition<HouseAirConditionerConfig>('house-air-conditioner', (context, config) => {
      const factoryContext: HouseAirConditionerFactoryContext = { floorY: floorY(context), facing: HOUSE_FACING };
      return houseAirConditionerDefinition(factoryContext).create(context, config);
    }),
    definition<HouseCurtainConfig>('house-curtain', (context, config) => {
      const factoryContext: HouseCurtainFactoryContext = { floorY: floorY(context) };
      return houseCurtainDefinition(factoryContext).create(context, config);
    }),
    definition<HouseFreshAirConfig>('house-fresh-air', (context, config) => {
      const factoryContext: HouseFreshAirFactoryContext = { ceilingY: ceilingY(context) };
      return houseFreshAirDefinition(factoryContext).create(context, config);
    }),
    houseFloorLampDefinition(),
    houseNightLightDefinition(),
    houseTelevisionDefinition(),
  ];
}
