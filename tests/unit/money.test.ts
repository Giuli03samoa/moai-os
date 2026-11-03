import { describe, expect, it } from "vitest";
import { eq, parseAmount, sum } from "@/server/money";

describe("parseAmount", () => {
  it("parses Italian and English formats without floats", () => {
    expect(parseAmount("1.234,56")!.toFixed(2)).toBe("1234.56");
    expect(parseAmount("1,234.56")!.toFixed(2)).toBe("1234.56");
    expect(parseAmount("12,5")!.toFixed(2)).toBe("12.50");
    expect(parseAmount("€ 10,00")!.toFixed(2)).toBe("10.00");
    expect(parseAmount("-12.5")!.toFixed(2)).toBe("-12.50");
    expect(parseAmount("(12.50)")!.toFixed(2)).toBe("-12.50");
    expect(parseAmount("12.50-")!.toFixed(2)).toBe("-12.50");
    expect(parseAmount("1,234")!.toFixed(2)).toBe("1234.00"); // thousands, ambiguous → English
    expect(parseAmount("0.1")!.plus(parseAmount("0.2")!).toFixed(2)).toBe("0.30");
  });
  it("respects an explicit decimal separator", () => {
    expect(parseAmount("1,234", { decimalSeparator: "," })!.toFixed(3)).toBe("1.234");
    expect(parseAmount("72.95", { decimalSeparator: "." })!.toFixed(2)).toBe("72.95");
  });
  it("rejects garbage", () => {
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("")).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount(Number.NaN)).toBeNull();
  });
  it("sums and compares with tolerance", () => {
    expect(sum(["10,00", "0.5", null, "x"]).toFixed(2)).toBe("10.50");
    expect(eq("10.00", "10.004")).toBe(true);
    expect(eq("10.00", "10.02")).toBe(false);
  });
});
