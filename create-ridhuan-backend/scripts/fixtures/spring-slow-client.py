"""Exercise SSE write timeout with a controlled TCP receive window."""
import json
import os
import socket
import sys
import time

client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
try:
    client.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4096)
    client.settimeout(5)
    client.connect(("127.0.0.1", int(sys.argv[1])))
    request = (
        "GET /api/notifications/stream HTTP/1.1\r\nHost: 127.0.0.1\r\n"
        "Authorization: Bearer " + os.environ["SPRING_SLOW_CLIENT_TOKEN"] +
        "\r\nConnection: close\r\n\r\n"
    )
    client.sendall(request.encode("ascii"))
    time.sleep(16)
    deadline = time.monotonic() + 12
    prefix = b""
    total = 0
    closed = False
    while time.monotonic() < deadline:
        client.settimeout(max(0.001, deadline - time.monotonic()))
        try:
            chunk = client.recv(65536)
        except ConnectionResetError:
            closed = True
            break
        except socket.timeout:
            break
        if not chunk:
            closed = True
            break
        if len(prefix) < 512:
            prefix += chunk[:512 - len(prefix)]
        total += len(chunk)
    assert prefix.startswith(b"HTTP/1.1 200"), "Slow-client stream did not open"
    assert closed, "Slow client was not disconnected within the write budget"
    print(json.dumps({"opened": True, "closed": closed, "receivedBytes": total,
                      "requestedReceiveBuffer": 4096,
                      "actualReceiveBuffer": client.getsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF)}))
finally:
    client.close()
