package com.example.backend.platform.http;

import jakarta.servlet.ServletConnection;
import java.util.Optional;
import org.apache.coyote.http11.Http11NioProtocol;
import org.apache.tomcat.util.net.NioChannel;
import org.apache.tomcat.util.net.NioEndpoint;
import org.apache.tomcat.util.net.SocketWrapperBase;

/** Exposes the published native endpoint API for exact stream connection binding. */
public class StreamProtocol extends Http11NioProtocol {
  public StreamProtocol() {
    super();
  }

  StreamProtocol(NioEndpoint endpoint) {
    super(endpoint);
  }

  Optional<SocketWrapperBase<NioChannel>> connection(ServletConnection connection) {
    return getEndpoint().getConnections().stream()
        .filter(
            socket ->
                socket
                    .getServletConnection(
                        connection.getProtocol(), connection.getProtocolConnectionId())
                    .getConnectionId()
                    .equals(connection.getConnectionId()))
        .findFirst();
  }
}
