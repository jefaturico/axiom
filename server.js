const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const chokidar = require('chokidar');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- Config ---
const PORT = 8000;
const WATCH_DIR = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();

console.log(`Server starting on http://localhost:${PORT}`);
console.log(`Watching directory: ${WATCH_DIR}`);

// --- State ---
let graphData = { nodes: [], links: [], palette: [] };

// Cache: Map<absPath, { id: string, name: string, links: Array<{type: 'wiki'|'std', target: string}> }>
// Stores the *raw* parsed data for each file.
const fileCache = new Map();

// --- Config Loading ---
let appConfig = {};
const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            appConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
            console.log("Loaded config.json");
        }
    } catch (e) {
        console.error("Error loading config:", e.message);
    }
}
loadConfig();

// --- Helper: Load Pywal ---
const WAL_PATH = path.join(os.homedir(), ".cache", "wal", "colors.json");

function loadPalette() {
    const defaultPalette = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"];

    // 1. Try Pywal
    try {
        if (fs.existsSync(WAL_PATH)) {
            const data = JSON.parse(fs.readFileSync(WAL_PATH, 'utf8'));
            if (data.colors) {
                const keys = Object.keys(data.colors).sort((a, b) => {
                    return parseInt(a.replace('color', '')) - parseInt(b.replace('color', ''));
                });
                const colors = keys.map(k => data.colors[k]);
                console.log(`Loaded ${colors.length} colors from Pywal`);
                return colors;
            }
        }
    } catch (e) {
        console.error("Could not load Pywal colors:", e.message);
    }

    // 2. Try Config
    if (appConfig.visuals && appConfig.visuals.palette && Array.isArray(appConfig.visuals.palette)) {
        console.log("Using palette from config.json");
        return appConfig.visuals.palette;
    }

    // 3. Fallback
    console.log("Using default palette");
    return defaultPalette;
}

let palette = loadPalette();

// Watch Pywal colors
chokidar.watch(WAL_PATH).on('change', () => {
    console.log("Pywal colors changed, reloading...");
    palette = loadPalette();
    if (graphData) {
        graphData.palette = palette;
        io.emit('graph-update', graphData);
    }
});

chokidar.watch(CONFIG_PATH).on('change', () => {
    console.log("Config changed, reloading...");
    loadConfig();
    // Reload palette in case config palette changed
    palette = loadPalette();
    if (graphData) graphData.palette = palette;

    triggerUpdate();
});

// --- Parsing Logic ---
const WIKILINK_RE = /\[\[(.*?)\]\]/g;
const STD_LINK_RE = /\[.*?\]\((.*?)\)/g;

// Helper: Parse a single file content and return raw links
function extractLinks(content) {
    const rawLinks = [];
    let match;

    const wikiRe = new RegExp(WIKILINK_RE);
    const stdRe = new RegExp(STD_LINK_RE);

    // Wikilinks
    while ((match = wikiRe.exec(content)) !== null) {
        let target = match[1].split('|')[0].trim();
        target = target.split('#')[0];
        if (target) rawLinks.push({ type: 'wiki', target });
    }

    // Standard Links
    while ((match = stdRe.exec(content)) !== null) {
        let target = match[1].trim();
        if (target.startsWith('http') || target.startsWith('#')) continue;
        target = target.split('#')[0];
        if (target) rawLinks.push({ type: 'std', target });
    }

    return rawLinks;
}

// Helper: Update Cache for a file (Async)
async function updateCacheForFile(absPath) {
    try {
        const content = await fs.promises.readFile(absPath, 'utf8');
        const rawLinks = extractLinks(content);
        const relPath = path.relative(WATCH_DIR, absPath);
        const name = path.basename(relPath, '.md');

        // Debug Log
        // console.log(`Parsed ${relPath}: found ${rawLinks.length} links`);

        fileCache.set(absPath, {
            id: relPath, // Use relative path as stable ID
            name: name,
            links: rawLinks
        });
    } catch (e) {
        console.error(`Error processing ${absPath}: ${e.message}`);
        fileCache.delete(absPath); // Ensure clean state if read fails
    }
}

