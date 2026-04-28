# ManyPlug

CLI plugin manager for ManyBot.

## Install

```bash
npm install -g @freakk.dev/manyplug
# or
npm link  # for development
```

## Usage

```bash
# Get help
manyplug help [command]

# Create new plugin
manyplug init my-plugin --category games

# Install from repository
manyplug install many-ai

# Install plugin from local path
manyplug install --local ../my-plugin

# List installed plugins
manyplug list

# Validate manyplug.json
manyplug validate
manyplug validate ./my-plugin
```
