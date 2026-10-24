#!/usr/bin/env node
// Finds out WHY the server cannot reach the database, one step at a time:
//   1. is DATABASE_URL set and readable   2. does the host name resolve (and to which addresses)
//   3. can Node open a TCP connection to each address   4. does the encrypted login work
//   5. are the MediTrac tables there
// Run it from the server folder:   npm run check:db
const path = require('path');
const dns = require('dns');
const net = require('net');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Client } = require('pg');
const { connectionHint } = require('../dbCheck');
const { describeError } = require('../errors');

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  /* old Node */
}

const ok = (msg) => console.log(`  OK    ${msg}`);
const bad = (msg) => console.log(`  FAIL  ${msg}`);
const info = (msg) => console.log(`        ${msg}`);

function tcpConnect(address, port, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.connect({ host: address, port });
    const finish = (result) => {
      socket.destroy();
      resolve({ ...result, ms: Date.now() - started });
    };
    socket.setTimeout(timeoutMs, () => finish({ ok: false, reason: `no answer after ${timeoutMs / 1000} seconds` }));
    socket.on('connect', () => finish({ ok: true }));
    socket.on('error', (err) => finish({ ok: false, reason: describeError(err) }));
  });
}

(async () => {
  console.log('\nMediTrac database check\n');
  console.log(`Node ${process.version}\n`);

  // 1. DATABASE_URL
  console.log('1. DATABASE_URL');
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    bad('DATABASE_URL is not set. Create server/.env from .env.example (HOSTING.md explains).');
    process.exit(1);
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    bad('DATABASE_URL is not a valid address. Check for spaces, a missing "postgresql://", or an unencoded special character in the password (@ must be %40).');
    process.exit(1);
  }
  const port = Number(url.port || 5432);
  ok(`user "${decodeURIComponent(url.username)}", host ${url.hostname}, port ${port}, database "${url.pathname.slice(1)}" (password hidden)`);
  if (/\[|\]/.test(raw)) bad('The connection string still contains square brackets. Replace [YOUR-PASSWORD] with the password and delete the brackets.');

  // 2. DNS
  console.log('\n2. Finding the host');
  let addresses = [];
  try {
    addresses = await dns.promises.lookup(url.hostname, { all: true });
    ok(`${url.hostname} -> ${addresses.map((a) => `${a.address} (IPv${a.family})`).join(', ')}`);
  } catch (err) {
    bad(`could not find ${url.hostname}: ${describeError(err)}`);
    info('Check your internet connection and copy the connection string again from Supabase.');
    process.exit(1);
  }

  // 3. TCP, per address
  console.log('\n3. Opening a connection from Node (the same way the server does)');
  const results = [];
  for (const a of addresses) {
    const r = await tcpConnect(a.address, port, 6000);
    results.push({ ...a, ...r });
    (r.ok ? ok : bad)(`${a.address} (IPv${a.family}): ${r.ok ? `connected in ${r.ms} ms` : r.reason}`);
  }
  const anyTcp = results.some((r) => r.ok);
  const ipv6Down = results.some((r) => r.family === 6 && !r.ok) && results.some((r) => r.family === 4 && r.ok);
  if (!anyTcp) {
    console.log('\nNode cannot open a connection to the database at all.');
    info('If PowerShell\'s  Test-NetConnection  to the same host and port says True, something on this computer is blocking Node:');
    info('a firewall or antivirus rule for node.exe. Allow "Node.js JavaScript Runtime" through Windows Firewall / your antivirus, then try again.');
    info('Otherwise your network blocks this port: try port 6543 in DATABASE_URL, a phone hotspot, or turn the VPN off.');
    process.exit(1);
  }
  if (ipv6Down) info('Note: the IPv6 address does not work on this network, but IPv4 does. The server already tries IPv4 first, so this is fine.');

  // 4. Encrypted login
  console.log('\n4. Logging in (encrypted connection, up to 20 seconds)');
  const useSsl = process.env.DB_SSL === 'true' || (process.env.DB_SSL !== 'false' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname));
  const client = new Client({ connectionString: raw, ssl: useSsl ? { rejectUnauthorized: false } : false, connectionTimeoutMillis: 20000 });
  const started = Date.now();
  try {
    await client.connect();
    const { rows } = await client.query('select version() as v');
    ok(`logged in in ${Date.now() - started} ms${useSsl ? ' (encrypted)' : ''}`);
    info(rows[0].v.slice(0, 70));
  } catch (err) {
    bad(describeError(err));
    console.log('\n' + connectionHint(err));
    if (/timeout|timed out/i.test(String(err.message))) {
      info('');
      info('The connection opens (step 3) but the login never finishes. The usual causes:');
      info(' - antivirus or a firewall that scans encrypted traffic: temporarily switch off its "web/HTTPS/SSL scanning" and try again;');
      info(' - the Supabase project is paused or still starting: open it in the Supabase dashboard and wait until it says Healthy;');
      info(' - a very slow connection: run this check again.');
    }
    await client.end().catch(() => {});
    process.exit(1);
  }

  // 5. Tables
  console.log('\n5. The MediTrac tables');
  try {
    const { rows } = await client.query("select table_name from information_schema.tables where table_schema = 'public'");
    const have = new Set(rows.map((r) => r.table_name));
    const missing = ['users', 'pharmacies', 'medications', 'tracked_medications'].filter((t) => !have.has(t));
    if (missing.length) {
      bad(`missing: ${missing.join(', ')}. Run server/schema.sql in the Supabase SQL Editor.`);
    } else {
      ok('users, pharmacies, medications and tracked_medications all exist');
    }
  } finally {
    await client.end().catch(() => {});
  }
  console.log('\nThe database is reachable. Start the server with:  npm start\n');
})();
