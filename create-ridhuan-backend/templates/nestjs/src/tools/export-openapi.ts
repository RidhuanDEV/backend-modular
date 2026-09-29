import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { createApp } from "../main";
import { DocsService } from "../modules/docs/docs.service";

async function main(): Promise<void> {
  const app = await createApp();
  try {
    const document = app.get(DocsService).getDocument();
    await writeFile("openapi.json", JSON.stringify(document, null, 2));
  } finally { await app.close(); }
}
main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : "OpenAPI export failed"}\n`); process.exitCode = 1; });
