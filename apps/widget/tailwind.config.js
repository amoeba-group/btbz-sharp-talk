/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Corner radius is themed at RUNTIME the same way the palette is: the
      // tenant sets one value, the theme layer publishes a five-step scale,
      // and components name a step instead of a pixel size (FIX-260917).
      // The fallbacks are the values these steps replaced (Tailwind's bare
      // rounded and md/lg/xl/2xl), so an unthemed widget is unchanged.
      borderRadius: {
        'st-xs': 'var(--ivy-radius-xs, 4px)',
        'st-sm': 'var(--ivy-radius-sm, 6px)',
        'st-md': 'var(--ivy-radius-md, 8px)',
        'st-lg': 'var(--ivy-radius-lg, 12px)',
        'st-xl': 'var(--ivy-radius-xl, 16px)',
      },
      // Palette sampled pixel-by-pixel from the Figma "TalkTalk" Master Shots
      // frames (design/screens/34-69), not eyeballed — see PLN-260817 §2. The
      // ramp is indigo no longer: the design's action colour is a brighter blue
      // and every accent moved with it.
      colors: {
        // Themed at RUNTIME (PLN-260818): the stops resolve to CSS variables so
        // one shared bundle can render a different brand colour per tenant.
        // Channel triplets rather than hex — `bg-primary-500/10` and friends
        // need `<alpha-value>` to have something to substitute into.
        // Defaults live in index.css and are byte-identical to the values that
        // used to sit here, so an unthemed widget is unchanged.
        primary: {
          50: 'rgb(var(--ivy-primary-50) / <alpha-value>)',
          100: 'rgb(var(--ivy-primary-100) / <alpha-value>)',
          200: 'rgb(var(--ivy-primary-200) / <alpha-value>)',
          300: 'rgb(var(--ivy-primary-300) / <alpha-value>)',
          400: 'rgb(var(--ivy-primary-400) / <alpha-value>)',
          500: 'rgb(var(--ivy-primary-500) / <alpha-value>)',
          600: 'rgb(var(--ivy-primary-600) / <alpha-value>)',
          700: 'rgb(var(--ivy-primary-700) / <alpha-value>)',
          800: 'rgb(var(--ivy-primary-800) / <alpha-value>)',
          900: 'rgb(var(--ivy-primary-900) / <alpha-value>)',
        },
        /** Readable text on a primary fill — computed, never chosen (PLN §2.3). */
        'on-primary': 'rgb(var(--ivy-on-primary) / <alpha-value>)',
        /** Panel header, themable independently of the brand ramp. */
        header: {
          bg: 'rgb(var(--ivy-header-bg) / <alpha-value>)',
          fg: 'rgb(var(--ivy-header-fg) / <alpha-value>)',
          /**
           * Idle header icons. The dim is part of the design on the WHITE
           * header (ink at 60% is still ~11:1), but on a BRAND header the
           * foreground is already at its contrast floor and dimming it pushes
           * the icons under it — so the alpha is a variable the theme turns
           * off, not a fixed /60 in the class list.
           */
          dim: 'rgb(var(--ivy-header-fg) / var(--ivy-header-dim))',
        },
        success: '#00C950', // "Confirmed" badge (frame 34)
        warning: '#FF6900', // "In Transit" badge + in-progress copy (frame 49)
        error: '#FF385C', // tab count badge, unread dot (frame 34)
        info: '#3B82F6',
        /** "Review" badge — a status colour the old palette had no slot for. */
        review: '#AD46FF', // frame 57
        /**
         * Newest-unread notification row wash — warm, deliberately not a gray.
         * `icon` is the deeper tint the row's avatar circle takes so it does not
         * disappear into the row behind it (frame 34).
         */
        highlight: { DEFAULT: '#FEF9F3', icon: '#F5E6D3' },
        gray: {
          50: '#F9FAFB', // date-group band
          100: '#F3F4F6', // bot bubble, idle filter chip
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
        sans: [
          'Pretendard',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
      boxShadow: {
        lg: '0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
      },
    },
  },
  plugins: [],
};
