const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const crypto = require("crypto"); // for admin tokens
const app = express();
const PORT = 3000;

// Dynamic import for node-fetch v3+
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// JSONBin Configuration
const JSONBIN_API_KEY = '$2a$10$nCBLclxfTfVHOJVQH1rRSOq.M/Ds19fpLw1sEX7k9IREVmxidVeBS';
const USERS_BIN_ID = '69373ad3d0ea881f401b8107'; // Replace with your users bin ID

// JSONBin API URL
const USERS_URL = `https://api.jsonbin.io/v3/b/${USERS_BIN_ID}`;

const headers = {
  'Content-Type': 'application/json',
  'X-Master-Key': JSONBIN_API_KEY,
  'X-Bin-Version': 'latest'
};

app.use(express.json());
app.use(express.static("public"));
app.use(cookieParser());
app.use(cors());

// ------------------------------------------------------------------
// In-memory admin session store (server restart clears all sessions)
// ------------------------------------------------------------------
const adminTokens = new Map(); // token -> expiry timestamp

const ADMIN_PIN = "338989";
const ADMIN_SESSION_DURATION = 3600000; // 1 hour

function generateAdminToken() {
  return crypto.randomBytes(32).toString('hex');
}

function isAdminAuthenticated(req) {
  const token = req.cookies?.admin_token;
  if (!token) return false;
  const expiry = adminTokens.get(token);
  if (!expiry || Date.now() > expiry) {
    adminTokens.delete(token);
    return false;
  }
  return true;
}

// ------------------------------------------------------------------
// Helper functions for JSONBin
// ------------------------------------------------------------------
async function readJSONBin(url) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: headers
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.record || [];
  } catch (error) {
    console.error('Error reading from JSONBin:', error.message);
    return [];
  }
}

async function writeJSONBin(url, data) {
  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: headers,
      body: JSON.stringify(data)
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error writing to JSONBin:', error.message);
    return null;
  }
}

// Read user data from JSONBin
const readUsers = async () => {
  return await readJSONBin(USERS_URL);
};

// Write user data to JSONBin
const writeUsers = async (data) => {
  return await writeJSONBin(USERS_URL, data);
};

// Initialize JSONBin if empty, also ensure all users have an 'active' field
async function initializeJSONBin() {
  try {
    let users = await readUsers();
    if (users.length === 0) {
      await writeUsers([]);
      console.log('✅ Initialized users.json bin');
    } else {
      // Add 'active' field if missing (default true)
      let needsUpdate = false;
      users = users.map(user => {
        if (user.active === undefined) {
          user.active = true;
          needsUpdate = true;
        }
        return user;
      });
      if (needsUpdate) {
        await writeUsers(users);
        console.log('✅ Added active field to existing users');
      }
      console.log(`✅ Users bin has ${users.length} users`);
    }
  } catch (error) {
    console.error('❌ Error initializing JSONBin:', error.message);
  }
}

// ------------------------------------------------------------------
// EXISTING USER ROUTES (unchanged logic, now respects active status)
// ------------------------------------------------------------------

