export interface CliOption {
  flag: string;        // e.g. "--model"
  argName?: string;    // e.g. "<model>"
  description: string; // e.g. "Model for the current session..."
}

export interface CliCommand {
  name: string;        // e.g. "auth"
  description: string; // e.g. "Manage authentication"
}

export interface CliCapabilities {
  models: string[];
  permissionModes: string[];
  flags: string[];
  options: CliOption[];
  commands: CliCommand[];
}

export const EMPTY_CLI_CAPABILITIES: CliCapabilities = {
  models: [],
  permissionModes: [],
  flags: [],
  options: [],
  commands: [],
};

export interface SlashCommand {
  cmd: string;
  desc: string;
}
