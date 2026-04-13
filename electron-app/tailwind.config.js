/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        void: {
          black: '#0a0a0f',
          dark: '#12121a',
          mid: '#1a1a2e',
          muted: '#2d2d44',
          dim: '#4a4a6a',
          text: '#9090b0',
          light: '#c0c0d0',
          white: '#e8e8f0',
        },
        neon: {
          cyan: '#00f5ff',
          'cyan-dim': '#00a5aa',
          magenta: '#ff00aa',
          'magenta-dim': '#aa0077',
          green: '#00ff88',
          'green-dim': '#00aa5c',
          yellow: '#ffee00',
          red: '#ff3366',
          purple: '#aa66ff',
        },
        glitch: {
          red: '#ff0040',
          blue: '#00bfff',
          green: '#00ff00',
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
        display: ['Orbitron', 'Rajdhani', 'sans-serif'],
        body: ['Inter', 'Rajdhani', 'sans-serif'],
      },
      animation: {
        'scanline': 'scanline 8s linear infinite',
        'flicker': 'flicker 0.15s infinite',
        'glitch': 'glitch 3s infinite',
        'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
        'float': 'float 6s ease-in-out infinite',
        'noise': 'noise 0.5s steps(10) infinite',
        'typing': 'typing 1.2s ease-in-out infinite',
        'border-flow': 'border-flow 3s linear infinite',
        'data-stream': 'data-stream 20s linear infinite',
        'warning-blink': 'warning-blink 0.5s ease-in-out infinite',
        'hacker-scroll': 'hacker-scroll 0.3s steps(5) infinite',
        'matrix-rain': 'matrix-rain 2s linear infinite',
        'hue-rotate': 'hue-rotate 8s linear infinite',
        'skew-shake': 'skew-shake 0.5s ease-in-out infinite',
      },
      keyframes: {
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        },
        flicker: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.8' },
          '25%, 75%': { opacity: '0.9' },
        },
        glitch: {
          '0%, 90%, 100%': { transform: 'translate(0)', filter: 'hue-rotate(0deg)' },
          '92%': { transform: 'translate(-2px, 1px)', filter: 'hue-rotate(90deg)' },
          '94%': { transform: 'translate(2px, -1px)', filter: 'hue-rotate(-90deg)' },
          '96%': { transform: 'translate(-1px, 2px)' },
          '98%': { transform: 'translate(1px, -2px)' },
        },
        'glow-pulse': {
          '0%, 100%': { 
            boxShadow: '0 0 5px currentColor, 0 0 10px currentColor, 0 0 20px currentColor',
            opacity: '1'
          },
          '50%': { 
            boxShadow: '0 0 10px currentColor, 0 0 20px currentColor, 0 0 40px currentColor',
            opacity: '0.9'
          },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        noise: {
          '0%, 100%': { transform: 'translate(0, 0)' },
          '10%': { transform: 'translate(-5%, -5%)' },
          '20%': { transform: 'translate(-10%, 5%)' },
          '30%': { transform: 'translate(5%, -10%)' },
          '40%': { transform: 'translate(-5%, 15%)' },
          '50%': { transform: 'translate(-10%, 5%)' },
          '60%': { transform: 'translate(15%, 0)' },
          '70%': { transform: 'translate(0, 10%)' },
          '80%': { transform: 'translate(-15%, 0)' },
          '90%': { transform: 'translate(10%, 5%)' },
        },
        'border-flow': {
          '0%': { backgroundPosition: '0% 50%' },
          '100%': { backgroundPosition: '200% 50%' },
        },
        'data-stream': {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
        'warning-blink': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.3' },
        },
        'hacker-scroll': {
          '0%': { transform: 'translateY(0)' },
          '100%': { transform: 'translateY(-100%)' },
        },
        'matrix-rain': {
          '0%': { transform: 'translateY(-100%)', opacity: '1' },
          '100%': { transform: 'translateY(100vh)', opacity: '0' },
        },
        'hue-rotate': {
          '0%': { filter: 'hue-rotate(0deg)' },
          '100%': { filter: 'hue-rotate(360deg)' },
        },
        'skew-shake': {
          '0%, 100%': { transform: 'skewX(0deg)' },
          '25%': { transform: 'skewX(-1deg)' },
          '75%': { transform: 'skewX(1deg)' },
        },
      },
      boxShadow: {
        'neon-cyan': '0 0 5px #00f5ff, 0 0 10px #00f5ff, 0 0 20px #00f5ff, 0 0 40px #00f5ff',
        'neon-magenta': '0 0 5px #ff00aa, 0 0 10px #ff00aa, 0 0 20px #ff00aa, 0 0 40px #ff00aa',
        'neon-green': '0 0 5px #00ff88, 0 0 10px #00ff88, 0 0 20px #00ff88',
        'neon-red': '0 0 5px #ff3366, 0 0 10px #ff3366, 0 0 20px #ff3366',
        'neon-purple': '0 0 5px #aa66ff, 0 0 10px #aa66ff, 0 0 20px #aa66ff',
        'neon-yellow': '0 0 5px #ffee00, 0 0 10px #ffee00, 0 0 20px #ffee00',
        'inner-glow': 'inset 0 0 30px rgba(0, 245, 255, 0.1)',
        'crt-glow': '0 0 100px rgba(0, 245, 255, 0.15)',
        'glow-sm': '0 0 10px currentColor',
        'glow-md': '0 0 15px currentColor, 0 0 30px currentColor',
        'glow-lg': '0 0 20px currentColor, 0 0 40px currentColor, 0 0 60px currentColor',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'grid-pattern': `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M 60 0 L 0 0 0 60' fill='none' stroke='rgba(0,245,255,0.08)' stroke-width='1'/%3E%3C/svg%3E")`,
        'noise': `url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
        'cyber-gradient': 'linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #0a0a0f 100%)',
        'neon-border': 'linear-gradient(90deg, transparent, #00f5ff, transparent)',
        'danger-gradient': 'linear-gradient(90deg, #ff3366, #ff00aa, #ff3366)',
        'hex-pattern': `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='49' viewBox='0 0 28 49'%3E%3Cg fill-rule='evenodd'%3E%3Cg fill='%2300f5ff' fill-opacity='0.03'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        'scanline-pattern': `repeating-linear-gradient(
          0deg,
          transparent,
          transparent 2px,
          rgba(0, 0, 0, 0.1) 2px,
          rgba(0, 0, 0, 0.1) 4px
        )`,
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
      },
    },
  },
  plugins: [],
}
