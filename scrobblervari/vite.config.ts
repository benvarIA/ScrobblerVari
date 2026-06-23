import path from 'path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { apiPlugin } from './server/api'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      react(),
      tailwindcss(),
      basicSsl({
        domains: ['192.168.1.124', '192.168.0.98', '100.117.225.90'],
      }),
      apiPlugin(env),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      host: true,
      port: Number(env.PORT ?? 3006),
      https: true,
      watch: {
        ignored: ['**/data/**'],
      },
    },
  }
})
