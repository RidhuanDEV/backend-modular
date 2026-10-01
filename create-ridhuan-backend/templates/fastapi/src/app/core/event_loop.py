import asyncio
import selectors
import sys
from collections.abc import Coroutine


def loop_factory() -> asyncio.AbstractEventLoop:
    # psycopg async cannot use Windows' default Proactor loop.
    if sys.platform == "win32":
        return asyncio.SelectorEventLoop(selectors.SelectSelector())
    return asyncio.new_event_loop()


def run[T](coroutine: Coroutine[object, object, T]) -> T:
    return asyncio.run(coroutine, loop_factory=loop_factory)