// **USER REGISTRATION**
app.post("/register", async (req, res) => {
  try {
    const { fullName, phone, pin } = req.body;
    
    if (!fullName || !phone || !pin) {
      return res.status(400).json({ message: "All fields are required" });
    }
    
    let users = await readUsers();
    
    if (users.some(user => user.phone === phone)) {
      return res.status(400).json({ message: "Phone number already registered" });
    }

    const newUser = {
      fullName,
      phone,
      pin,
      balance: 90000, // Registration bonus
      active: true,
      transactions: []
    };

    users.push(newUser);
    await writeUsers(users);

    res.cookie("phone", phone, { httpOnly: true, maxAge: 3600000 });
    res.json({ 
      message: "Registration successful!", 
      redirect: "/dashboard.html",
      user: {
        fullName,
        phone,
        balance: 90000
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: "Registration failed. Please try again." });
  }
});

// **USER LOGIN**
app.post("/login", async (req, res) => {
  try {
    const { phone, pin } = req.body;
    
    if (!phone || !pin) {
      return res.status(400).json({ message: "Phone and PIN are required" });
    }
    
    let users = await readUsers();
    const user = users.find(user => user.phone === phone && user.pin === pin);
    
    if (!user) {
      return res.status(400).json({ message: "Invalid phone or PIN" });
    }

    // Check if account is active
    if (user.active === false) {
      return res.status(403).json({ message: "Account is deactivated. Contact admin." });
    }

    res.cookie("phone", phone, { httpOnly: true, maxAge: 3600000 });
    res.json({ 
      message: "Login successful", 
      redirect: "/dashboard.html",
      user: {
        fullName: user.fullName,
        balance: user.balance
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: "Login failed. Please try again." });
  }
});

// **DASHBOARD DATA**
app.get("/dashboard", async (req, res) => {
  try {
    const phone = req.cookies.phone;
    if (!phone) {
      return res.status(401).json({ message: "Unauthorized. Please log in." });
    }
    
    let users = await readUsers();
    let user = users.find(user => user.phone === phone);
    
    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }
    if (user.active === false) {
      res.clearCookie("phone");
      return res.status(403).json({ message: "Account deactivated" });
    }

    res.json({ 
      fullName: user.fullName, 
      balance: user.balance,
      phone: user.phone,
      transactionCount: user.transactions.length
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ message: "Server error" });
  }
});

// **GET USER BALANCE**
app.get("/balance", async (req, res) => {
  try {
    const phone = req.cookies.phone;
    if (!phone) {
      return res.status(401).json({ message: "Unauthorized. Please log in." });
    }
    
    let users = await readUsers();
    let user = users.find(user => user.phone === phone);
    
    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }
    if (user.active === false) {
      res.clearCookie("phone");
      return res.status(403).json({ message: "Account deactivated" });
    }

    res.json({ 
      balance: user.balance,
      formattedBalance: `₦${user.balance.toLocaleString()}`
    });
  } catch (error) {
    console.error('Balance error:', error);
    res.status(500).json({ message: "Server error" });
  }
});

// **TRANSFER MONEY**
app.post("/transfer", async (req, res) => {
  try {
    const phone = req.cookies.phone;
    if (!phone) {
      return res.status(401).json({ message: "Unauthorized. Please log in." });
    }
    
    const { receiverName, receiverAccount, bank, amount } = req.body;
    
    if (!receiverName || !receiverAccount || !bank || !amount) {
      return res.status(400).json({ message: "All fields are required" });
    }
    
    let users = await readUsers();
    let sender = users.find(user => user.phone === phone);
    
    if (!sender) {
      return res.status(400).json({ message: "User not found" });
    }
    if (sender.active === false) {
      res.clearCookie("phone");
      return res.status(403).json({ message: "Account deactivated" });
    }

    const transferAmount = parseFloat(amount);
    
    if (isNaN(transferAmount) || transferAmount <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    if (sender.transactions.length === 0 && transferAmount < 100000) {
      return res.status(400).json({ 
        message: "First transfer must be at least ₦100,000",
        requiredAmount: 100000
      });
    }
    
    if (transferAmount > sender.balance) {
      return res.status(400).json({ 
        message: `Insufficient funds! Your balance is ₦${sender.balance.toLocaleString()}`,
        depositRedirect: "/dashboard.html",
        currentBalance: sender.balance,
        requiredAmount: transferAmount
      });
    }

    sender.balance -= transferAmount;
    
    const transaction = {
      type: "debit",
      amount: transferAmount,
      receiver: receiverName,
      bank,
      account: receiverAccount,
      date: new Date().toLocaleString(),
      timestamp: new Date().toISOString(),
      balanceAfter: sender.balance
    };
    
    sender.transactions.push(transaction);
    await writeUsers(users);

    res.json({ 
      message: "Transfer successful",
      newBalance: sender.balance,
      formattedBalance: `₦${sender.balance.toLocaleString()}`,
      transaction: transaction
    });
  } catch (error) {
    console.error('Transfer error:', error);
    res.status(500).json({ message: "Transfer failed. Please try again." });
  }
});

// **TRANSACTION HISTORY**
app.get("/history", async (req, res) => {
  try {
    const phone = req.cookies.phone;
    if (!phone) {
      return res.status(401).json({ message: "Unauthorized. Please log in." });
    }
    
    let users = await readUsers();
    let user = users.find(user => user.phone === phone);
    
    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }
    if (user.active === false) {
      res.clearCookie("phone");
      return res.status(403).json({ message: "Account deactivated" });
    }

    res.json({
      transactions: user.transactions,
      totalTransactions: user.transactions.length,
      user: {
        fullName: user.fullName,
        balance: user.balance
      }
    });
  } catch (error) {
    console.error('History error:', error);
    res.status(500).json({ message: "Server error" });
  }
});

