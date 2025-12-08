const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const cors = require("cors");
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

// Helper functions for JSONBin
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

// Initialize JSONBin if empty
async function initializeJSONBin() {
  try {
    const users = await readUsers();
    if (users.length === 0) {
      await writeUsers([]);
      console.log('✅ Initialized users.json bin');
    } else {
      console.log(`✅ Users bin has ${users.length} users`);
    }
  } catch (error) {
    console.error('❌ Error initializing JSONBin:', error.message);
  }
}

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
    
    if (!user) {
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

// **TEST ENDPOINT**
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
      "GET /check-session"
    ]
  });
});

// **START SERVER**
app.listen(PORT, async () => {
  console.log(`\n========================================`);
  console.log(`Banking Server`);
  console.log(`========================================`);
  console.log(`Server URL: http://localhost:${PORT}`);
  console.log(`========================================\n`);
  
  // Initialize JSONBin on startup
  await initializeJSONBin();
  console.log('✅ Server is ready and connected to JSONBin');
  console.log('✅ Test the server at: http://localhost:4000/test');
});
