# ManyPlug

CLI plugin manager for ManyBot.

## Install

```bash
npm install -g manyplug
# or
npm link  # for development
```

## Usage

```bash
# Create new plugin
manyplug init my-plugin --category games

# Install plugin from local path
manyplug install --local ../my-plugin

# List installed plugins
manyplug list

# Validate manyplug.json
manyplug validate
manyplug validate ./my-plugin
```

## Commands

| Command | Description |
|---------|-------------|
| `init <name>` | Create new plugin boilerplate |
| `install [name]` | Install from registry or `--local <path>` |
| `list` | List installed plugins |
| `validate [path]` | Validate manyplug.json |

## Plugin Structure

```
my-plugin/
├── manyplug.json     # Plugin metadata
├── index.js          # Entry point
└── locale/           # Translations
    └── pt.json
```

### manyplug.json

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "category": "games",
  "service": false,
  "dependencies": {}
}
```

**Categories:** games, media, utility, service, admin, fun