// **LOGOUT**
app.post("/logout", (req, res) => {
  res.clearCookie("phone");
  res.json({ 
    message: "Logged out successfully",
    redirect: "/login.html"
  });
});

// **CHECK SESSION**
app.get("/check-session", async (req, res) => {
  try {
    const phone = req.cookies.phone;
    if (!phone) {
      return res.json({ loggedIn: false });
    }
    
    let users = await readUsers();
    let user = users.find(user => user.phone === phone);
    
    if (!user || user.active === false) {
      res.clearCookie("phone");
      return res.json({ loggedIn: false });
    }

    res.json({ 
      loggedIn: true,
      user: {
        fullName: user.fullName,
        phone: user.phone,
        balance: user.balance
      }
    });
  } catch (error) {
    console.error('Session check error:', error);
    res.json({ loggedIn: false });
  }
});

// ------------------------------------------------------------------
// ADMIN ROUTES
// ------------------------------------------------------------------

// Admin login
app.post("/admin/login", (req, res) => {
  const { pin } = req.body;
  if (pin !== ADMIN_PIN) {
    return res.status(401).json({ message: "Invalid admin access PIN" });
  }
  // Generate token and store
  const token = generateAdminToken();
  adminTokens.set(token, Date.now() + ADMIN_SESSION_DURATION);
  res.cookie("admin_token", token, {
    httpOnly: true,
    maxAge: ADMIN_SESSION_DURATION,
    sameSite: "strict"
  });
  res.json({ message: "Admin authenticated", success: true });
});

// Admin logout
app.post("/admin/logout", (req, res) => {
  const token = req.cookies?.admin_token;
  if (token) adminTokens.delete(token);
  res.clearCookie("admin_token");
  res.json({ message: "Logged out" });
});

// Middleware to protect admin routes
function requireAdmin(req, res, next) {
  if (!isAdminAuthenticated(req)) {
    return res.status(403).json({ message: "Admin access required. Please login at /admin.html" });
  }
  next();
}

