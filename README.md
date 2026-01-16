# axiom

It shows your markdown notes as a quasi-interactive graph. It's fast, it looks good, and it doesn't have any unnecessary features.

## Why?

Because the other ones are slow, bloated, or proprietary. This one uses D3.js and is optimized to handle a ton of notes without stuttering. It's just a viewer. It does one thing and doesn't get in your way.

## Controls

It's got Vim bindings. Cause why not?

| Key | Action |
| :--- | :--- |
| `h` `j` `k` `l` | Move around |
| `+` / `-` | Zoom |
| `Arrow Keys` | Also move around (if you must) |

### ⚠️ DISABLE VIMIUM

If you have Vimium, Tridactyl or any such extension enabled, it's going to fuck with the keypresses and the graph won't move. Disable it for this tab. There's a big warning on the screen about it (you can toggle it off in the config if you don't want to see it).

## Config

Change the parameters to your heart's content in `config.json`. It hot-reloads, so just save the file and the graph updates.

*   `physics`: Tweaks how bouncy/floaty the nodes are.
*   `visuals`: Change node size, UI elements and colors.
*   `controls`: Sensitivity settings if it's too fast/slow for you.

## Colors (Pywal)

If you use `pywal`, it grabs your colors from `~/.cache/wal/colors.json`. Change your wallpaper, run `wal`, and the graph updates instantly. If you don't use pywal, it uses a default palette that looks fine. You can also set the colors in `config.json`.

## Installation

### Binaries (Recommended)
Download the latest release for your OS from the [Releases](https://github.com/jefaturico/axiom/releases) page.

*   **Windows**: Run `axiom-win.exe`.
*   **macOS**: Run `axiom-macos`. (Note: you may need to Right Click -> Open to bypass the unverified developer warning).
*   **Linux**: Run `axiom-linux` (Standard distros). For NixOS, see below.

### From Source
You need Node.js.

1.  Install deps:
    ```bash
    npm install
    ```

2.  Run it:
    ```bash
    node server.js /path/to/your/notes or just ./axiom-linux
    ```

If you don't provide a path, it looks in the current directory. If the directory is empty, it tells you. It recursively matches all files with the `.md` extension.

## Disclaimer

This entire project was vibe-coded. I don't have the time nor the will to thoroughly test it except for the specific use case I have in mind. If you have any issues or bugs, feel free to open an issue or PR and I'll see what I can do.
