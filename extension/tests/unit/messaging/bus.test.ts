import { describe, expect, it, vi } from "vitest";

import { EventBus } from "@/messaging/bus";

interface TestEvents extends Record<string, unknown> {
  ping: void;
  echo: string;
}

describe("EventBus", () => {
  it("delivers events to all listeners", () => {
    const bus = new EventBus<TestEvents>();
    const a = vi.fn();
    const b = vi.fn();
    bus.on("ping", a);
    bus.on("ping", b);
    bus.emit("ping", undefined);
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it("passes the payload", () => {
    const bus = new EventBus<TestEvents>();
    const fn = vi.fn();
    bus.on("echo", fn);
    bus.emit("echo", "hello");
    expect(fn).toHaveBeenCalledWith("hello");
  });

  it("dispose removes the listener", () => {
    const bus = new EventBus<TestEvents>();
    const fn = vi.fn();
    const sub = bus.on("ping", fn);
    sub.dispose();
    bus.emit("ping", undefined);
    expect(fn).not.toHaveBeenCalled();
  });

  it("clear drops all listeners", () => {
    const bus = new EventBus<TestEvents>();
    const fn = vi.fn();
    bus.on("ping", fn);
    bus.clear();
    bus.emit("ping", undefined);
    expect(fn).not.toHaveBeenCalled();
  });

  it("emitting an event with no listeners is a no-op", () => {
    const bus = new EventBus<TestEvents>();
    expect(() => bus.emit("ping", undefined)).not.toThrow();
  });
});
