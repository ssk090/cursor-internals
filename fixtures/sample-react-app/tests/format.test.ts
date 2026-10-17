import { describe, expect, it } from "vitest";
import { formatUserName, initials } from "../src/utils/format";

describe("formatUserName", () => {
  it("prefers a non-empty name", () => {
    expect(
      formatUserName({
        id: "1",
        name: "Ada Lovelace",
        email: "ada@example.com",
        role: "admin",
      }),
    ).toBe("Ada Lovelace");
  });

  it("falls back to the email for empty names", () => {
    expect(
      formatUserName({
        id: "2",
        name: "   ",
        email: "grace@example.com",
        role: "member",
      }),
    ).toBe("grace@example.com");
  });
});

describe("initials", () => {
  it("takes the first letter of each word", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
  });
});
