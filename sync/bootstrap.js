// B4 fallback: a private HyperDHT on the local network (no internet, no public DHT).
// Run on ONE laptop (the office PC), then start both peers with FOBE_BOOTSTRAP / --bootstrap.
// Usage: node bootstrap.js [--host <this laptop's LAN IPv4>] [--port 49737]
import os from 'node:os'
import createTestnet from 'hyperdht/testnet.js'

const args = process.argv.slice(2)
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d }
const port = Number(opt('port', 49737))
const lan = Object.values(os.networkInterfaces()).flat()
  .filter(a => a && a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))
const host = opt('host', lan[0]?.address || '127.0.0.1')

// 3 full DHT nodes in this process: node 0 listens on host:port and is the bootstrap address.
const testnet = await createTestnet(3, { host, port })
const addr = `${host}:${port}`

console.log('\n=== FOBE local DHT bootstrap running ===')
console.log(`Address: ${addr}   (other IPv4s here: ${lan.map(a => a.address).filter(a => a !== host).join(', ') || 'none'})\n`)
console.log('Office PC terminal:')
console.log(`  $env:FOBE_BOOTSTRAP="${addr}"; node demo-office.js`)
console.log('Work phone terminal:')
console.log(`  $env:FOBE_BOOTSTRAP="${addr}"; node demo-phone.js <PAIRING-KEY> --backup`)
console.log('\nBoth laptops must be on the same network and able to reach UDP port ' + port + ' here.')
console.log('Keep this window open. Ctrl+C to stop.')

process.on('SIGINT', async () => { await testnet.destroy(); process.exit(0) })
