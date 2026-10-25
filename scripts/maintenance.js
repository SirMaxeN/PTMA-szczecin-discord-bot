import { runtime } from '../src/runtime.js';
import { WorkerRestart } from './WorkerRestart.js';
WorkerRestart.runRequested();
const app = runtime();
try {
  await app.monitor.hourly();
} catch {
  console.error('Forum maintenance failed.');
  process.exitCode = 1;
} finally {
  app.database.close();
}
