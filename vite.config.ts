import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import assemblyScriptPlugin from 'vite-plugin-assemblyscript-asc'

export default defineConfig({
  assetsInclude: ["**/*.ch8"],
  plugins: [
    {
    ...assemblyScriptPlugin({
      projectRoot: 'src/chip8-wasm',
    }),
      enforce: 'pre'
    },
    solidPlugin(),
  ],
  server: {
    port: 3000,
  },
  build: {
    target: 'esnext',
  },
});
