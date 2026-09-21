export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  async runExclusive<T>(fn: () => T | Promise<T>): Promise<T> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.tail;
    this.tail = previous.then(() => next, () => next);
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
