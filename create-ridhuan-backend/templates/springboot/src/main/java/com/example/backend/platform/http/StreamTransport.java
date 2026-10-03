package com.example.backend.platform.http;

import jakarta.servlet.http.HttpServletRequest;
import java.util.concurrent.atomic.AtomicReference;
import org.springframework.boot.tomcat.servlet.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.stereotype.Component;

@Component
public class StreamTransport {
  private final AtomicReference<StreamProtocol> protocol = new AtomicReference<>();

  @Bean
  public WebServerFactoryCustomizer<TomcatServletWebServerFactory> streamProtocol() {
    return factory -> {
      factory.setProtocol(StreamProtocol.class.getName());
      factory.addConnectorCustomizers(
          connector -> {
            if (connector.getProtocolHandler() instanceof StreamProtocol nativeProtocol) {
              protocol.set(nativeProtocol);
            }
          });
    };
  }

  public StreamConnection bind(HttpServletRequest request) {
    var nativeProtocol = protocol.get();
    if (nativeProtocol == null) throw new ApiException(503, "Stream transport unavailable");
    return nativeProtocol
        .connection(request.getServletConnection())
        .map(StreamConnection::new)
        .orElseThrow(() -> new ApiException(503, "Stream transport unavailable"));
  }
}
