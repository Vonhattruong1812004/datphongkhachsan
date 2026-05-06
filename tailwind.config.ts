import type { Config } from "tailwindcss";

export default {
  content: [
    "./frontend/**/*.{ts,tsx}",
    "./src/views/**/*.ejs"
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          ink: "#07111f",
          cyan: "#38bdf8",
          mint: "#34d399",
          sand: "#f4d9a3"
        }
      },
      boxShadow: {
        glow: "0 18px 60px rgba(8, 47, 73, 0.25)"
      }
    }
  },
  plugins: []
} satisfies Config;
