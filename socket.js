const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const { Chat } = require('./models/Chat');

let io;
const userSockets = new Map(); // Track user online status
const userRooms = new Map(); // Track which rooms a user has joined

const initializeSocket = (server) => {
  io = socketIo(server, {
    cors: {
      origin: process.env.FRONTEND_URL,
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication error'));
      }
      
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      socket.companyId = decoded.company;
      next();
    } catch (error) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    console.log('User connected:', socket.userId);

    socket.on('join', (room) => {
      socket.join(room);
      // console.log(`User ${socket.userId} joined room ${room}`);
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.userId);
    });
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      
      if (!token) {
        return next(new Error('Authentication error: Token missing'));
      }
      
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      
      // Update user as online in the database
      await User.findByIdAndUpdate(decoded.id, { 
        lastActive: new Date(), 
        isOnline: true 
      });
      
      next();
    } catch (error) {
      console.error('Socket authentication error:', error);
      next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    console.log(`User ${socket.userId} connected`);
    
    // Track socket for user status
    userSockets.set(socket.userId, socket.id);
    userRooms.set(socket.userId, new Set());
    
    // Notify others that user is online
    socket.broadcast.emit('userStatusChange', { 
      userId: socket.userId, 
      status: 'online' 
    });

    // Join user's personal room for direct messages
    socket.join(`user-${socket.userId}`);
    console.log(`User ${socket.userId} joined their personal room`);

    // Auto-join all user's chat rooms
    try {
      const userChats = await Chat.find(
        { 'participants.user': socket.userId },
        '_id'
      );
      
      userChats.forEach(chat => {
        const roomId = `chat-${chat._id}`;
        socket.join(roomId);
        userRooms.get(socket.userId).add(roomId);
        // console.log(`User ${socket.userId} auto-joined chat room: ${chat._id}`);
      });
    } catch (error) {
      console.error('Error auto-joining chat rooms:', error);
    }

    // Send message
    socket.on('sendMessage', async (messageData) => {
      try {
        const { chatId, message } = messageData;
        const roomId = `chat-${chatId}`;
        
        // Mark as delivered for online users
        const chat = await Chat.findById(chatId);
        if (chat) {
          const onlineParticipants = chat.participants
            .filter(p => p.user.toString() !== socket.userId && userSockets.has(p.user.toString()))
            .map(p => p.user.toString());
          
          if (onlineParticipants.length > 0) {
            // Update message as delivered in database
            await Chat.updateOne(
              { _id: chatId, 'messages._id': message._id },
              { 
                $addToSet: { 
                  'messages.$.deliveredTo': onlineParticipants.map(id => ({
                    userId: id,
                    deliveredAt: new Date()
                  }))
                } 
              }
            );
            
            // Emit delivery status to sender
            io.to(`user-${socket.userId}`).emit('messageDelivered', {
              messageId: message._id,
              chatId,
              deliveredTo: onlineParticipants
            });
          }
          
          // Broadcast message to chat room (excluding sender)
          socket.to(roomId).emit('newMessage', {
            ...message,
            chatId
          });
          
          // Send notification to users who are not in the chat room
          chat.participants.forEach(participant => {
            const participantId = participant.user.toString();
            if (participantId !== socket.userId) {
              const socketId = userSockets.get(participantId);
              const userSocketObj = io.sockets.sockets.get(socketId);
              
              // Check if user is connected but not in this chat room
              if (socketId && userSocketObj && !userSocketObj.rooms.has(roomId)) {
                io.to(`user-${participantId}`).emit('messageNotification', {
                  chatId,
                  message: {
                    _id: message._id,
                    sender: {
                      _id: socket.userId
                    },
                    content: message.content,
                    messageType: message.messageType,
                    createdAt: message.createdAt
                  }
                });
              }
            }
          });
        }
      } catch (error) {
        console.error('Error handling sendMessage:', error);
      }
    });

    // Typing indicators
    socket.on('typing', ({ chatId, userId }) => {
      socket.to(`chat-${chatId}`).emit('userTyping', { userId, chatId });
    });

    socket.on('stopTyping', ({ chatId, userId }) => {
      socket.to(`chat-${chatId}`).emit('userStoppedTyping', { userId, chatId });
    });

    // Read receipts
    socket.on('messageRead', async ({ chatId, messageId, userId }) => {
      try {
        // Update message as read in database
        await Chat.updateOne(
          { _id: chatId, 'messages._id': messageId },
          { 
            $addToSet: { 
              'messages.$.readBy': {
                userId,
                readAt: new Date()
              }
            } 
          }
        );
        
        // Also decrease unread count for this user
        const chat = await Chat.findById(chatId);
        if (chat) {
          const unreadMap = chat.unreadCount || {};
          const currentCount = unreadMap.get(userId) || 0;
          
          if (currentCount > 0) {
            unreadMap.set(userId, currentCount - 1);
            await chat.save();
          }
        }
        
        // Broadcast to chat room
        socket.to(`chat-${chatId}`).emit('messageReadBy', { 
          messageId, 
          userId,
          chatId,
          readAt: new Date()
        });
      } catch (error) {
        console.error('Error marking message as read:', error);
      }
    });

    // Join chat room
    socket.on('joinChat', (chatId) => {
      const roomId = `chat-${chatId}`;
      socket.join(roomId);
      userRooms.get(socket.userId)?.add(roomId);
      // console.log(`User ${socket.userId} joined chat room: ${chatId}`);
    });

    // Leave chat room
    socket.on('leaveChat', (chatId) => {
      const roomId = `chat-${chatId}`;
      socket.leave(roomId);
      userRooms.get(socket.userId)?.delete(roomId);
      // console.log(`User ${socket.userId} left chat room: ${chatId}`);
    });

    // Message reactions
    socket.on('addReaction', async ({ chatId, messageId, emoji }) => {
      try {
        await Chat.updateOne(
          { _id: chatId, 'messages._id': messageId },
          { 
            $pull: { 
              'messages.$.reactions': { user: socket.userId }
            }
          }
        );
        
        await Chat.updateOne(
          { _id: chatId, 'messages._id': messageId },
          { 
            $addToSet: { 
              'messages.$.reactions': {
                user: socket.userId,
                emoji,
                createdAt: new Date()
              }
            } 
          }
        );
        
        socket.to(`chat-${chatId}`).emit('messageReaction', {
          chatId,
          messageId,
          reaction: {
            user: socket.userId,
            emoji,
            createdAt: new Date()
          }
        });
      } catch (error) {
        console.error('Error adding reaction:', error);
      }
    });

    // Remove reaction
    socket.on('removeReaction', async ({ chatId, messageId }) => {
      try {
        await Chat.updateOne(
          { _id: chatId, 'messages._id': messageId },
          { 
            $pull: { 
              'messages.$.reactions': { user: socket.userId }
            }
          }
        );
        
        socket.to(`chat-${chatId}`).emit('reactionRemoved', {
          chatId,
          messageId,
          userId: socket.userId
        });
      } catch (error) {
        console.error('Error removing reaction:', error);
      }
    });

    // Delete messages
    socket.on('deleteMessage', async ({ chatId, messageId, forEveryone }) => {
      try {
        if (forEveryone) {
          // First verify this user is allowed to delete for everyone
          const chat = await Chat.findOne(
            { 
              _id: chatId,
              'messages._id': messageId,
              'messages.sender': socket.userId
            }
          );
          
          if (!chat) {
            return; // Not authorized or message not found
          }
          
          await Chat.updateOne(
            { _id: chatId, 'messages._id': messageId },
            { $set: { 'messages.$.isDeleted': true } }
          );
          
          socket.to(`chat-${chatId}`).emit('messageDeleted', {
            chatId,
            messageId,
            forEveryone: true
          });
        } else {
          // Delete just for this user
          await Chat.updateOne(
            { _id: chatId, 'messages._id': messageId },
            { $addToSet: { 'messages.$.deletedFor': socket.userId } }
          );
        }
      } catch (error) {
        console.error('Error deleting message:', error);
      }
    });

    // User presence
    socket.on('getPresence', async (userIds) => {
      const presenceInfo = {};
      userIds.forEach(id => {
        presenceInfo[id] = userSockets.has(id) ? 'online' : 'offline';
      });
      
      socket.emit('presenceInfo', presenceInfo);
    });

    // Disconnect
    socket.on('disconnect', async () => {
      console.log(`User ${socket.userId} disconnected`);
      
      // Remove from tracking
      userSockets.delete(socket.userId);
      userRooms.delete(socket.userId);
      
      // Update user status as offline
      await User.findByIdAndUpdate(socket.userId, { 
        lastActive: new Date(),
        isOnline: false
      });
      
      // Notify others that user is offline
      socket.broadcast.emit('userStatusChange', { 
        userId: socket.userId, 
        status: 'offline' 
      });
    });
  });

  // Store io instance for use in other parts of the application
  global.io = io;
  
  return io;
};

// Get user's online status
const getUserStatus = (userId) => {
  return userSockets.has(userId) ? 'online' : 'offline';
};

// Get all online users
const getOnlineUsers = () => {
  return Array.from(userSockets.keys());
};

// Get the io instance
const getIo = () => {
  if (!global.io) {
    throw new Error('Socket.io not initialized');
  }
  return global.io;
};

module.exports = {
  initializeSocket,
  getIo,
  getUserStatus,
  getOnlineUsers
};