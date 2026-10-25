const { join } = require('node:path');
process.chdir(__dirname);
try {
  process.loadEnvFile(process.env.ENV_FILE || join(__dirname, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
import('./app.js').catch(() => {
  console.error('Forum bot startup failed.');
  process.exit(1);
});
