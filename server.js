const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const { createServer } = require('http');
const { initializeSocket } = require('./socket');
const { initializeScheduledTasks } = require('./utils/scheduleHelper');

// const userRoutes = require('./routes/user.routes');

// Load environment variables
dotenv.config();

// Initialize express
const app = express();

// Create HTTP server
const httpServer = createServer(app);

// Initialize Socket.io with WebRTC support
const io = initializeSocket(httpServer);

// Middleware
app.use(cors({
   origin: process.env.FRONTEND_URL?.replace(/\/$/, "")|| "http://localhost:5173",
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// WebRTC specific headers
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/users', require('./routes/user.routes'));

app.use('/api/companies', require('./routes/company.routes'));
app.use('/api/tasks', require('./routes/task.routes'));
app.use('/api/hierarchy', require('./routes/hierarchy.routes'));
app.use('/api/notifications', require('./routes/notification.routes'));
// Add this line with other routes
app.use('/api/chats', require('./routes/chat.routes'));




// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something broke!' });
});

app.get('/', (req, res) => {
  res.send('Welcome to the Workzen backend server!');
}
);
const PORT = process.env.PORT || 3002;

// Initialize scheduled tasks
initializeScheduledTasks();

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});