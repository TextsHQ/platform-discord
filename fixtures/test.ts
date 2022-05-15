/* eslint-disable import/no-extraneous-dependencies */
global.texts = { error: console.error, log: console.log }
// has no effect:
// require('@textshq/platform-test-lib')

const { mapMessage } = require('../src/mappers/mappers')
const json = require('./message-codes.json')

console.log(JSON.stringify(mapMessage(json), null, 2))
