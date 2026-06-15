/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f4ff',
          100: '#dce6ff',
          500: '#4361ee',
          600: '#3451d1',
          700: '#2940b4',
          800: '#1e2e8f',
          900: '#131e6b',
        },
        brand: {
          DEFAULT: '#4361ee',
          dark: '#3451d1',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
