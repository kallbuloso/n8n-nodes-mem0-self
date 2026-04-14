const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'nodes', 'Mem0', 'mem0.svg');
const target = path.join(root, 'dist', 'nodes', 'Mem0', 'mem0.svg');

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(source, target);

console.log('Copied asset:', target);
