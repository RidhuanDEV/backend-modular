export const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  gray: "\x1b[90m",
  cyan: "\x1b[36m",
  brightCyan: "\x1b[1;36m",
  green: "\x1b[32m",
  brightGreen: "\x1b[1;32m",
  yellow: "\x1b[33m",
  brightYellow: "\x1b[1;33m",
  red: "\x1b[31m",
  brightRed: "\x1b[1;31m",
  blue: "\x1b[34m",
  brightBlue: "\x1b[1;94m",
  magenta: "\x1b[35m",
  brightMagenta: "\x1b[1;95m",
  brightWhite: "\x1b[1;37m",
  tsColor: "\x1b[1;94m",
  tsDim: "\x1b[34m",
  goColor: "\x1b[1;96m",
  goDim: "\x1b[36m",
  dotnetColor: "\x1b[1;95m",
  dotnetDim: "\x1b[35m",
};

export const cursor = {
  hide: "\x1b[?25l",
  show: "\x1b[?25h",
  up: (lines: number): string => `\x1b[${lines}A`,
  clearDown: "\x1b[0J",
  clearLine: "\x1b[2K\r",
};

export const symbols = {
  pointer: "❯",
  check: "✔",
  question: "?",
  info: "ℹ",
  cross: "✖",
};
