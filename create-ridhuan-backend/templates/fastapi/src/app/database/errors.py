from sqlalchemy.exc import DBAPIError, OperationalError


def database_status(error: DBAPIError) -> int:
    """Map verified driver codes without exposing SQL, parameters or credentials."""
    original = error.orig
    state: object = getattr(original, "sqlstate", None)
    code: object = original.args[0] if original is not None and original.args else None
    if (
        isinstance(state, str)
        and state in {"23505", "23503"}
        or isinstance(code, int)
        and code in {1062, 1451, 1452}
    ):
        return 409
    # A failed audit CHECK is an infrastructure failure, not a user conflict.
    if state == "23514" or code == 3819 or isinstance(error, OperationalError):
        return 503
    return 500