// --- Main Update Loop ---
async function updateGraph() {
    // 1. Fill Cache Gaps
    // We iterate watchedFiles. If not in cache, we parse it.
    // (Cache invalidation happens in watcher events)
    const updatePromises = [];
    for (const absPath of watchedFiles) {
        if (!fileCache.has(absPath)) {
            updatePromises.push(updateCacheForFile(absPath));
        }
    }

    if (updatePromises.length > 0) {
        // console.log(`Parsing ${updatePromises.length} changed files...`);
        await Promise.all(updatePromises);
    }

    // 2. Build Global Indices (InMemory - Fast)
    // We only use cached data here.
    const nodes = [];
    const links = [];
    const idMap = new Map();   // id -> node
    const nameMap = new Map(); // name -> id (for wikilink fuzzy match)

    // Pass 1: Nodes & Indices
    for (const [absPath, data] of fileCache) {
        // Only include if currently watched (handle checking race conditions)
        if (!watchedFiles.has(absPath)) continue;

        const node = { id: data.id };
        nodes.push(node);
        idMap.set(data.id, node);

        // If duplicates exist, last one wins (simple resolution)
        nameMap.set(data.name, data.id);
    }

    // Pass 2: Resolve Links
    for (const [absPath, data] of fileCache) {
        if (!watchedFiles.has(absPath)) continue;

        const sourceId = data.id;

        for (const link of data.links) {
            let targetId = null;

            if (link.type === 'wiki') {
                // Wikilink Logic
                // 1. Exact ID match
                if (idMap.has(link.target)) targetId = link.target;
                // 2. ID + .md
                else if (idMap.has(link.target + ".md")) targetId = link.target + ".md";
                // 3. Name match
                else if (nameMap.has(link.target)) targetId = nameMap.get(link.target);
            } else {
                // Standard Link Logic
                // Try relative path resolution
                try {
                    const dir = path.dirname(absPath);
                    const absTarget = path.resolve(dir, link.target);
                    const relTarget = path.relative(WATCH_DIR, absTarget);
                    if (idMap.has(relTarget)) targetId = relTarget;
                } catch (e) { }

                // Fallback to name match
                if (!targetId) {
                    const targetName = path.basename(link.target, '.md');
                    if (nameMap.has(targetName)) targetId = nameMap.get(targetName);
                }
            }

            if (targetId) {
                links.push({ source: sourceId, target: targetId });
            }
        }
    }

    // 3. Emit
    const newData = { nodes, links, palette, config: appConfig };

    // Version Check
    // We can just emit. Socket.io handles binary diffs efficiently usually, but JSON stringify is fast for metadata.
    const newJson = JSON.stringify(newData);
    const oldJson = JSON.stringify(graphData);

    if (newJson !== oldJson) {
        graphData = newData;
        io.emit('graph-update', graphData);
        // console.log(`Graph updated: ${nodes.length} nodes, ${links.length} links`);
    }
}

// --- Watcher ---
const watcher = chokidar.watch(WATCH_DIR, {
    ignored: [
        /(^|[\/\\])\../,       // Dotfiles
        '**/node_modules/**',  // Dependencies
        '**/README.md',        // Project metadata
        '**/LICENSE*',         // License files
        '**/CHANGELOG.md',
        '**/CONTRIBUTING.md'
    ],
    persistent: true,
    ignoreInitial: false
});

let watchedFiles = new Set();
let debounceTimer;

function triggerUpdate() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(updateGraph, 100);
}

watcher
    .on('add', absPath => {
        if (absPath.endsWith('.md')) {
            watchedFiles.add(absPath);
            // Not in cache yet, updateGraph will fetch it
            triggerUpdate();
        }
    })
    .on('change', absPath => {
        if (absPath.endsWith('.md')) {
            // Invalidate cache
            fileCache.delete(absPath);
            triggerUpdate();
        }
    })
    .on('unlink', absPath => {
        if (absPath.endsWith('.md')) {
            watchedFiles.delete(absPath);
            fileCache.delete(absPath); // Clean up memory
            triggerUpdate();
        }
    });

// --- Server ---
app.use(express.static('public'));
app.use(express.json());



io.on('connection', (socket) => {
    socket.emit('graph-update', graphData);
});

server.listen(PORT, () => {
    // console.log(`Listening on *:${PORT}`);
    const url = `http://localhost:${PORT}`;
    const { exec } = require('child_process');

    let command;
    switch (os.platform()) {
        case 'darwin':
            command = `open "${url}"`;
            break;
        case 'win32':
            command = `start "${url}"`;
            break;
        default: // linux, etc
            command = `xdg-open "${url}"`;
            break;
    }

    if (command) {
        console.log(`Opening browser: ${command}`);
        exec(command, (err) => {
            if (err) console.error("Failed to open browser:", err.message);
        });
    }
});
