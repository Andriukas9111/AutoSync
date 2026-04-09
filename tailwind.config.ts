import type { Config } from "tailwindcss";

export default {
  content: [
    // ONLY the landing page — never scan admin/Polaris routes
    "./app/routes/_index/**/*.{ts,tsx}",
  ],
  prefix: "tw-", // Prevents ALL collisions with Shopify Polaris
  theme: {
    extend: {
      colors: {
        lavender: { DEFAULT: "#EEE8FF", mid: "#F5F0FF" },
        ink: "#0F172A",
        void: "#020617",
        carbon: "#334155",
        slate: "#64748B",
        silver: "#E2E5E9",
        snow: "#F8F8FA",
        ghost: "#F1F3F5",
        accent: {
          DEFAULT: "#0099FF",
          deep: "#0077CC",
          soft: "rgba(0,153,255,0.06)",
          glow: "rgba(0,153,255,0.12)",
        },
        purple: "#6B52D9",
      },
      fontFamily: {
        heading: ['"DM Sans"', "sans-serif"],
        body: ['"Inter"', "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
      borderRadius: {
        pill: "999px",
        card: "24px",
      },
      boxShadow: {
        sm: "0 1px 3px rgba(0,0,0,0.05)",
        md: "0 4px 16px rgba(0,0,0,0.06)",
        lg: "0 20px 50px rgba(0,0,0,0.08)",
        xl: "0 32px 64px rgba(0,0,0,0.1)",
        glow: "0 0 40px rgba(0,153,255,0.12)",
      },
      animation: {
        marquee: "marquee 25s linear infinite",
        "fade-in": "fadeIn 0.6s ease-out forwards",
        "slide-up": "slideUp 0.6s cubic-bezier(0.16,1,0.3,1) forwards",
        pulse: "pulse 2s ease-in-out infinite",
      },
      keyframes: {
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        fadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        slideUp: {
          from: { opacity: "0", transform: "translateY(20px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        pulse: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
