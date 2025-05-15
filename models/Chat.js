const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Message schema as a subdocument
const MessageSchema = new Schema({
  sender: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: true
  },
  attachments: [{
    fileName: String,
    fileType: String,
    fileUrl: String,
    fileSize: Number
  }],
  reactions: [{
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    emoji: String
  }],
  readBy: [{
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    readAt: {
      type: Date,
      default: Date.now
    }
  }],
  deliveredTo: [{
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    deliveredAt: {
      type: Date,
      default: Date.now
    }
  }],
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedFor: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  replyTo: {
    type: Schema.Types.ObjectId,
    ref: 'Message'
  },
  edited: {
    type: Boolean,
    default: false
  },
  editHistory: [{
    content: String,
    editedAt: Date
  }],
  groupId: {
    type: String  // For message grouping
  }
}, { timestamps: true });

// Add method to group messages
MessageSchema.statics.groupMessages = function(messages) {
  let groupedMessages = [];
  let currentGroup = null;
  
  messages.forEach(message => {
    const messageDate = new Date(message.createdAt);
    if (!currentGroup || 
        currentGroup.sender !== message.sender.toString() ||
        messageDate - currentGroup.lastMessageAt > 300000) { // 5 minutes gap
      currentGroup = {
        sender: message.sender.toString(),
        messages: [message],
        lastMessageAt: messageDate
      };
      groupedMessages.push(currentGroup);
    } else {
      currentGroup.messages.push(message);
      currentGroup.lastMessageAt = messageDate;
    }
  });
  
  return groupedMessages;
};

// Chat schema
const ChatSchema = new Schema({
  type: {
    type: String,
    enum: ['direct', 'group'],
    required: true
  },
  participants: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  // Add a new field to store participant details separately
  participantDetails: [{
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    name: String,
    avatar: String,
    onlineStatus: {
      type: String,
      enum: ['online', 'offline'],
      default: 'offline'
    },
    lastActive: Date
  }],
  messages: [MessageSchema],
  name: {
    type: String,
    // Required for group chats
    required: function() {
      return this.type === 'group';
    }
  },
  description: {
    type: String
  },
  avatar: {
    type: String
  },
  admins: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  lastMessage: {
    type: Schema.Types.ObjectId,
    ref: 'Message'
  },
  unreadCounts: [{
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    count: {
      type: Number,
      default: 0
    }
  }]
}, { timestamps: true });

// Create indexes for efficient querying
ChatSchema.index({ participants: 1 });
ChatSchema.index({ 'messages.sender': 1 });
ChatSchema.index({ 'messages.createdAt': -1 });

// Check if a chat already exists between two users
ChatSchema.statics.findDirectChat = async function(user1Id, user2Id) {
  return this.findOne({
    type: 'direct',
    participants: { $all: [user1Id, user2Id], $size: 2 }
  });
};

// Get unread count for a specific user in a chat
ChatSchema.methods.getUnreadCount = function(userId) {
  const userUnreadInfo = this.unreadCounts.find(item => 
    item.user.toString() === userId.toString()
  );
  return userUnreadInfo ? userUnreadInfo.count : 0;
};

// Reset unread count for a user in a chat
ChatSchema.methods.resetUnreadCount = function(userId) {
  const userUnreadInfo = this.unreadCounts.find(item => 
    item.user.toString() === userId.toString()
  );
  
  if (userUnreadInfo) {
    userUnreadInfo.count = 0;
  } else {
    this.unreadCounts.push({ user: userId, count: 0 });
  }
};

const Chat = mongoose.model('Chat', ChatSchema);
const Message = mongoose.model('Message', MessageSchema);

module.exports = { Chat, Message };
