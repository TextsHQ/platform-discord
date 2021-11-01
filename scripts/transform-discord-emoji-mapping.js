const fs = require('fs')

const _emojis = require('./emojis-raw.json')
const _shortcuts = require('./shortcuts-raw.json')

const emojis = Object.values(_emojis).flat().flatMap(a => a.names.map(b => [b, a.surrogates]))
const shortcuts = _shortcuts.flatMap(a => a.shortcuts.map(b => [b, a.emoji]))

fs.writeFile('./emojis.json', JSON.stringify(emojis), 'utf-8', () => { console.log('Written emojis!') })
fs.writeFile('./shortcuts.json', JSON.stringify(shortcuts), 'utf-8', () => { console.log('Written shortcuts!') })
