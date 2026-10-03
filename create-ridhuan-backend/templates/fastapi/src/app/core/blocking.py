import asyncio
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from functools import partial

from app.core.errors import ApiError


class BlockingPool:
    """Bound running jobs and submissions, including after client cancellation."""

    def __init__(self, workers: int = 2, *, wait_on_cancel: bool = False) -> None:
        self.executor = ThreadPoolExecutor(
            max_workers=workers, thread_name_prefix="backend-work"
        )
        self.slots = asyncio.Semaphore(workers)
        self.wait_on_cancel = wait_on_cancel

    async def run[T, **P](
        self, operation: Callable[P, T], *args: P.args, **kwargs: P.kwargs
    ) -> T:
        try:
            await asyncio.wait_for(self.slots.acquire(), timeout=3)
        except TimeoutError as error:
            raise ApiError(503, "Server busy; retry later") from error
        try:
            future = asyncio.get_running_loop().run_in_executor(
                self.executor, partial(operation, *args, **kwargs)
            )
        except BaseException:
            self.slots.release()
            raise

        def completed(job: asyncio.Future[T]) -> None:
            self.slots.release()
            if not job.cancelled():
                job.exception()  # Consume failures even if the HTTP caller disconnected.

        future.add_done_callback(completed)
        try:
            return await asyncio.shield(future)
        except asyncio.CancelledError:
            if self.wait_on_cancel:
                # Upload streams must remain open until the SDK stops using them.
                # Completion callback consumes any worker error; cancellation
                # remains the caller's outcome and triggers upload compensation.
                await asyncio.gather(asyncio.shield(future), return_exceptions=True)
            raise

    async def close(self) -> None:
        await asyncio.to_thread(self.executor.shutdown, wait=True, cancel_futures=True)
