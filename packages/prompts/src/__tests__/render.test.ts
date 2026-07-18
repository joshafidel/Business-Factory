import { describe, expect, it } from "vitest";
import { extractVariables, renderTemplate } from "../render";

describe("prompt templates", () => {
  it("extracts unique variables", () => {
    expect(extractVariables("Do {{a}} then {{ b }} then {{a}}")).toEqual(["a", "b"]);
  });

  it("renders with provided variables", () => {
    expect(renderTemplate("Hello {{name}}!", { name: "world" })).toBe("Hello world!");
  });

  it("throws on missing variables instead of shipping literals", () => {
    expect(() => renderTemplate("Research {{topic}}", {})).toThrow(/topic/);
  });
});
