import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // VITE_* variables live in the repo-root .env shared with the API.
  envDir: '../..',
  server: {
    port: 8000,
    // The API's CORS allowlist (APP_ORIGIN) is pinned to this origin — fail
    // loudly rather than silently drifting to another port when taken.
    strictPort: true,
  },
});
