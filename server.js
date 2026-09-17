'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data.json');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@powerblend.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'PowerBlend123!';
const ADMIN_ACCESS_CODE = process.env.ADMIN_ACCESS_CODE || '12345';
const sessions = new Map();

const emptyData = () => ({ users: [], bookings: [], memberships: [], orders: [] });

function readData() {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return { ...emptyData(), ...data };
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Could not read data.json:', error.message);
    const data = emptyData();
    writeData(data);
    return data;
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  response.end(JSON.stringify(payload));
}

function requestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) request.destroy();
    });
    request.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch (error) { reject(new Error('Request body must be valid JSON.')); }
    });
    request.on('error', reject);
  });
}

function clean(value, maxLength = 500) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function token() {
  return crypto.randomBytes(32).toString('hex');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  if (!stored.startsWith('scrypt:')) return stored === password;
  const [, salt, expected] = stored.split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function authToken(request) {
  const header = request.headers.authorization || '';
  return header.replace(/^Bearer\s+/i, '');
}

function requireAdmin(request, response) {
  const session = sessions.get(authToken(request));
  if (!session || session.role !== 'admin') {
    sendJson(response, 401, { error: 'Administrator authentication is required.' });
    return false;
  }
  return true;
}

function createRecord(data, type, request) {
  const record = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...data,
    type
  };
  const userSession = sessions.get(authToken(request));
  if (userSession && userSession.role === 'user') record.userId = userSession.userId;
  return record;
}

async function handleApi(request, response, url) {
  let body;
  try { body = await requestBody(request); } catch (error) {
    sendJson(response, 400, { error: error.message });
    return;
  }
  const data = readData();

  if (request.method === 'POST' && url.pathname === '/api/auth/signup') {
    const email = clean(body.email, 200).toLowerCase();
    if (!email || !clean(body.password) || !clean(body.firstName)) return sendJson(response, 400, { error: 'First name, email, and password are required.' });
    if (clean(body.password, 200).length < 8) return sendJson(response, 400, { error: 'Password must be at least 8 characters.' });
    if (data.users.some(user => user.email === email)) return sendJson(response, 409, { error: 'An account with that email already exists.' });
    const user = {
      id: crypto.randomUUID(), firstName: clean(body.firstName, 80), lastName: clean(body.lastName, 80),
      email, phone: clean(body.phone, 40), goal: clean(body.goal, 500), newsletter: Boolean(body.newsletter),
      password: hashPassword(clean(body.password, 200)), createdAt: new Date().toISOString()
    };
    data.users.push(user);
    writeData(data);
    const sessionToken = token();
    sessions.set(sessionToken, { role: 'user', userId: user.id });
    const { password, ...publicUser } = user;
    return sendJson(response, 201, { ...publicUser, token: sessionToken });
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/login') {
    const email = clean(body.email, 200).toLowerCase();
    const user = data.users.find(item => item.email === email && verifyPassword(clean(body.password, 200), item.password));
    if (!user) return sendJson(response, 401, { error: 'Invalid email or password.' });
    const sessionToken = token();
    sessions.set(sessionToken, { role: 'user', userId: user.id });
    const { password, ...publicUser } = user;
    return sendJson(response, 200, { ...publicUser, token: sessionToken });
  }

  if (request.method === 'POST' && url.pathname === '/api/admin/login') {
    if (clean(body.email, 200).toLowerCase() !== ADMIN_EMAIL.toLowerCase() ||
        clean(body.password, 200) !== ADMIN_PASSWORD || clean(body.accessCode, 100) !== ADMIN_ACCESS_CODE) {
      return sendJson(response, 401, { error: 'Invalid administrator credentials.' });
    }
    const sessionToken = token();
    sessions.set(sessionToken, { role: 'admin' });
    return sendJson(response, 200, { token: sessionToken, role: 'admin' });
  }

  const collection = { '/api/bookings': 'bookings', '/api/memberships': 'memberships', '/api/orders': 'orders' }[url.pathname];
  if (request.method === 'POST' && collection) {
    const userSession = sessions.get(authToken(request));
    if ((collection === 'memberships' || collection === 'orders') && (!userSession || userSession.role !== 'user')) {
      return sendJson(response, 401, { error: 'Please sign in before submitting this request.' });
    }
    if (collection === 'bookings' && (!clean(body.name) || !clean(body.email))) {
      return sendJson(response, 400, { error: 'Booking name and email are required.' });
    }
    if (collection === 'orders' && (!Array.isArray(body.items) || body.items.length === 0 || !Number.isFinite(Number(body.total)))) {
      return sendJson(response, 400, { error: 'A valid order is required.' });
    }
    const recordData = { ...body };
    if (userSession && userSession.role === 'user') {
      const user = data.users.find(item => item.id === userSession.userId);
      recordData.email = user ? user.email : recordData.email;
    }
    const record = createRecord(recordData, collection.slice(0, -1), request);
    data[collection].push(record);
    writeData(data);
    return sendJson(response, 201, { success: true, record });
  }

  if (request.method === 'GET' && url.pathname === '/api/admin/data') {
    if (!requireAdmin(request, response)) return;
    return sendJson(response, 200, {
      members: data.users.map(({ password, ...user }) => user),
      memberships: data.memberships, bookings: data.bookings, orders: data.orders
    });
  }
  sendJson(response, 404, { error: 'API endpoint not found.' });
}

function serveStatic(request, response, url) {
  let requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const filePath = path.resolve(ROOT, '.' + requested);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) return sendJson(response, 403, { error: 'Forbidden.' });
  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) return sendJson(response, 404, { error: 'File not found.' });
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
    response.writeHead(200, { 'Content-Type': types[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(response);
  });
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (request.method === 'OPTIONS') {
    response.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
    return response.end();
  }
  if (url.pathname.startsWith('/api/')) return handleApi(request, response, url).catch(error => sendJson(response, 500, { error: 'Internal server error.' }));
  if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'Method not allowed.' });
  serveStatic(request, response, url);
});

server.listen(PORT, () => console.log(`Powerblend server running at http://localhost:${PORT}`));
