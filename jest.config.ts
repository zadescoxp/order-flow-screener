import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", {
      tsconfig: {
        paths: {
          "@/*": ["./*"],
        },
      },
    }],
  },
  testMatch: ["**/__tests__/**/*.test.ts"],
};

export default config;
