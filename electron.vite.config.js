import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index:               'src/preload/index.js',
          'idle-popup-preload':'src/preload/idle-popup-preload.js',
        },
      },
    },
  },
  renderer: {
    plugins: [react()],
  },
})
