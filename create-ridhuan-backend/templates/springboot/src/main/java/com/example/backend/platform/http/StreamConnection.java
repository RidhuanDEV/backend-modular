package com.example.backend.platform.http;

import java.io.IOException;
import org.apache.tomcat.util.net.NioChannel;
import org.apache.tomcat.util.net.SocketWrapperBase;

/** Nonblocking native EOF probe for a bodyless HTTP/1.1 SSE request. */
public record StreamConnection(SocketWrapperBase<NioChannel> socket) {
  public boolean active() {
    if (socket.isClosed()) return false;
    var lock = socket.getLock();
    if (!lock.tryLock()) return !socket.isClosed();
    try {
      if (socket.isClosed()) return false;
      // Preserve any bytes in Tomcat's read buffer. An EOF can precede the Servlet callback,
      // notably when a proxy half-closes input while continuing to accept heartbeat writes.
      socket.isReadyForRead();
      return true;
    } catch (IOException ended) {
      return false;
    } finally {
      lock.unlock();
    }
  }
}
