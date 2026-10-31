/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'map-land': '#d9d4c9',
        'map-ocean': '#b0c7d6',
        'own-boat': '#ff6a00',
      },
    },
  },
  plugins: [],
};
