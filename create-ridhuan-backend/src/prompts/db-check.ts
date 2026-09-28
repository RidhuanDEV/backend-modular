import net from "node:net";

export interface PostgresCheckResult {
  readonly reachable: boolean;
  readonly authenticated: boolean;
  readonly roleExists: boolean;
  readonly databaseExists: boolean;
  readonly message: string;
}

export function verifyPostgresConnection(
  host: string,
  port: number,
  user: string,
  database: string,
  timeoutMs: number = 2500,
): Promise<PostgresCheckResult> {
  return new Promise<PostgresCheckResult>((resolve) => {
    const socket = new net.Socket();
    let hasResolved = false;

    const finish = (result: PostgresCheckResult): void => {
      if (hasResolved) {
        return;
      }
      hasResolved = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);

    socket.on("timeout", () => {
      finish({
        reachable: false,
        authenticated: false,
        roleExists: false,
        databaseExists: false,
        message: `Connection timed out after ${timeoutMs}ms`,
      });
    });

    socket.on("error", (err: Error) => {
      finish({
        reachable: false,
        authenticated: false,
        roleExists: false,
        databaseExists: false,
        message: err.message,
      });
    });

    socket.connect(port, host, () => {
      // Build PostgreSQL v3.0 StartupMessage
      // Format: Int32(length), Int32(196608 = protocol 3.0), "user\0<user>\0database\0<database>\0\0"
      const payloadString = `user\0${user}\0database\0${database}\0\0`;
      const payloadBuffer = Buffer.from(payloadString, "utf8");
      const packetLength = 4 + 4 + payloadBuffer.length;

      const packet = Buffer.alloc(packetLength);
      packet.writeInt32BE(packetLength, 0);
      packet.writeInt32BE(196608, 4);
      payloadBuffer.copy(packet, 8);

      socket.write(packet);
    });

    socket.on("data", (data: Buffer) => {
      if (data.length === 0) {
        finish({
          reachable: true,
          authenticated: false,
          roleExists: true,
          databaseExists: true,
          message: "Empty response from PostgreSQL server",
        });
        return;
      }

      const messageType = String.fromCharCode(data[0] || 0);

      // 'R' = Authentication request
      if (messageType === "R") {
        finish({
          reachable: true,
          authenticated: true,
          roleExists: true,
          databaseExists: true,
          message: "PostgreSQL server ready for authentication",
        });
        return;
      }

      // 'E' = ErrorResponse
      if (messageType === "E") {
        const errorText = data.toString("utf8");
        const isUnknownRole =
          errorText.includes("does not exist") &&
          (errorText.includes("role") || errorText.includes("user"));
        const isDbMissing =
          errorText.includes("database") && errorText.includes("does not exist");
        const isAuthFailed =
          errorText.includes("password authentication failed") ||
          errorText.includes("28P01");

        let friendlyMessage = "Authentication or database error";
        if (isUnknownRole) {
          friendlyMessage = `User role '${user}' does not exist in PostgreSQL (PostgreSQL default superuser is 'postgres', not 'root')`;
        } else if (isAuthFailed) {
          friendlyMessage = `Password authentication failed for user '${user}'`;
        } else if (isDbMissing) {
          friendlyMessage = `Database '${database}' does not exist yet (can be created later)`;
        }

        finish({
          reachable: true,
          authenticated: false,
          roleExists: !isUnknownRole,
          databaseExists: !isDbMissing,
          message: friendlyMessage,
        });
        return;
      }

      finish({
        reachable: true,
        authenticated: true,
        roleExists: true,
        databaseExists: true,
        message: "PostgreSQL responded",
      });
    });
  });
}
