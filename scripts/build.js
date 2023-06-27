#!/usr/bin/env node
const { build } = require('estrella')
const watch = process.argv.includes("--watch")

build({
  entry: './src/index.ts',
  outfile: './dist/index.js',
  platform: 'node',
  bundle: true,
  tsconfig: './tsconfig.json',
  watch
})
