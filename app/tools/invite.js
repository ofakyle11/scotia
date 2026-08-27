'use strict';
// Mint a single-use enrollment invite from the server console.
//   node tools/invite.js partner@firm.ca lawyer "J. Partner"
// Prints the one-time link (24h expiry). Share it over a channel you trust.
const path = require('path');
process.env.CHAMBERS_DATA = process.env.CHAMBERS_DATA || path.join(__dirname, '..', 'data');
const { Keyring } = require('../kernel/crypto.js');
const { Store } = require('../kernel/store.js');
const { Audit } = require('../kernel/audit.js');
const { Auth } = require('../kernel/auth.js');

const [email, role = 'lawyer', name] = process.argv.slice(2);
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('usage: node tools/invite.js <email> [lawyer|clerk|admin] ["Full Name"]');
  process.exit(1);
}
if (!['lawyer', 'clerk', 'admin'].includes(role)) { console.error('role must be lawyer, clerk or admin'); process.exit(1); }

const keyring = new Keyring(process.env.CHAMBERS_DATA);
const store = new Store(process.env.CHAMBERS_DATA, keyring);
const audit = new Audit(process.env.CHAMBERS_DATA);
const auth = new Auth(store, audit);

if (store.firm.list('user', (u) => u.email.toLowerCase() === email.toLowerCase() && u.active).length) {
  console.error('Refusing: an active account already exists for ' + email);
  process.exit(1);
}
const code = auth.createInvite(email, role, name || email, 'console');
if (!code) { console.error(`Refusing: seat lock — this build is limited to ${auth.seatCap()} enrolled accounts.`); process.exit(1); }
console.log(`Single-use invite for ${email} (${role}), expires in 24h:`);
console.log(`  /invite/${code}`);
console.log('Prefix with your deployment URL, e.g. https://chambers.yourfirm.ca/invite/' + code.slice(0, 8) + '…');
