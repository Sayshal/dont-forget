// Thanks gambit (github.com/gambit07) for letting me test with his workflow!
let fs = require('fs')
console.log(JSON.parse(fs.readFileSync('./module.json', 'utf8')).version)