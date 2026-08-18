export class SerialExecutor {
  constructor() { this.tail = Promise.resolve(); }
  run(task) {
    const result = this.tail.then(() => task());
    this.tail = result.catch(() => {});
    return result;
  }
}
