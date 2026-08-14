import { describe, expect, it, vi } from "vitest";
import { deliverTextFile } from "./downloadFile";

describe("deliverTextFile", () => {
  it("delivers through the saver when there is one", async () => {
    const saver = vi.fn().mockResolvedValue("/chosen/orders-turn-71.txt");
    const download = vi.fn();

    const result = await deliverTextFile(saver, "orders-turn-71.txt", "unit 1 work", "text/plain", download);

    expect(saver).toHaveBeenCalledWith("orders-turn-71.txt", "unit 1 work");
    expect(download).not.toHaveBeenCalled();
    expect(result).toBe("/chosen/orders-turn-71.txt");
  });

  it("falls back to the download without a saver", async () => {
    const download = vi.fn();

    const result = await deliverTextFile(undefined, "orders-turn-71.txt", "unit 1 work", "text/plain", download);

    expect(download).toHaveBeenCalledWith("orders-turn-71.txt", "unit 1 work", "text/plain");
    expect(result).toBe("");
  });

  it("a cancelled save downloads nothing", async () => {
    const saver = vi.fn().mockResolvedValue(null);
    const download = vi.fn();

    const result = await deliverTextFile(saver, "orders-turn-71.txt", "unit 1 work", "text/plain", download);

    expect(download).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("a saver that throws rejects into the caller's catch", async () => {
    const saver = vi.fn().mockRejectedValue(new Error("disk full"));
    const download = vi.fn();

    await expect(
      deliverTextFile(saver, "orders-turn-71.txt", "unit 1 work", "text/plain", download)
    ).rejects.toThrow("disk full");
    expect(download).not.toHaveBeenCalled();
  });
});
