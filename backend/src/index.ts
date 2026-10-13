import { createApp } from './app';
import { env } from './env';
import { getPrismaForRole } from './lib/prismaByRole';
import { startAicsSchedule } from './services/aicsBridge';

const app = createApp();

app.listen(env.port, () => {
  console.log(`backend listening on port ${env.port} (${env.nodeEnv})`);
  startAicsSchedule(getPrismaForRole('admin'));
});
