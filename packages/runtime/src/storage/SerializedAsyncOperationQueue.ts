import { AsyncLocalStorage } from 'node:async_hooks';

export class SerializedAsyncOperationQueue {
  private operationQueue: Promise<void> = Promise.resolve();
  private readonly operationScope = new AsyncLocalStorage<boolean>();

  run<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this.operationScope.getStore()) {
      return Promise.resolve(operation());
    }

    const run = this.operationQueue.then(operation);
    this.operationQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  runInScope<T>(operation: () => T | Promise<T>): Promise<T> {
    return this.run(() => this.operationScope.run(true, operation));
  }
}
