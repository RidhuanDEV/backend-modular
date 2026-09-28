import { colors, cursor, symbols } from "./terminal-theme.js";
import type { PromptOption } from "../types.js";

export function selectPrompt<T>(
  message: string,
  options: readonly PromptOption<T>[],
  defaultIndex: number = 0,
): Promise<T> {
  return new Promise<T>((resolve) => {
    if (options.length === 0) {
      throw new Error("Cannot show select prompt with empty options");
    }

    const fallbackItem = options[0];
    if (fallbackItem === undefined) {
      throw new Error("Invalid options list");
    }

    if (!process.stdin.isTTY) {
      const selected = options[defaultIndex];
      const result = selected !== undefined ? selected.value : fallbackItem.value;
      process.stdout.write(`${colors.green}${symbols.check}${colors.reset} ${message}: ${String(result)}\n`);
      resolve(result);
      return;
    }

    let currentIndex: number = defaultIndex >= 0 && defaultIndex < options.length ? defaultIndex : 0;
    let hasRendered: boolean = false;

    const render = (): void => {
      if (hasRendered) {
        process.stdout.write(cursor.up(options.length) + "\r");
      }

      for (let i = 0; i < options.length; i++) {
        const option = options[i];
        if (option === undefined) {
          continue;
        }

        const isActive = i === currentIndex;
        const lineContent = cursor.clearLine;

        if (isActive) {
          const activeColor = option.activeColor !== undefined ? option.activeColor : colors.brightCyan;
          const arrow = `${activeColor}${symbols.pointer}${colors.reset}`;
          const label = `${activeColor}${colors.bold}${option.label}${colors.reset}`;
          const hint = option.hint !== undefined ? ` ${activeColor}(${option.hint})${colors.reset}` : "";
          process.stdout.write(`${lineContent} ${arrow} ${label}${hint}\n`);
        } else {
          const inactiveColor = option.inactiveColor !== undefined ? option.inactiveColor : colors.gray;
          const space = " ";
          const label = `${inactiveColor}${option.label}${colors.reset}`;
          const hint = option.hint !== undefined ? ` ${colors.gray}(${option.hint})${colors.reset}` : "";
          process.stdout.write(`${lineContent}  ${space} ${label}${hint}\n`);
        }
      }

      hasRendered = true;
    };

    process.stdout.write(`${colors.cyan}${symbols.question}${colors.reset} ${colors.bold}${message}${colors.reset} ${colors.dim}(Use arrow keys, press Enter)${colors.reset}\n`);
    process.stdout.write(cursor.hide);
    render();

    const onKeypress = (chunk: Buffer): void => {
      const key = chunk.toString("utf8");

      if (key === "\u0003") {
        process.stdout.write(cursor.show);
        if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
          process.stdin.setRawMode(false);
        }
        process.stdout.write("\nAborted.\n");
        process.exit(0);
      }

      if (key === "\u001b[A" || key === "k" || key === "w") {
        currentIndex = (currentIndex - 1 + options.length) % options.length;
        render();
        return;
      }

      if (key === "\u001b[B" || key === "j" || key === "s") {
        currentIndex = (currentIndex + 1) % options.length;
        render();
        return;
      }

      if (key === "\r" || key === "\n") {
        cleanup();

        process.stdout.write(cursor.up(options.length + 1) + "\r");
        process.stdout.write(cursor.clearDown);

        const chosenOption = options[currentIndex];
        const chosen = chosenOption !== undefined ? chosenOption : fallbackItem;
        const chosenColor = chosen.activeColor !== undefined ? chosen.activeColor : colors.brightCyan;

        process.stdout.write(
          `${colors.green}${symbols.check}${colors.reset} ${colors.bold}${message}:${colors.reset} ${chosenColor}${chosen.label}${colors.reset}\n`,
        );

        resolve(chosen.value);
      }
    };

    const cleanup = (): void => {
      process.stdin.removeListener("data", onKeypress);
      if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
        process.stdin.setRawMode(false);
      }
      process.stdout.write(cursor.show);
    };

    if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(true);
      process.stdin.resume();
    }

    process.stdin.on("data", onKeypress);
  });
}
