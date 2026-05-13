// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://valeriova96.github.io',
  integrations: [
    sitemap({
      filter: (page) => !page.includes('books_admin'),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
