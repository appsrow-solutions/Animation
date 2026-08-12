import { defineConfig } from "astro/config";
import glsl from "vite-plugin-glsl";

export default defineConfig({
  vite: {
    plugins: [glsl()],
  },
});
