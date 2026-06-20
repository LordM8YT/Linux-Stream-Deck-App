const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

class LinuxActiveWindowService {
  constructor({ pollIntervalMs = 2000, onFocusChanged = null, platform = process.platform, environment = process.env } = {}) {
    this.pollIntervalMs = pollIntervalMs;
    this.onFocusChanged = onFocusChanged;
    this.platform = platform;
    this.environment = environment;
    this.interval = null;
    this.lastSnapshotKey = null;
    this.lastState = createInactiveState();
  }

  async start() {
    if (this.platform !== 'linux') {
      this.lastState = {
        ...createInactiveState(),
        supported: false,
        lastError: 'Dynamic profile switching is currently only implemented for Linux.'
      };
      return;
    }

    await this.pollNow();
    this.interval = setInterval(() => {
      void this.pollNow();
    }, this.pollIntervalMs);
  }

  async dispose() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  getState() {
    return this.lastState;
  }

  async pollNow() {
    const nextState = await detectActiveWindow(this.environment);
    const nextSnapshotKey = buildSnapshotKey(nextState);

    this.lastState = nextState;

    if (nextSnapshotKey && nextSnapshotKey !== this.lastSnapshotKey) {
      this.lastSnapshotKey = nextSnapshotKey;

      if (typeof this.onFocusChanged === 'function') {
        await this.onFocusChanged(nextState);
      }
    }
  }
}

async function detectActiveWindow(environment) {
  try {
    if (environment.HYPRLAND_INSTANCE_SIGNATURE) {
      return await detectHyprlandWindow();
    }

    if (environment.XDG_SESSION_TYPE === 'x11' || environment.DISPLAY) {
      return await detectX11Window();
    }

    if (String(environment.XDG_CURRENT_DESKTOP || '').toLowerCase().includes('gnome')) {
      return await detectGnomeWaylandWindow();
    }

    return {
      ...createInactiveState(),
      supported: false,
      backend: 'wayland',
      lastError: 'No supported Linux window-focus backend was detected. Add a compositor-specific adapter for this desktop environment.'
    };
  } catch (error) {
    return {
      ...createInactiveState(),
      backend: inferBackend(environment),
      lastError: error.message
    };
  }
}

async function detectHyprlandWindow() {
  const { stdout } = await execFileAsync('hyprctl', ['activewindow', '-j']);
  const payload = JSON.parse(stdout || '{}');

  return {
    supported: true,
    backend: 'hyprland',
    title: payload.title || '',
    processName: payload.class || '',
    appId: payload.initialClass || payload.class || '',
    pid: Number.isFinite(payload.pid) ? payload.pid : null,
    detectedAt: new Date().toISOString(),
    lastError: null
  };
}

async function detectX11Window() {
  const { stdout: windowIdRaw } = await execFileAsync('xdotool', ['getactivewindow']);
  const windowId = windowIdRaw.trim();

  if (!windowId) {
    throw new Error('xdotool did not return an active window id.');
  }

  const [{ stdout: titleRaw }, { stdout: pidRaw }] = await Promise.all([
    execFileAsync('xdotool', ['getwindowname', windowId]),
    execFileAsync('xdotool', ['getwindowpid', windowId])
  ]);
  const pid = Number(pidRaw.trim()) || null;
  const processName = pid ? await readProcessName(pid) : '';

  return {
    supported: true,
    backend: 'x11',
    title: titleRaw.trim(),
    processName,
    appId: processName,
    pid,
    detectedAt: new Date().toISOString(),
    lastError: null
  };
}

async function detectGnomeWaylandWindow() {
  const script = [
    'const w = global.display.get_focus_window();',
    'w ? JSON.stringify({',
    'title: w.get_title(),',
    'wmClass: w.get_wm_class ? w.get_wm_class() : null,',
    'sandboxedAppId: w.get_sandboxed_app_id ? w.get_sandboxed_app_id() : null,',
    'pid: w.get_pid ? w.get_pid() : null',
    '}) : "";'
  ].join('');
  const { stdout } = await execFileAsync('gdbus', [
    'call',
    '--session',
    '--dest',
    'org.gnome.Shell',
    '--object-path',
    '/org/gnome/Shell',
    '--method',
    'org.gnome.Shell.Eval',
    script
  ]);
  const payload = parseGnomeShellEval(stdout);
  const pid = Number(payload.pid) || null;
  const processName = payload.sandboxedAppId || payload.wmClass || (pid ? await readProcessName(pid) : '');

  return {
    supported: true,
    backend: 'gnome-wayland',
    title: payload.title || '',
    processName,
    appId: payload.sandboxedAppId || payload.wmClass || '',
    pid,
    detectedAt: new Date().toISOString(),
    lastError: null
  };
}

function parseGnomeShellEval(stdout) {
  const match = String(stdout || '').match(/\(true,\s*'?(.*)'?\)$/);

  if (!match?.[1]) {
    throw new Error('GNOME Shell focus query returned an unexpected response.');
  }

  const normalized = match[1]
    .replace(/^"+|"+$/g, '')
    .replace(/\\"/g, '"');

  if (!normalized) {
    throw new Error('GNOME Shell did not report a focused window.');
  }

  return JSON.parse(normalized);
}

async function readProcessName(pid) {
  const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'comm=']);
  return stdout.trim();
}

function buildSnapshotKey(activeWindow) {
  if (!activeWindow?.supported) {
    return null;
  }

  return [
    activeWindow.backend,
    activeWindow.processName,
    activeWindow.title,
    activeWindow.pid
  ].join('|');
}

function inferBackend(environment) {
  if (environment.HYPRLAND_INSTANCE_SIGNATURE) {
    return 'hyprland';
  }

  if (environment.XDG_SESSION_TYPE === 'x11' || environment.DISPLAY) {
    return 'x11';
  }

  return 'wayland';
}

function createInactiveState() {
  return {
    supported: true,
    backend: null,
    title: '',
    processName: '',
    appId: '',
    pid: null,
    detectedAt: null,
    lastError: null
  };
}

module.exports = {
  LinuxActiveWindowService
};
