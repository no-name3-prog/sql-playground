import 'dotenv/config';
import { createApp } from './app.js';
import { connectionService } from './services/connectionService.js';

const PORT = Number(process.env.PORT) || 3001;

async function main() {
  await connectionService.initSampleConnections();

  const app = createApp();
  app.listen(PORT, () => {
    console.log(`\n  SQL Playground API`);
    console.log(`  → http://localhost:${PORT}`);
    console.log(`  → health: http://localhost:${PORT}/api/health\n`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
