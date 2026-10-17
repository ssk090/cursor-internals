import { describe, expect, it } from "vitest";
import { buildUsersUrl } from "../src/api/users";

describe("buildUsersUrl", () => {
  it("targets the users endpoint by default", () => {
    expect(buildUsersUrl()).toBe("/api/users");
  });
});
