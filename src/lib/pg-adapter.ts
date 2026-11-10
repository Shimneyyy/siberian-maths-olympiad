import { PrismaPg as BasePrismaPg } from "@prisma/adapter-pg";

type Adapter = Awaited<ReturnType<BasePrismaPg["connect"]>>;

function serializeTransactions(adapter: Adapter): Adapter {
  const startTransaction = adapter.startTransaction.bind(adapter);
  adapter.startTransaction = async isolationLevel => {
    const transaction = await startTransaction(isolationLevel);
    // Prisma's relation loader may issue concurrent SQL even when the service
    // awaits each ORM operation. A transaction owns exactly one pg connection.
    // Keep its queue here rather than relying on pg's deprecated internal queue.
    let pending: Promise<void> = Promise.resolve();
    function sequence<T>(operation: () => Promise<T>): Promise<T> {
      const result = pending.then(operation);
      // A failed query still rejects its caller, but must not strand rollback.
      pending = result.then(() => {}, () => {});
      return result;
    }
    const queryRaw = transaction.queryRaw.bind(transaction);
    const executeRaw = transaction.executeRaw.bind(transaction);
    const commit = transaction.commit.bind(transaction);
    const rollback = transaction.rollback.bind(transaction);
    transaction.queryRaw = query => sequence(() => queryRaw(query));
    transaction.executeRaw = query => sequence(() => executeRaw(query));
    // Never release a pooled connection while previously submitted SQL is pending.
    transaction.commit = () => sequence(commit);
    transaction.rollback = () => sequence(rollback);
    return transaction;
  };
  return adapter;
}

// Each transaction has its own queue; the pool and separate transactions remain
// concurrent. No warnings are filtered and pg/Prisma internals are not patched.
export class PrismaPg extends BasePrismaPg {
  override async connect() { return serializeTransactions(await super.connect()); }
  override async connectToShadowDb() { return serializeTransactions(await super.connectToShadowDb()); }
}
