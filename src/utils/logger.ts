/**
 * Severity level types for log messages.
 */
export type LogType = 'info' | 'warn' | 'error' | 'success';

/**
 * Lightweight ANSI color utility — no external dependencies.
 */
export const colors = {
  green:   (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow:  (s: string) => `\x1b[33m${s}\x1b[0m`,
  red:     (s: string) => `\x1b[31m${s}\x1b[0m`,
  cyan:    (s: string) => `\x1b[36m${s}\x1b[0m`,
  gray:    (s: string) => `\x1b[90m${s}\x1b[0m`,
  blue:    (s: string) => `\x1b[34m${s}\x1b[0m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
  white:   (s: string) => `\x1b[37m${s}\x1b[0m`,
  bold:    (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim:     (s: string) => `\x1b[2m${s}\x1b[0m`,
};

// ── internal context tracker (gap management) ───────────────────────────────

let lastContext = '';

// ── logBox ───────────────────────────────────────────────────────────────────

const SYMBOL: Record<LogType, string> = {
  info:    'ℹ',
  success: '✔',
  warn:    '⚠',
  error:   '✖',
};

const BOX_COLOR: Record<LogType, (s: string) => string> = {
  info:    colors.cyan,
  success: colors.green,
  warn:    colors.yellow,
  error:   colors.red,
};

/**
 * Prints a status-icon + colored message, like Vite's `logger.info/warn/error`.
 *
 * @example
 * logBox('Build complete', 'success');   // ✔  Build complete
 * logBox('Proxy loaded', 'info');         // ℹ  Proxy loaded
 */
export function logBox(msg: string, type: LogType = 'info'): void {
  if (lastContext && lastContext !== '__box__') {
    process.stdout.write('\n');
  }
  lastContext = '__box__';

  const color  = BOX_COLOR[type] ?? colors.cyan;
  const symbol = SYMBOL[type]    ?? 'ℹ';
  console.log(color(`${symbol}  ${msg}`));
}

// ── logStep ──────────────────────────────────────────────────────────────────

const STEP_PALETTE: Array<(s: string) => string> = [
  colors.gray,
  colors.white,
  colors.blue,
  colors.green,
  colors.magenta,
  colors.yellow,
  colors.cyan,
];

/**
 * Prints a single indented step row:  `  ↪ <part0> <part1> <part2> …`
 *
 * Each part gets a different color from the rotating palette.
 * A blank line is inserted between rows from different contexts.
 *
 * @example
 * logStep('proxy', '[REWRITE]', '/api', '→', 'https://backend.io/api');
 * logStep('spa',   '[REWRITE]', '/admin/*', '→', '/admin/index.html');
 */
export function logStep(...parts: string[]): void {
  if (parts.length > 0) {
    const ctx = parts[0];
    if (lastContext && lastContext !== ctx) {
      process.stdout.write('\n');
    }
    lastContext = ctx;
  }

  const colored = parts.map((part, i) => STEP_PALETTE[i % STEP_PALETTE.length](part));
  console.log(`  ${colors.cyan('↪')} ${colored.join(' ')}`);
}

// ── logGrid ──────────────────────────────────────────────────────────────────

/**
 * Prints multiple aligned step rows under the same context.
 *
 * @example
 * logGrid('proxy', [
 *   ['[REWRITE]', '/api',    '→', 'https://api.example.com'],
 *   ['[REWRITE]', '/ws',     '→', 'wss://api.example.com'],
 * ]);
 */
export function logGrid(
  context: string,
  rows: string[][],
  align: ('left' | 'right')[] = []
): void {
  if (rows.length === 0) return;

  const maxLengths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      maxLengths[i] = Math.max(maxLengths[i] || 0, cell.length);
    });
  }

  for (const row of rows) {
    const padded = row.map((cell, i) =>
      align[i] === 'right' ? cell.padStart(maxLengths[i]) : cell.padEnd(maxLengths[i])
    );
    logStep(context, ...padded);
  }
}

// ── createSpinner ─────────────────────────────────────────────────────────────

/**
 * Creates a minimal animated terminal spinner.
 *
 * @example
 * const spin = createSpinner('Building…');
 * spin.start();
 * // … do work …
 * spin.stop();
 */
export function createSpinner(text: string) {
  const frames = ['.  ', '.. ', '...'];
  let i = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let currentText = text;

  const render = () => {
    process.stdout.write('\r\x1b[K');
    process.stdout.write(`${colors.white(currentText)}${frames[i]}`);
    i = (i + 1) % frames.length;
  };

  return {
    start() { if (!timer) { render(); timer = setInterval(render, 400); } },
    update(newText: string) { currentText = newText; if (timer) render(); },
    stop()  { if (timer) { clearInterval(timer); timer = null; process.stdout.write('\r\x1b[K'); } },
  };
}

// ── HTTP request coloring helpers (used by proxy util) ───────────────────────

/**
 * Colorizes an HTTP method name for terminal display.
 */
export function colorMethod(method: string): string {
  switch (method.toUpperCase()) {
    case 'GET':     return colors.blue(method);
    case 'POST':    return colors.green(method);
    case 'PUT':     return colors.yellow(method);
    case 'PATCH':   return colors.magenta(method);
    case 'DELETE':  return colors.red(method);
    case 'OPTIONS': return colors.gray(method);
    default:        return colors.white(method);
  }
}

/**
 * Colorizes an HTTP status code for terminal display.
 */
export function colorStatus(status: number, statusText = ''): string {
  const text = statusText ? `${status} ${statusText}` : `${status}`;
  if (status >= 200 && status < 300) return colors.green(text);
  if (status >= 300 && status < 400) return colors.cyan(text);
  if (status >= 400 && status < 500) return colors.yellow(text);
  return colors.red(text);
}

/**
 * Returns the current time formatted as `HH:MM:SS AM/PM`.
 */
export function formatTime(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: true });
}

// ── Standalone logger instance ────────────────────────────────────────────────

/**
 * Drop-in logger — mirrors the vite-plugins-library API so plugins can use the
 * same `logger.info / warn / error / success / step / grid / spinner` surface.
 */
export const logger = {
  colors,
  box:     logBox,
  step:    logStep,
  grid:    logGrid,
  spinner: createSpinner,
  info:    (msg: string) => logBox(msg, 'info'),
  success: (msg: string) => logBox(msg, 'success'),
  warn:    (msg: string) => logBox(msg, 'warn'),
  error:   (msg: string) => logBox(msg, 'error'),
};

export default logger;
