import { createHandler } from './api/handler';
import { SitesRepository } from './store/sites';

export function createSiteHandler(database: ConstructorParameters<typeof SitesRepository>[0], origin: string) {
  return createHandler({ repository: new SitesRepository(database), origin });
}
