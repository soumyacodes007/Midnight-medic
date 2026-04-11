import { createServer } from 'node:http';

const PORT = 6300;

const server = createServer((req, res) => {
  res.writeHead(200);
  res.end('Ghost in the Machine: Proof Server Port Hijacked!');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n[!] Error: Port ${PORT} is already in use.`);
    console.error(`    Try running 'midnight-medic doctor --fix' and then try again!\n`);
    process.exit(1);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('\n  -------------------------------------------------------------');
  console.log(`  🔥 ${chalk.bold.red('PORT HIJACKED')}`);
  console.log(`  Target Port: ${PORT} (Proof Server)`);
  console.log('  -------------------------------------------------------------');
  console.log('  I am now simulating a conflicting process.');
  console.log('  The Midnight Medic Doctor should now report an error.');
  console.log('  Run "midnight-medic doctor" in another terminal to see.');
  console.log('  -------------------------------------------------------------\n');
});

// Mock chalk for the one-off script if needed
const chalk = {
    bold: { red: (t) => `\x1b[31;1m${t}\x1b[0m` },
    red: (t) => `\x1b[31m${t}\x1b[0m`,
};
