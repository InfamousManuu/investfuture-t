const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Helpers ----------
function ensureData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
  if (!fs.existsSync(ADMIN_FILE)) {
    // Default admin: email admin@investfuture.com / password Admin123!
    const hash = bcrypt.hashSync('Admin123!', 10);
    fs.writeFileSync(ADMIN_FILE, JSON.stringify({
      email: 'admin@investfuture.com',
      passwordHash: hash,
      name: 'Platform Admin'
    }, null, 2));
  }
}

function readUsers() {
  ensureData();
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeUsers(users) {
  ensureData();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function readAdmin() {
  ensureData();
  return JSON.parse(fs.readFileSync(ADMIN_FILE, 'utf8'));
}

function authAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || token !== (global.adminToken || '')) {
    return res.status(401).json({ error: 'Unauthorized. Admin login required.' });
  }
  next();
}

ensureData();

// ---------- Public: Register ----------
app.post('/api/register', (req, res) => {
  const { name, email, nationality, password } = req.body || {};
  if (!name || !email || !password || password.length < 6) {
    return res.status(400).json({ error: 'Name, email and password (min 6) required.' });
  }
  const users = readUsers();
  const emailLower = String(email).toLowerCase().trim();
  if (users.find(u => u.email === emailLower)) {
    return res.status(400).json({ error: 'Email already registered.' });
  }
  const user = {
    id: uuidv4(),
    name: name.trim(),
    email: emailLower,
    nationality: nationality || '',
    passwordHash: bcrypt.hashSync(password, 10),
    plan: null,
    stage: 1,
    deposited: false,
    depositAmount: 0,
    balance: 0,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  users.push(user);
  writeUsers(users);
  const { passwordHash, ...safe } = user;
  res.json({ ok: true, user: safe });
});

// ---------- Public: Login ----------
app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required.' });
  }
  const users = readUsers();
  const user = users.find(u => u.email === String(email).toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  const { passwordHash, ...safe } = user;
  res.json({ ok: true, user: safe });
});

// ---------- Public: Get / update own profile ----------
app.get('/api/me/:id', (req, res) => {
  const users = readUsers();
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const { passwordHash, ...safe } = user;
  res.json({ user: safe });
});

app.post('/api/me/:id/plan', (req, res) => {
  const { deposit, target, duration, name } = req.body || {};
  const users = readUsers();
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'User not found.' });
  users[idx].plan = { deposit, target, duration, name };
  users[idx].stage = 1;
  users[idx].deposited = false;
  users[idx].depositAmount = 0;
  users[idx].balance = 0;
  users[idx].updatedAt = new Date().toISOString();
  writeUsers(users);
  const { passwordHash, ...safe } = users[idx];
  res.json({ ok: true, user: safe });
});

app.post('/api/me/:id/confirm-deposit', (req, res) => {
  const users = readUsers();
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'User not found.' });
  const plan = users[idx].plan;
  users[idx].deposited = true;
  users[idx].depositAmount = plan ? plan.deposit : 0;
  users[idx].stage = Math.max(users[idx].stage, 2);
  users[idx].updatedAt = new Date().toISOString();
  writeUsers(users);
  const { passwordHash, ...safe } = users[idx];
  res.json({ ok: true, user: safe });
});

// ---------- Admin: Login ----------
app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body || {};
  const admin = readAdmin();
  if (email !== admin.email || !bcrypt.compareSync(password, admin.passwordHash)) {
    return res.status(401).json({ error: 'Invalid admin credentials.' });
  }
  global.adminToken = uuidv4();
  res.json({ ok: true, token: global.adminToken, name: admin.name });
});

// ---------- Admin: List users ----------
app.get('/api/admin/users', authAdmin, (req, res) => {
  const users = readUsers().map(({ passwordHash, ...u }) => u);
  res.json({ users });
});

// ---------- Admin: Update user stage / deposit / status ----------
app.patch('/api/admin/users/:id', authAdmin, (req, res) => {
  const users = readUsers();
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'User not found.' });

  const { stage, deposited, depositAmount, balance, status, plan, claimPending, payoutAmount } = req.body || {};
  if (stage !== undefined) users[idx].stage = Math.max(1, Math.min(9, Number(stage)));
  if (deposited !== undefined) users[idx].deposited = !!deposited;
  if (depositAmount !== undefined) users[idx].depositAmount = Number(depositAmount);
  if (balance !== undefined) users[idx].balance = Number(balance);
  if (status !== undefined) users[idx].status = status;
  if (plan !== undefined) users[idx].plan = plan;
  if (claimPending !== undefined) users[idx].claimPending = !!claimPending;
  if (payoutAmount !== undefined) users[idx].payoutAmount = Number(payoutAmount);
  if (deposited === true) users[idx].claimPending = false;
  users[idx].updatedAt = new Date().toISOString();
  writeUsers(users);
  const { passwordHash, ...safe } = users[idx];
  res.json({ ok: true, user: safe });
});

// ---------- Admin: Delete user ----------
app.delete('/api/admin/users/:id', authAdmin, (req, res) => {
  let users = readUsers();
  users = users.filter(u => u.id !== req.params.id);
  writeUsers(users);
  res.json({ ok: true });
});

// ---------- Admin: Stats ----------
app.get('/api/admin/stats', authAdmin, (req, res) => {
  const users = readUsers();
  res.json({
    totalUsers: users.length,
    deposited: users.filter(u => u.deposited).length,
    pendingDeposit: users.filter(u => u.plan && !u.deposited).length,
    completed: users.filter(u => u.stage >= 9).length,
    totalDepositVolume: users.reduce((s, u) => s + (u.depositAmount || 0), 0)
  });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Invest Future running on http://localhost:${PORT}`);
  console.log(`Admin login: admin@investfuture.com / Admin123!`);
});
