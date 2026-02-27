import type { KnipConfig } from "knip";

const config: KnipConfig = {
  project: ["src/**/*.{ts,tsx}"],
  ignoreDependencies: ["lint-staged"],
};

export default config;
