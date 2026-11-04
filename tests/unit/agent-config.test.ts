import { describe, expect, it } from "vitest";
import { estimateCostUsd, sumUsage, EMPTY_USAGE } from "@/server/agent/config";
import { toPlainText, splitMessage } from "@/server/notify/telegram";

describe("agent cost", () => {
  it("prices Opus 5.5 tokens including cache reads and writes", () => {
    const cost = estimateCostUsd("claude-opus-5-5", { input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 2_000_000, cache_creation_input_tokens: 100_000 });
    expect(cost).toBeCloseTo(4 + 2 + 0.4 + 0.5, 6);
  });
  it("falls back to Opus pricing for unknown models and sums usage", () => {
    expect(estimateCostUsd("claude-mystery", { input_tokens: 1_000_000, output_tokens: 0 })).toBe(4);
    const u = sumUsage(sumUsage(EMPTY_USAGE, { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3 }), { input_tokens: 1, output_tokens: 1 });
    expect(u).toEqual({ input_tokens: 11, output_tokens: 6, cache_read_input_tokens: 3, cache_creation_input_tokens: 0 });
  });
});

describe("telegram text", () => {
  it("strips markdown and splits long messages at newlines", () => {
    expect(toPlainText("## Titolo\n- **a** `b` [c](http://x)")).toBe("Titolo\n• a b c");
    const parts = splitMessage(Array.from({ length: 300 }, (_, i) => `riga ${i}`).join("\n"), 500);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 500)).toBe(true);
    expect(parts.join("\n")).toContain("riga 299");
  });
});
