const os = require('node:os');
const path = require('node:path');
const { exec, spawn } = require('node:child_process');
const electron = require('electron');
const electronShell = electron?.shell || null;

class SystemActionService {
  async openUrl(rawUrl) {
    if (!electronShell) {
      throw new Error('Open URL requires the Electron desktop runtime.');
    }

    const url = normalizeUrl(rawUrl);
    await electronShell.openExternal(url);

    return {
      url
    };
  }

  async launchApp({
    command,
    args = '',
    workingDirectory = ''
  }) {
    const normalizedCommand = String(command || '').trim();

    if (!normalizedCommand) {
      throw new Error('A command or application path is required.');
    }

    const normalizedWorkingDirectory = normalizeWorkingDirectory(workingDirectory);
    const normalizedArgs = tokenizeArguments(args);

    const pid = await new Promise((resolve, reject) => {
      const child = spawn(normalizedCommand, normalizedArgs, {
        cwd: normalizedWorkingDirectory || undefined,
        detached: true,
        shell: false,
        stdio: 'ignore',
        windowsHide: true
      });

      child.once('error', (error) => {
        reject(new Error(`Failed to launch "${normalizedCommand}": ${error.message}`));
      });

      child.once('spawn', () => {
        child.unref();
        resolve(child.pid ?? null);
      });
    });

    return {
      command: normalizedCommand,
      args: normalizedArgs,
      workingDirectory: normalizedWorkingDirectory,
      pid
    };
  }

  async runCommand({
    commandLine,
    workingDirectory = '',
    timeoutMs = 15000
  }) {
    const normalizedCommandLine = String(commandLine || '').trim();

    if (!normalizedCommandLine) {
      throw new Error('A command line is required.');
    }

    const normalizedWorkingDirectory = normalizeWorkingDirectory(workingDirectory);
    const parsedTimeoutMs = normalizeTimeout(timeoutMs);

    return new Promise((resolve, reject) => {
      exec(normalizedCommandLine, {
        cwd: normalizedWorkingDirectory || undefined,
        timeout: parsedTimeoutMs,
        maxBuffer: 1024 * 1024,
        windowsHide: true
      }, (error, stdout, stderr) => {
        const stdoutText = String(stdout || '').trim();
        const stderrText = String(stderr || '').trim();

        if (error) {
          reject(formatCommandError({
            commandLine: normalizedCommandLine,
            timeoutMs: parsedTimeoutMs,
            error,
            stderrText
          }));
          return;
        }

        resolve({
          commandLine: normalizedCommandLine,
          workingDirectory: normalizedWorkingDirectory,
          timeoutMs: parsedTimeoutMs,
          stdout: trimCommandOutput(stdoutText),
          stderr: trimCommandOutput(stderrText)
        });
      });
    });
  }
}

function normalizeUrl(rawUrl) {
  const value = String(rawUrl || '').trim();

  if (!value) {
    throw new Error('A URL is required.');
  }

  const normalized = hasScheme(value) ? value : `https://${value}`;

  try {
    return new URL(normalized).toString();
  } catch (_error) {
    throw new Error(`"${value}" is not a valid URL or protocol target.`);
  }
}

function hasScheme(value) {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function normalizeWorkingDirectory(workingDirectory) {
  const value = String(workingDirectory || '').trim();

  if (!value) {
    return '';
  }

  if (value === '~') {
    return os.homedir();
  }

  if (value.startsWith(`~${path.sep}`) || value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
}

function normalizeTimeout(timeoutMs) {
  const parsed = Number(timeoutMs);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 15000;
  }

  return Math.min(Math.round(parsed), 120000);
}

function tokenizeArguments(rawArgs) {
  const input = String(rawArgs || '').trim();

  if (!input) {
    return [];
  }

  const tokens = [];
  let current = '';
  let quote = null;
  let escaped = false;

  for (const character of input) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }

    if (character === '\\') {
      escaped = true;
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }

    if (character === '"' || character === '\'') {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += character;
  }

  if (escaped) {
    current += '\\';
  }

  if (quote) {
    throw new Error('Arguments contain an unmatched quote.');
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function formatCommandError({
  commandLine,
  timeoutMs,
  error,
  stderrText
}) {
  if (error.killed) {
    return new Error(`Command timed out after ${timeoutMs}ms: ${commandLine}`);
  }

  if (stderrText) {
    return new Error(stderrText);
  }

  if (typeof error.code === 'number') {
    return new Error(`Command exited with code ${error.code}: ${commandLine}`);
  }

  return new Error(error.message || `Failed to run command: ${commandLine}`);
}

function trimCommandOutput(output) {
  if (!output) {
    return '';
  }

  const maxLength = 600;

  if (output.length <= maxLength) {
    return output;
  }

  return `...${output.slice(output.length - maxLength)}`;
}

module.exports = {
  SystemActionService
};
