import { close } from './index.js';
import { logger } from '../logger.js';
import { runPendingMigrations } from './migrate-runner.js';

runPendingMigrations()
  .then(() => close())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'migrate error');
    close().finally(() => process.exit(1));
  });
