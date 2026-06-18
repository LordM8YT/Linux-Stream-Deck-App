module.exports.activate = async ({ registerAction }) => {
  registerAction(createOpenUrlAction());
  registerAction(createLaunchAppAction());
  registerAction(createRunCommandAction());
};

function createOpenUrlAction() {
  return {
    id: 'open-url',
    configFields: [
      {
        id: 'url',
        label: 'URL or protocol',
        type: 'text',
        description: 'Use a full URL like https://obsproject.com or a custom protocol like steam://run/730.',
        defaultValue: '',
        placeholder: 'https://example.com'
      }
    ],
    onTrigger: async ({ assignment, services }) => {
      const url = assignment?.config?.url;

      if (!url) {
        throw new Error('No URL is configured for this key.');
      }

      return services.system.openUrl(url);
    }
  };
}

function createLaunchAppAction() {
  return {
    id: 'launch-app',
    configFields: [
      {
        id: 'command',
        label: 'App or executable',
        type: 'text',
        description: 'Use an executable name from PATH like firefox or a full path to an app or script.',
        defaultValue: '',
        placeholder: 'firefox'
      },
      {
        id: 'args',
        label: 'Arguments',
        type: 'text',
        description: 'Optional arguments. Quotes are supported for paths with spaces.',
        defaultValue: '',
        placeholder: '--new-window https://twitch.tv'
      },
      {
        id: 'workingDirectory',
        label: 'Working directory',
        type: 'text',
        description: 'Optional start folder. Use ~ for your home directory.',
        defaultValue: '',
        placeholder: '~/Projects'
      }
    ],
    onTrigger: async ({ assignment, services }) => {
      const command = assignment?.config?.command;

      if (!command) {
        throw new Error('No application command is configured for this key.');
      }

      return services.system.launchApp({
        command,
        args: assignment?.config?.args,
        workingDirectory: assignment?.config?.workingDirectory
      });
    }
  };
}

function createRunCommandAction() {
  return {
    id: 'run-command',
    configFields: [
      {
        id: 'commandLine',
        label: 'Command line',
        type: 'text',
        description: 'Run a shell command. Keep it short and predictable for live use.',
        defaultValue: '',
        placeholder: 'echo OpenDeck'
      },
      {
        id: 'workingDirectory',
        label: 'Working directory',
        type: 'text',
        description: 'Optional start folder. Use ~ for your home directory.',
        defaultValue: '',
        placeholder: '~/Projects'
      },
      {
        id: 'timeoutMs',
        label: 'Timeout (ms)',
        type: 'number',
        description: 'How long OpenDeck should wait before failing the command.',
        defaultValue: 15000,
        placeholder: '15000'
      }
    ],
    onTrigger: async ({ assignment, services }) => {
      const commandLine = assignment?.config?.commandLine;

      if (!commandLine) {
        throw new Error('No shell command is configured for this key.');
      }

      return services.system.runCommand({
        commandLine,
        workingDirectory: assignment?.config?.workingDirectory,
        timeoutMs: assignment?.config?.timeoutMs
      });
    }
  };
}