// Get all users (admin only)
app.get("/admin/users", requireAdmin, async (req, res) => {
  try {
    let users = await readUsers();
    // Return users without PIN (security)
    const safeUsers = users.map(({ pin, ...rest }) => rest);
    res.json({ users: safeUsers });
  } catch (error) {
    console.error('Admin get users error:', error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get single user details (admin)
app.get("/admin/user/:phone", requireAdmin, async (req, res) => {
  try {
    const phone = req.params.phone;
    let users = await readUsers();
    const user = users.find(u => u.phone === phone);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    // Return user without PIN
    const { pin, ...safeUser } = user;
    res.json({ user: safeUser });
  } catch (error) {
    console.error('Admin get user error:', error);
    res.status(500).json({ message: "Server error" });
  }
});

// Credit a user (admin)
app.post("/admin/user/credit", requireAdmin, async (req, res) => {
  try {
    const { phone, amount } = req.body;
    if (!phone || amount === undefined) {
      return res.status(400).json({ message: "Phone and amount are required" });
    }
    const creditAmount = parseFloat(amount);
    if (isNaN(creditAmount) || creditAmount <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    let users = await readUsers();
    const userIndex = users.findIndex(u => u.phone === phone);
    if (userIndex === -1) {
      return res.status(404).json({ message: "User not found" });
    }

    users[userIndex].balance += creditAmount;
    // Record transaction as admin credit
    users[userIndex].transactions.push({
      type: "credit",
      amount: creditAmount,
      receiver: "Admin Credit",
      bank: "System",
      account: "N/A",
      date: new Date().toLocaleString(),
      timestamp: new Date().toISOString(),
      balanceAfter: users[userIndex].balance
    });

    await writeUsers(users);
    res.json({ message: `Credited ₦${creditAmount.toLocaleString()} to ${users[userIndex].fullName}`, newBalance: users[userIndex].balance });
  } catch (error) {
    console.error('Admin credit error:', error);
    res.status(500).json({ message: "Server error" });
  }
});

// Debit a user (admin)
app.post("/admin/user/debit", requireAdmin, async (req, res) => {
  try {
    const { phone, amount } = req.body;
    if (!phone || amount === undefined) {
      return res.status(400).json({ message: "Phone and amount are required" });
    }
    const debitAmount = parseFloat(amount);
    if (isNaN(debitAmount) || debitAmount <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    let users = await readUsers();
    const userIndex = users.findIndex(u => u.phone === phone);
    if (userIndex === -1) {
      return res.status(404).json({ message: "User not found" });
    }

    if (users[userIndex].balance < debitAmount) {
      return res.status(400).json({ message: "Insufficient balance" });
    }

    users[userIndex].balance -= debitAmount;
    // Record transaction
    users[userIndex].transactions.push({
      type: "debit",
      amount: debitAmount,
      receiver: "Admin Debit",
      bank: "System",
      account: "N/A",
      date: new Date().toLocaleString(),
      timestamp: new Date().toISOString(),
      balanceAfter: users[userIndex].balance
    });

    await writeUsers(users);
    res.json({ message: `Debited ₦${debitAmount.toLocaleString()} from ${users[userIndex].fullName}`, newBalance: users[userIndex].balance });
  } catch (error) {
    console.error('Admin debit error:', error);
    res.status(500).json({ message: "Server error" });
  }
});

// Activate user
app.post("/admin/user/activate", requireAdmin, async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ message: "Phone required" });

    let users = await readUsers();
    const userIndex = users.findIndex(u => u.phone === phone);
    if (userIndex === -1) return res.status(404).json({ message: "User not found" });

    users[userIndex].active = true;
    await writeUsers(users);
    res.json({ message: `User ${users[userIndex].fullName} activated` });
  } catch (error) {
    console.error('Admin activate error:', error);
    res.status(500).json({ message: "Server error" });
  }
});

// Deactivate user
app.post("/admin/user/deactivate", requireAdmin, async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ message: "Phone required" });

    let users = await readUsers();
    const userIndex = users.findIndex(u => u.phone === phone);
    if (userIndex === -1) return res.status(404).json({ message: "User not found" });

    users[userIndex].active = false;
    await writeUsers(users);
    res.json({ message: `User ${users[userIndex].fullName} deactivated` });
  } catch (error) {
    console.error('Admin deactivate error:', error);
    res.status(500).json({ message: "Server error" });
  }
});

// Change user password (PIN)
app.post("/admin/user/changepin", requireAdmin, async (req, res) => {
  try {
    const { phone, newPin } = req.body;
    if (!phone || !newPin) return res.status(400).json({ message: "Phone and newPin required" });
    if (typeof newPin !== 'string' || newPin.trim().length === 0) {
      return res.status(400).json({ message: "Invalid PIN" });
    }

    let users = await readUsers();
    const userIndex = users.findIndex(u => u.phone === phone);
    if (userIndex === -1) return res.status(404).json({ message: "User not found" });

    users[userIndex].pin = newPin;
    await writeUsers(users);
    res.json({ message: `PIN changed for ${users[userIndex].fullName}` });
  } catch (error) {
    console.error('Admin changepin error:', error);
    res.status(500).json({ message: "Server error" });
  }
});

// ------------------------------------------------------------------
// TEST ENDPOINT (updated)
app.get("/test", (req, res) => {
  res.json({ 
    status: "OK", 
    message: "Banking API is running",
    timestamp: new Date().toISOString(),
    endpoints: [
      "POST /register",
      "POST /login", 
      "GET /dashboard",
      "GET /balance",
      "POST /transfer",
      "GET /history",
      "POST /logout",
      "GET /check-session",
      "--- Admin ---",
      "POST /admin/login",
      "POST /admin/logout",
      "GET /admin/users",
      "GET /admin/user/:phone",
      "POST /admin/user/credit",
      "POST /admin/user/debit",
      "POST /admin/user/activate",
      "POST /admin/user/deactivate",
      "POST /admin/user/changepin"
    ]
  });
});

// ------------------------------------------------------------------
// START SERVER
app.listen(PORT, async () => {
  console.log(`\n========================================`);
  console.log(`Banking Server`);
  console.log(`========================================`);
  console.log(`Server URL: http://localhost:${PORT}`);
  console.log(`Admin Panel: http://localhost:${PORT}/admin.html`);
  console.log(`========================================\n`);
  
  await initializeJSONBin();
  console.log('✅ Server is ready and connected to JSONBin');
  console.log('✅ Test the server at: http://localhost:3000/test');
});
