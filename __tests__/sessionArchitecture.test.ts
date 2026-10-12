import { RingBuffer } from "@/lib/session/RingBuffer";

describe("session performance primitives", () => {
  it("keeps recent trades in bounded newest-first order", () => {
    const buffer = new RingBuffer<number>(3);
    buffer.push(1);
    buffer.push(2);
    buffer.push(3);
    buffer.push(4);
    expect(buffer.newestFirst()).toEqual([4, 3, 2]);
  });
});
