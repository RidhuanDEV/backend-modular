import { createInterface } from "node:readline/promises";
import { colors, symbols } from "./terminal-theme.js";

export async function textPrompt(
  question: string,
  defaultValue: string,
  autoYes: boolean = false,
): Promise<string> {
  if (autoYes || !process.stdin.isTTY) {
    process.stdout.write(
      `${colors.green}${symbols.check}${colors.reset} ${colors.bold}${question}:${colors.reset} ${colors.cyan}${defaultValue}${colors.reset}\n`,
    );
    return defaultValue;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.once("SIGINT", () => { process.stdout.write("\x1b[?25h\nAborted.\n"); process.exit(130); });

  const promptText = `${colors.cyan}${symbols.question}${colors.reset} ${colors.bold}${question}${colors.reset} ${colors.dim}[${defaultValue}]${colors.reset}: `;

  try {
    const rawAnswer = await rl.question(promptText);
    const trimmed = rawAnswer.trim();
    const result = trimmed.length > 0 ? trimmed : defaultValue;
    return result;
  } finally {
    rl.close();
  }
}
