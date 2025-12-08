import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Sets the base path to your repository name.
  // This ensures assets (images, scripts) load correctly at https://yitzhach.github.io/newTEST/
  base: '/newTEST/', 
});