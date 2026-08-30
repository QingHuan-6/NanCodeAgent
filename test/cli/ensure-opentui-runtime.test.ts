import { describe, expect, it } from "vitest";
import {
  hasExperimentalFfiFlag,
  nodeSupportsOpenTuiFfi,
} from "../../src/cli/ensure-opentui-runtime.js";

describe("nodeSupportsOpenTuiFfi", () => {
  it("accepts Node 26.4+", () => {
    expect(nodeSupportsOpenTuiFfi("26.4.0")).toBe(true);
    expect(nodeSupportsOpenTuiFfi("26.5.1")).toBe(true);
    expect(nodeSupportsOpenTuiFfi("27.0.0")).toBe(true);
  });

  it("rejects older Node", () => {
    expect(nodeSupportsOpenTuiFfi("24.14.1")).toBe(false);
    expect(nodeSupportsOpenTuiFfi("26.3.9")).toBe(false);
    expect(nodeSupportsOpenTuiFfi("20.0.0")).toBe(false);
  });
});

describe("hasExperimentalFfiFlag", () => {
  it("detects flag in execArgv shape", () => {
    const prev = process.execArgv.slice();
    try {
      (process as { execArgv: string[] }).execArgv = ["--experimental-ffi"];
      expect(hasExperimentalFfiFlag()).toBe(true);
      (process as { execArgv: string[] }).execArgv = [];
      expect(hasExperimentalFfiFlag()).toBe(false);
    } finally {
      (process as { execArgv: string[] }).execArgv = prev;
    }
  });
});
