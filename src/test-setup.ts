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

// jsdom does not implement native dialog methods; the browser handles modal focus.
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};
