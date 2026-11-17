/** @type {import('jest').Config} */
const config = {
  testEnvironment: "jest-environment-jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": ["babel-jest", { presets: ["next/babel"] }],
  },
  moduleNameMapper: {
    "^server-only$": "<rootDir>/__tests__/__mocks__/serverOnlyMock.js",
    "^@/(.*)$": "<rootDir>/src/$1",
    "\\.(css|less|scss|sass)$": "<rootDir>/__tests__/__mocks__/styleMock.js",
    "\\.(jpg|jpeg|png|gif|svg|webp)$": "<rootDir>/__tests__/__mocks__/fileMock.js",
  },
  testMatch: ["<rootDir>/__tests__/**/*.test.{js,jsx}"],
  testPathIgnorePatterns: ["<rootDir>/.next/", "<rootDir>/node_modules/"],
  modulePathIgnorePatterns: ["<rootDir>/.next/"],
  collectCoverageFrom: [
    "src/app/utils/**/*.js",
    "src/app/api/**/*.js",
    "src/server/**/*.js",
    "src/lib/**/*.js",
    "src/components/**/*.{js,jsx}",
    "!src/server/db/pool.js",
    "!**/*.config.js",
  ],
};

module.exports = config;
