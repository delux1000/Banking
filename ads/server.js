// server.js
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 10000; // Render provides PORT automatically

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Example: Read/write users.json if needed
const dbFilePath = path.join(__dirname, 'public', 'users.json');

// Example route to get users
app.get('/api/users', (req, res) => {
  if (fs.existsSync(dbFilePath)) {
    const users = JSON.parse(fs.readFileSync(dbFilePath, 'utf8'));
    res.json(users);
  } else {
    res.json([]);
  }
});

// Example route to add a user
app.post('/api/users', (req, res) => {
  let users = [];
  if (fs.existsSync(dbFilePath)) {
    users = JSON.parse(fs.readFileSync(dbFilePath, 'utf8'));
  }
  users.push(req.body);
  fs.writeFileSync(dbFilePath, JSON.stringify(users, null, 2));
  res.json({ success: true, message: 'User added successfully!' });
});

// Fallback route for SPA (serve index.html for all other routes)
app.get('/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
