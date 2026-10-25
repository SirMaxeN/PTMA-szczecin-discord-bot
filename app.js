import { runtime } from './src/runtime.js';
import { InteractionServer } from './src/http/InteractionServer.js';

const app = runtime();
const server = new InteractionServer(
  process.env.DISCORD_PUBLIC_KEY,
  process.env.DISCORD_APPLICATION_ID,
  app.commands,
);
await server.listen(Number(process.env.PORT || 3001));
console.log('Forum Bot HTTP server started.');
let timer;
function schedule() {
  const delay = 60000 - (Date.now() % 60000);
  timer = setTimeout(async () => {
    try {
      await app.monitor.hourly();
    } catch {
      console.error('Hourly forum check failed.');
    }
    schedule();
  }, delay);
  timer.unref();
}
schedule();
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, async () => {
    clearTimeout(timer);
    await server.close();
    app.database.close();
  });
