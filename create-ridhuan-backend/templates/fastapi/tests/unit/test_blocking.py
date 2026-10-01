import asyncio
import threading

import pytest

from app.core.blocking import BlockingPool


async def test_cancelled_request_retains_its_worker_until_completion() -> None:
    pool = BlockingPool(workers=1)
    entered = threading.Event()
    release = threading.Event()
    second_entered = threading.Event()

    def first_job() -> int:
        entered.set()
        if not release.wait(timeout=5):
            raise TimeoutError("Fixture was not released")
        return 1

    def second_job() -> int:
        second_entered.set()
        return 2

    first = asyncio.create_task(pool.run(first_job))
    second: asyncio.Task[int] | None = None
    try:
        assert await asyncio.to_thread(entered.wait, 1)
        first.cancel()
        await asyncio.gather(first, return_exceptions=True)
        second = asyncio.create_task(pool.run(second_job))
        await asyncio.sleep(0.05)
        assert not second_entered.is_set()
        release.set()
        assert await second == 2
    finally:
        release.set()
        await asyncio.gather(
            first, *([second] if second is not None else []), return_exceptions=True
        )
        await pool.close()


async def test_stream_worker_finishes_before_cancellation_closes_its_resources() -> None:
    pool = BlockingPool(workers=1, wait_on_cancel=True)
    entered = threading.Event()
    release = threading.Event()

    def operation() -> None:
        entered.set()
        if not release.wait(timeout=5):
            raise TimeoutError("Fixture was not released")

    task = asyncio.create_task(pool.run(operation))
    try:
        assert await asyncio.to_thread(entered.wait, 1)
        task.cancel()
        await asyncio.sleep(0.05)
        assert not task.done()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
    finally:
        release.set()
        await asyncio.gather(task, return_exceptions=True)
        await pool.close()
