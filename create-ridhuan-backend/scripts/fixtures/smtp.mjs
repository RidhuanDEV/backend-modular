// Disposable SMTP sink for consumer acceptance; never used by template applications.
import { createServer } from "node:net";
import { createServer as httpServer } from "node:http";
let messages = 0;
createServer((socket) => {
  socket.setEncoding("utf8");
  socket.write("220 fixture ESMTP\r\n");
  let buffered = "";
  let readingData = false;
  socket.on("data", (chunk) => {
    buffered += chunk;
    while (buffered.includes("\r\n")) {
      const end = buffered.indexOf("\r\n");
      const line = buffered.slice(0, end);
      buffered = buffered.slice(end + 2);
      if (readingData) {
        if (line === ".") { messages++; readingData = false; socket.write("250 queued\r\n"); }
        continue;
      }
      if (/^EHLO /i.test(line)) socket.write("250-fixture\r\n250 8BITMIME\r\n");
      else if (/^(HELO |MAIL FROM:|RCPT TO:|RSET|NOOP)/i.test(line)) socket.write("250 OK\r\n");
      else if (/^DATA$/i.test(line)) { readingData = true; socket.write("354 End with .\r\n"); }
      else if (/^QUIT$/i.test(line)) socket.end("221 Bye\r\n");
      else socket.write("502 Not implemented\r\n");
    }
  });
  socket.on("error", () => socket.destroy());
}).listen(1025, "0.0.0.0");
httpServer((_request, response) => {
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ messages }));
}).listen(1080, "0.0.0.0");
