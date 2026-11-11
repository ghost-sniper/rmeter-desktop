import "@testing-library/jest-dom/vitest";
import type {} from "vitest/jsdom";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
// Node 26 exposes its own localStorage; use the browser environment's storage.
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: jsdom.window.localStorage,
});
afterEach(cleanup);
