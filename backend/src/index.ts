import { createApp } from './app';
import { env } from './env';

const app = createApp();

app.listen(env.port, () => {
  console.log(`backend listening on port ${env.port} (${env.nodeEnv})`);
});
