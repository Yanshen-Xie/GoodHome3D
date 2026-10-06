import type { ModuleCatalogContract } from './contracts';
import { externalModelDefinition } from './externalModel';
import { furnitureDefinitions } from '../furniture/layout';
import { deviceDefinitions } from '../scene/deviceCatalog';

/** Register the same independently creatable module definitions in the app and inspector. */
export function registerBuiltInSceneModules(catalog: ModuleCatalogContract): void {
  catalog.register(externalModelDefinition());
  for (const definition of furnitureDefinitions()) catalog.register(definition);
  for (const definition of deviceDefinitions()) catalog.register(definition);
}
