# ManyPlug

CLI plugin manager for ManyBot.

https://www.npmjs.com/package/@manybot/manyplug

## Installation

```
npm i -g @manybot/manyplug
```

This installs two equivalent commands: `manyplug` and the shorter `mp`.

## Usage

```bash
manyplug <command> [options]
# or, shorter:
mp <command> [options]
```

The available commands are displayed by running `manyplug`. To get help for a specific command, use `manyplug help <command>`.

Common commands, with their aliases:

| Command                     | Alias | Description                                  |
|------------------------------|-------|-----------------------------------------------|
| `init <name>`                 |       | scaffold a new plugin, pluginpack, or profile  |
| `install <plugin...>`         | `i`   | install from the registry or `--local <path>`  |
| `search <query>`              | `s`   | search the registry                            |
| `update`                      | `up`  | reinstall all non-local plugins                |
| `remove <plugin...>`          | `rm`  | remove installed plugins                       |
| `list`                        | `ls`  | list installed plugins                         |
| `enable` / `disable`          | `en` / `dis` | toggle plugins on/off                    |
| `validate <path>`             | `val` | check a plugin's `manyplug.json`               |
| `info <plugin>`               |       | show details about an installed plugin         |

## Configuration

On first run, ManyPlug creates `~/.manybot/manyplug.toml` — it holds the list
of enabled plugins plus a few preferences (interface language, registry URL,
whether to ask for confirmation before destructive actions). Open the file
for the commented list of available keys.

The interface language defaults to `auto` (detected from your system
locale, currently English and Portuguese are available) and can be pinned
with `LANGUAGE = "pt"` in that file, or overridden per-command with the
`MANYPLUG_LANG` environment variable.

## Pluginpacks and profiles

Besides regular plugins, `manyplug init` (with `--type pluginpack` or
`--type profile`) can also scaffold:

- **pluginpack** — a single repo bundling several plugins, each in its own
  subdirectory with its own `manyplug.json`. Installing the pack installs
  every plugin inside it.
- **profile** — just a curated list of plugin keys to install from the
  registry, with no code of its own.

# See also

[ManyPlug documentation](https://manybot.stxerr.dev/docs/manyplug-cli/)

# License

[MIT](LICENSE)
