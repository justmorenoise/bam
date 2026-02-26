/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts}",
  ],
  theme: {
    extend: {
      colors: {
        // Bam Brand Colors - New Modern Style
        'bam-primary': '#ea580c', // Orange-600
        'bam-secondary': '#fb923c', // Orange-400
        'bam-accent': '#3b82f6', // Blue-500
        'bam-success': '#10b981', // Green
        'bam-warning': '#f59e0b', // Amber
        'bam-error': '#ef4444', // Red
        'bam-dark': '#020617', // Slate-950
        'bam-light': '#f8fafc', // Slate
      },
      fontFamily: {
        'sans': ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce-slow': 'bounce 2s infinite',
      },
      boxShadow: {
        'bam': '0 4px 6px -1px rgba(99, 102, 241, 0.1), 0 2px 4px -1px rgba(99, 102, 241, 0.06)',
        'bam-lg': '0 10px 15px -3px rgba(99, 102, 241, 0.1), 0 4px 6px -2px rgba(99, 102, 241, 0.05)',
      },
    },
  },
  plugins: [],
}
