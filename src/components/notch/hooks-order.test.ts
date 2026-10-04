import { describe, expect, it, vi } from "vitest";

/** The hooks a render calls, in order: React requires the same ones on every render of a component. */
const calls: string[] = [];

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      calls.push("useState");
      return [typeof initial === "function" ? (initial as () => unknown)() : initial, () => undefined];
    },
    useEffect: () => {
      calls.push("useEffect");
    },
  };
});

const { useWaking } = await import("./hooks");

function hooksOf(render: () => unknown): string[] {
  calls.length = 0;
  render();
  return [...calls];
}

describe("useWaking", () => {
  it("calls the same hooks whether the notch is tucked or out, so tucking it never crashes the notch", () => {
    expect(hooksOf(() => useWaking(true))).toEqual(hooksOf(() => useWaking(false)));
  });
});
