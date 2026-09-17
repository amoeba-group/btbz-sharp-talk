/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Mirrors the widget's scale so the custom-widget editor preview can be
      // written with the same class names it is previewing (FIX-260917). The
      // console itself is not themed — only the preview box sets these vars.
      borderRadius: {
        'st-sm': 'var(--ivy-radius-sm, 6px)',
        'st-md': 'var(--ivy-radius-md, 8px)',
        'st-lg': 'var(--ivy-radius-lg, 12px)',
        'st-xl': 'var(--ivy-radius-xl, 16px)',
      },
      colors: {
        primary: {
          50: '#EEF2FF',
          100: '#E0E7FF',
          200: '#C7D2FE',
          300: '#A5B4FC',
          400: '#818CF8',
          500: '#6366F1',
          600: '#4F46E5',
          700: '#4338CA',
          800: '#3730A3',
          900: '#312E81',
        },
        success: '#10B981',
        warning: '#F59E0B',
        error: '#EF4444',
        info: '#3B82F6',
        gray: {
          50: '#F9FAFB',
          100: '#F3F4F6',
          200: '#E5E7EB',
          300: '#D1D5DB',
          400: '#9CA3AF',
          500: '#6B7280',
          600: '#4B5563',
          700: '#374151',
          800: '#1F2937',
          900: '#111827',
        },
      },
      fontFamily: {
        sans: ['Pretendard', '-apple-system', 'BlinkMacSystemFont', "'Segoe UI'", 'Roboto', 'sans-serif'],
      },
      maxWidth: {
        content: '1440px',
      },
      spacing: {
        header: '64px',
        sidebar: '240px',
        'sidebar-collapsed': '64px',
      },
    },
  },
  plugins: [],
};
