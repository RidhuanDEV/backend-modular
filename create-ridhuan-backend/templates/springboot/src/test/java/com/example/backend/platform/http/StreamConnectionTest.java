package com.example.backend.platform.http;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import jakarta.servlet.ServletConnection;
import java.io.EOFException;
import java.util.Set;
import java.util.concurrent.locks.ReentrantLock;
import org.apache.tomcat.util.net.NioEndpoint;
import org.junit.jupiter.api.Test;

class StreamConnectionTest {
  @Test
  void eofEndsStreamEvenWithoutServletCompletionOrClosedSocket() throws Exception {
    var socket = mock(NioEndpoint.NioSocketWrapper.class);
    var lock = new ReentrantLock();
    when(socket.getLock()).thenReturn(lock);
    when(socket.isReadyForRead()).thenThrow(new EOFException());
    assertFalse(new StreamConnection(socket).active());
    assertFalse(lock.isLocked());
    verify(socket, never()).close();
  }

  @Test
  void idleAndBufferedInputRemainAliveWithoutConsumingBytes() throws Exception {
    var socket = mock(NioEndpoint.NioSocketWrapper.class);
    when(socket.getLock()).thenReturn(new ReentrantLock());
    when(socket.isReadyForRead()).thenReturn(false, true);
    var connection = new StreamConnection(socket);
    assertTrue(connection.active());
    assertTrue(connection.active());
    verify(socket, never()).close();
    verify(socket, never()).read(anyBoolean(), any(byte[].class), anyInt(), anyInt());
  }

  @Test
  void closedSocketNeverProbesRecycledBuffers() throws Exception {
    var socket = mock(NioEndpoint.NioSocketWrapper.class);
    when(socket.isClosed()).thenReturn(true);
    assertFalse(new StreamConnection(socket).active());
    verify(socket, never()).isReadyForRead();
    verify(socket, never()).getLock();
  }

  @Test
  void matchesNativeConnectionIdRatherThanPeerOrIterationOrder() {
    var endpoint = mock(NioEndpoint.class);
    var first = mock(NioEndpoint.NioSocketWrapper.class);
    var second = mock(NioEndpoint.NioSocketWrapper.class);
    var request = mock(ServletConnection.class);
    var other = mock(ServletConnection.class);
    when(request.getProtocol()).thenReturn("HTTP/1.1");
    when(request.getProtocolConnectionId()).thenReturn("");
    when(request.getConnectionId()).thenReturn("expected");
    when(other.getConnectionId()).thenReturn("other");
    when(first.getServletConnection("HTTP/1.1", "")).thenReturn(other);
    when(second.getServletConnection("HTTP/1.1", "")).thenReturn(request);
    when(endpoint.getConnections()).thenReturn(Set.of(first, second));
    var protocol = new StreamProtocol(endpoint);
    assertSame(second, protocol.connection(request).orElseThrow());
    when(request.getConnectionId()).thenReturn("missing");
    when(second.getServletConnection("HTTP/1.1", "")).thenReturn(other);
    assertTrue(protocol.connection(request).isEmpty());
  }
}
