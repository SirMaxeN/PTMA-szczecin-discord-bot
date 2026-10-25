import { runtime } from '../src/runtime.js';
const app = runtime();
try {
  const result = await app.forum.scan(null);
  console.log(
    `Forum login and index check succeeded. Latest visible post ID: ${result.maxId}. No Discord messages sent.`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  app.database.close();
}
