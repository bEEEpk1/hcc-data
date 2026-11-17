import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const backend = env.HCC_DATA_PROXY_TARGET || 'http://127.0.0.1:8090';
  const proxy = Object.fromEntries(['/api', '/actuator'].map(path => [path, { target: backend }]));
  return { server: { host: '127.0.0.1', strictPort: true, proxy }, preview: { proxy } };
});
