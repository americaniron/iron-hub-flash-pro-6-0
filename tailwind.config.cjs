/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './{index,App}.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        cat: {
          yellow: '#ffcd00',
          black: '#000000',
          dark: '#111111',
          gray: '#1a1a1a',
          light: '#f4f4f4',
        },
      },
    },
  },
  plugins: [],
};
