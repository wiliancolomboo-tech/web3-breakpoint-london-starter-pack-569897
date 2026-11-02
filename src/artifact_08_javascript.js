#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectName = process.argv[2] || "my-breakpoint-hack";
const targetPath = path.resolve(process.cwd(), projectName);

console.log(`\x1b[35m[Breakpoint London Starter Pack]\x1b[0m Scaffolding \x1b[32m${projectName}\x1b[0m...`);

if (fs.existsSync(targetPath)) {
  console.error(`Error: Directory ${projectName} already exists.`);
  process.exit(1);
}

fs.mkdirSync(targetPath, { recursive: true });
fs.writeFileSync(path.join(targetPath, 'package.json'), JSON.stringify({
  name: projectName,
  version: "1.0.0",
  scripts: {
    "test": "anchor test",
    "faucet": "solana airdrop 2"
  },
  dependencies: {
    "@coral-xyz/anchor": "^0.30.1",
    "@solana/web3.js": "^1.95.3"
  }
}, null, 2));

console.log(`\x1b[32m✓\x1b[0m Initialized package manifest.`);
console.log(`\x1b[36mNext steps:\x1b[0m`);
console.log(`  cd ${projectName}`);
console.log(`  npm install`);
console.log(`  solana config set --url https://api.devnet.solana.com`);
console.log(`\x1b[32mReady for Breakpoint London Hackathon! 🚀\x1b[0m`);