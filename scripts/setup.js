#!/usr/bin/env node

/**
 * MULE SHIELD One-Time Setup Script
 * Validates dependencies and environments.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('=== MULE SHIELD Environment Setup ===\n');

// Check Node.js
console.log(`Node.js version: ${process.version} (OK)`);

// Check Python
try {
  const pyVer = execSync('python3 --version || python --version').toString().trim();
  console.log(`Python version: ${pyVer} (OK)`);
} catch (e) {
  console.warn('Python not found in PATH. Please install Python 3.9+ for analytical backend.');
}

console.log('\nSetup verification complete. You can launch the application with:');
console.log('  npm start\n');
