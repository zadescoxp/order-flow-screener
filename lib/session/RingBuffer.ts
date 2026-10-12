export class RingBuffer<T> {
  private readonly values: T[];
  private cursor = 0;
  private length = 0;

  constructor(private readonly capacity: number) {
    this.values = new Array<T>(capacity);
  }

  push(value: T): void {
    this.values[this.cursor] = value;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.length = Math.min(this.length + 1, this.capacity);
  }

  clear(): void {
    this.cursor = 0;
    this.length = 0;
  }

  newestFirst(): T[] {
    return Array.from({ length: this.length }, (_, index) => {
      const position = (this.cursor - 1 - index + this.capacity) % this.capacity;
      return this.values[position];
    });
  }
}
