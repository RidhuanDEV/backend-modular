// Disposable SMTP sink. Its certificate is trusted only by the isolated consumer fixture.
import { createServer } from 'node:net';
import { createServer as httpServer } from 'node:http';
import { createServer as tlsServer, createSecureContext, TLSSocket } from 'node:tls';
import { readFileSync } from 'node:fs';
const credentials = { key: readFileSync('/fixture/certs/key.pem'), cert: readFileSync('/fixture/certs/cert.pem') };
const secureContext = createSecureContext(credentials);
let messages = 0;
function session(socket, greet = true) {
  socket.setEncoding('utf8');
  if (greet) socket.write('220 fixture ESMTP\r\n');
  let buffered = '', readingData = false;
  function consume(chunk) {
    buffered += chunk;
    while (buffered.includes('\r\n')) {
      const end = buffered.indexOf('\r\n');
      const line = buffered.slice(0, end); buffered = buffered.slice(end + 2);
      if (readingData) {
        if (line === '.') { messages++; readingData = false; socket.write('250 queued\r\n'); }
        continue;
      }
      if (/^EHLO /i.test(line)) socket.write('250-fixture\r\n' + (socket.encrypted ? '' : '250-STARTTLS\r\n') + '250 8BITMIME\r\n');
      else if (/^STARTTLS$/i.test(line) && !socket.encrypted) {
        socket.removeListener('data', consume);
        socket.write('220 Ready for TLS\r\n');
        session(new TLSSocket(socket, { isServer: true, secureContext }), false);
        return;
      } else if (/^(HELO |MAIL FROM:|RCPT TO:|RSET|NOOP)/i.test(line)) socket.write('250 OK\r\n');
      else if (/^DATA$/i.test(line)) { readingData = true; socket.write('354 End with .\r\n'); }
      else if (/^QUIT$/i.test(line)) socket.end('221 Bye\r\n');
      else socket.write('502 Not implemented\r\n');
    }
  }
  socket.on('data', consume);
  socket.on('error', () => socket.destroy());
}
createServer(session).listen(1025, '0.0.0.0');
tlsServer(credentials, session).listen(1465, '0.0.0.0');
httpServer((_request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ messages }));
}).listen(1080, '0.0.0.0');
