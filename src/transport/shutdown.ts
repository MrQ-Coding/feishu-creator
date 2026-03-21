export function createShutdownHandler(cleanup: () => Promise<void>): (exitCode?: number) => void {
  let shutdownPromise: Promise<void> | undefined;
  let finalized = false;

  const finalize = (exitCode: number) => {
    if (finalized) {
      return;
    }
    finalized = true;
    process.exit(exitCode);
  };

  return (exitCode = 0) => {
    if (shutdownPromise) {
      return;
    }

    shutdownPromise = (async () => {
      await cleanup();
      finalize(exitCode);
    })();

    // Force process termination if cleanup stalls on hidden handles.
    setTimeout(() => finalize(exitCode), 1000).unref();
  };
}
