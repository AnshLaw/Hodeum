import { describe, expect, it, vi } from "vitest";
import { Flag } from "./flag";

describe("Flag", () => {
  it("starts off and reads what it was last set to", () => {
    const flag = new Flag();
    expect(flag.current()).toBe(false);
    flag.set(true);
    expect(flag.current()).toBe(true);
  });

  it("tells its watchers about changes only", () => {
    const flag = new Flag();
    const watcher = vi.fn();
    flag.subscribe(watcher);
    flag.set(true);
    flag.set(true);
    flag.set(false);
    expect(watcher.mock.calls).toEqual([[true], [false]]);
  });

  it("stops telling a watcher that unsubscribed", () => {
    const flag = new Flag();
    const watcher = vi.fn();
    const off = flag.subscribe(watcher);
    off();
    flag.set(true);
    expect(watcher).not.toHaveBeenCalled();
  });
});
