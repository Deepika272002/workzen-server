const { Chat } = require('../models/Chat');
const User = require('../models/User');
const mongoose = require('mongoose');
const ObjectId = mongoose.Types.ObjectId;
const path = require('path');
const fs = require('fs');

// Create a new chat between two users
exports.createDirectChat = async (req, res) => {
  try {
    const userId = req.user.id;
    const { userId: targetUserId } = req.body;

    // Validate both users exist
    const [currentUser, targetUser] = await Promise.all([
      User.findById(userId),
      User.findById(targetUserId)
    ]);

    if (!currentUser || !targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if they're in the same company
    if (currentUser.company.toString() !== targetUser.company.toString()) {
      return res.status(403).json({ 
        message: 'Cannot create chat with users from different companies' 
      });
    }

    // Check if chat already exists
    const existingChat = await Chat.findDirectChat(userId, targetUserId);
    if (existingChat) {
      return res.status(200).json(existingChat);
    }

    // Create new direct chat
    const newChat = new Chat({
      type: 'direct',
      // Keep participants as ObjectIds for backward compatibility
      participants: [userId, targetUserId],
      // Store detailed information in participantDetails
      participantDetails: [
        {
          user: userId,
          name: currentUser.name,
          avatar: currentUser.avatar,
          onlineStatus: currentUser.isOnline ? 'online' : 'offline',
          lastActive: currentUser.lastActive
        },
        {
          user: targetUserId,
          name: targetUser.name,
          avatar: targetUser.avatar,
          onlineStatus: targetUser.isOnline ? 'online' : 'offline',
          lastActive: targetUser.lastActive
        }
      ],
      unreadCounts: [
        { user: userId, count: 0 },
        { user: targetUserId, count: 0 }
      ]
    });

    await newChat.save();
    
    // Populate participant info for the response
    const populatedChat = await Chat.findById(newChat._id)
      .populate('participants', 'name avatar isOnline lastActive')
      .populate({
        path: 'messages.sender',
        select: 'name avatar'
      });

    return res.status(201).json(populatedChat);
  } catch (error) {
    console.error('Create direct chat error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Create a group chat
exports.createGroupChat = async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, participants, description } = req.body;

    if (!name || !participants || !Array.isArray(participants)) {
      return res.status(400).json({ message: 'Name and valid participants are required' });
    }

    // Ensure creator is included in participants
    const allParticipants = [...new Set([userId, ...participants])];

    // Verify all users exist and are from the same company
    const currentUser = await User.findById(userId);
    const participantUsers = await User.find({ _id: { $in: allParticipants } });

    if (participantUsers.length !== allParticipants.length) {
      return res.status(404).json({ message: 'One or more users not found' });
    }

    // Check if all users are in the same company
    const companyId = currentUser.company.toString();
    const notInCompany = participantUsers.some(user => 
      user.company.toString() !== companyId
    );

    if (notInCompany) {
      return res.status(403).json({ 
        message: 'Cannot create group with users from different companies' 
      });
    }

    // Create the group chat
    const newChat = new Chat({
      type: 'group',
      name,
      description,
      participants: allParticipants,
      admins: [userId], // Creator is the first admin
      unreadCounts: allParticipants.map(id => ({ user: id, count: 0 }))
    });

    await newChat.save();
    
    // Populate participant info
    const populatedChat = await Chat.findById(newChat._id)
      .populate('participants', 'name avatar isOnline lastActive')
      .populate('admins', 'name')
      .populate({
        path: 'messages.sender',
        select: 'name avatar'
      });

    return res.status(201).json(populatedChat);
  } catch (error) {
    // console.error('Create group chat error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get all chats for a user
exports.getUserChats = async (req, res) => {
  try {
    const userId = req.user.id;

    // Find all chats where the user is a participant
    const chats = await Chat.find({ participants: userId })
      .populate('participants', 'name avatar isOnline lastActive')
      .populate('participantDetails.user', 'name avatar isOnline lastActive')
      .populate('admins', 'name')
      .populate({
        path: 'messages',
        options: { 
          sort: { createdAt: -1 },
          limit: 1 
        },
        populate: {
          path: 'sender',
          select: 'name avatar'
        }
      })
      .sort({ updatedAt: -1 });

    // Calculate unread count for each chat
    const chatsWithUnread = chats.map(chat => {
      const unreadCount = chat.getUnreadCount(userId);
      
      // For direct chats, set display name to the other participant's name
      let displayName = chat.name;
      if (chat.type === 'direct') {
        // First try to get name from participantDetails
        const otherParticipantDetail = chat.participantDetails?.find(p => 
          p.user?._id.toString() !== userId.toString()
        );
        
        if (otherParticipantDetail?.name) {
          displayName = otherParticipantDetail.name;
        } else {
          // Fall back to participants array
          const otherParticipant = chat.participants.find(p => 
            p._id.toString() !== userId.toString()
          );
          if (otherParticipant) {
            displayName = otherParticipant.name;
          }
        }
      }
      
      return {
        ...chat.toObject(),
        unreadCount,
        displayName
      };
    });

    return res.status(200).json(chatsWithUnread);
  } catch (error) {
    console.error('Get user chats error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get a specific chat by ID
exports.getChatById = async (req, res) => {
  try {
    const userId = req.user.id;
    const { chatId } = req.params;

    const chat = await Chat.findById(chatId)
      .populate('participants', 'name avatar isOnline lastActive')
      .populate('admins', 'name')
      .populate({
        path: 'messages',
        options: { 
          sort: { createdAt: -1 },
          limit: 30 
        },
        populate: {
          path: 'sender',
          select: 'name avatar'
        }
      });

    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    // Check if user is a participant
    if (!chat.participants.some(p => p._id.toString() === userId.toString())) {
      return res.status(403).json({ message: 'Not authorized to access this chat' });
    }

    // Get unread count
    const unreadCount = chat.getUnreadCount(userId);

    // For direct chats, set display name to the other participant's name
    let displayName = chat.name;
    if (chat.type === 'direct') {
      const otherParticipant = chat.participants.find(p => 
        p._id.toString() !== userId.toString()
      );
      if (otherParticipant) {
        displayName = otherParticipant.name;
      }
    }

    const result = {
      ...chat.toObject(),
      unreadCount,
      displayName
    };

    return res.status(200).json(result);
  } catch (error) {
    console.error('Get chat by ID error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get messages for a specific chat with pagination
exports.getMessages = async (req, res) => {
  try {
    const userId = req.user.id;
    const { chatId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    
    const parsedPage = parseInt(page);
    const parsedLimit = parseInt(limit);
    
    const skip = (parsedPage - 1) * parsedLimit;

    const chat = await Chat.findById(chatId);
    
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    // Check if user is a participant
    if (!chat.participants.includes(userId)) {
      return res.status(403).json({ message: 'Not authorized to access this chat' });
    }

    // Filter out messages that are deleted for this user
    const messages = chat.messages
      .filter(msg => !msg.deletedFor.includes(userId))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(skip, skip + parsedLimit);

    // Populate sender info
    await Chat.populate(messages, {
      path: 'sender',
      select: 'name avatar'
    });

    // Reset unread count for this user
    chat.resetUnreadCount(userId);
    await chat.save();

    return res.status(200).json({
      messages: messages.reverse(), // Return in ascending order
      totalCount: chat.messages.filter(msg => !msg.deletedFor.includes(userId)).length,
      page: parsedPage,
      limit: parsedLimit
    });
  } catch (error) {
    console.error('Get messages error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Send a message in a chat
exports.sendMessage = async (req, res) => {
  try {
    const userId = req.user.id;
    const { chatId } = req.params;
    const { content } = req.body;
    
    // Check if there's either content or files
    if (!content && (!req.files || req.files.length === 0)) {
      return res.status(400).json({ 
        message: 'Message content or attachments are required' 
      });
    }

    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    // Check if user is a participant
    if (!chat.participants.some(p => p.toString() === userId.toString())) {
      return res.status(403).json({ 
        message: 'Not authorized to send messages to this chat' 
      });
    }

    // Create new message
    const newMessage = {
      sender: userId,
      content: content || '', // Allow empty content if there are files
      readBy: [{ user: userId }],
      deliveredTo: [{ user: userId }],
      attachments: []
    };

    // Handle file attachments
    if (req.files && req.files.length > 0) {
      newMessage.attachments = req.files.map(file => ({
        fileName: file.originalname,
        fileType: file.mimetype,
        fileUrl: file.path.replace(/\\/g, '/'), // Convert Windows path to URL format
        fileSize: file.size
      }));
    }

    chat.messages.push(newMessage);

    // Update unread counts for other participants
    chat.unreadCounts.forEach(item => {
      if (item.user.toString() !== userId.toString()) {
        item.count += 1;
      }
    });

    await chat.save();

    // Get the newly created message with populated sender
    const message = chat.messages[chat.messages.length - 1];
    await Chat.populate(message, {
      path: 'sender',
      select: 'name avatar'
    });

    return res.status(201).json(message);
  } catch (error) {
    console.error('Send message error:', error);
    return res.status(500).json({ 
      message: 'Error sending message', 
      error: error.message 
    });
  }
};

// Mark messages as read
exports.markMessagesAsRead = async (req, res) => {
  try {
    const userId = req.user.id;
    const { chatId } = req.params;

    const chat = await Chat.findById(chatId);
    
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    // Check if user is a participant
    if (!chat.participants.includes(userId)) {
      return res.status(403).json({ message: 'Not authorized to access this chat' });
    }

    // Reset unread count for this user
    chat.resetUnreadCount(userId);

    // Mark all messages as read by this user
    chat.messages.forEach(message => {
      if (!message.readBy.some(read => read.user.toString() === userId.toString())) {
        message.readBy.push({ user: userId, readAt: new Date() });
      }
    });

    await chat.save();

    return res.status(200).json({ message: 'Messages marked as read' });
  } catch (error) {
    // console.error('Mark as read error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Delete a message
exports.deleteMessage = async (req, res) => {
  try {
    const userId = req.user.id;
    const { chatId, messageId } = req.params;
    const { forEveryone = false } = req.query;

    const chat = await Chat.findById(chatId);
    
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    // Find the message
    const message = chat.messages.id(messageId);
    
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    // Check authorization (only sender can delete for everyone)
    if (forEveryone && message.sender.toString() !== userId.toString()) {
      return res.status(403).json({ message: 'Only the sender can delete for everyone' });
    }

    if (forEveryone) {
      // Mark as deleted for everyone
      message.isDeleted = true;
      message.content = 'This message was deleted';
      message.attachments = [];
    } else {
      // Mark as deleted just for this user
      if (!message.deletedFor.includes(userId)) {
        message.deletedFor.push(userId);
      }
    }

    await chat.save();

    return res.status(200).json({ 
      message: 'Message deleted successfully',
      forEveryone
    });
  } catch (error) {
    console.error('Delete message error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Add reaction to a message
exports.addReaction = async (req, res) => {
  try {
    const userId = req.user.id;
    const { chatId, messageId } = req.params;
    const { emoji } = req.body;

    if (!emoji) {
      return res.status(400).json({ message: 'Emoji is required' });
    }

    const chat = await Chat.findById(chatId);
    
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    // Check if user is a participant
    if (!chat.participants.includes(userId)) {
      return res.status(403).json({ message: 'Not authorized to react to messages in this chat' });
    }

    // Find the message
    const message = chat.messages.id(messageId);
    
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    // Remove existing reaction from this user if any
    message.reactions = message.reactions.filter(
      reaction => reaction.user.toString() !== userId.toString()
    );

    // Add new reaction
    message.reactions.push({ user: userId, emoji });

    await chat.save();

    return res.status(200).json({ 
      message: 'Reaction added successfully',
      reaction: { user: userId, emoji }
    });
  } catch (error) {
    console.error('Add reaction error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Remove reaction from a message
exports.removeReaction = async (req, res) => {
  try {
    const userId = req.user.id;
    const { chatId, messageId } = req.params;

    const chat = await Chat.findById(chatId);
    
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    // Find the message
    const message = chat.messages.id(messageId);
    
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    // Remove reaction from this user
    message.reactions = message.reactions.filter(
      reaction => reaction.user.toString() !== userId.toString()
    );

    await chat.save();

    return res.status(200).json({ 
      message: 'Reaction removed successfully' 
    });
  } catch (error) {
    console.error('Remove reaction error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Edit message
exports.editMessage = async (req, res) => {
  try {
    const { chatId, messageId } = req.params;
    const { content } = req.body;
    const userId = req.user.id;

    const chat = await Chat.findById(chatId);
    const message = chat.messages.id(messageId);

    if (!message || message.sender.toString() !== userId) {
      return res.status(403).json({ message: 'Not authorized to edit this message' });
    }

    // Save edit history
    message.editHistory.push({
      content: message.content,
      editedAt: Date.now()
    });

    message.content = content;
    message.edited = true;
    await chat.save();

    return res.status(200).json(message);
  } catch (error) {
    console.error('Edit message error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Search messages
exports.searchMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { query } = req.query;
    
    const chat = await Chat.findById(chatId);
    
    const messages = chat.messages.filter(msg => 
      msg.content.toLowerCase().includes(query.toLowerCase())
    );

    return res.status(200).json(messages);
  } catch (error) {
    // console.error('Search messages error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Update typing status
exports.updateTypingStatus = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.id;
    const { isTyping } = req.body;

    // Emit typing status via socket
    const io = req.app.get('io');
    io.to(chatId).emit('userTyping', { userId, chatId, isTyping });

    return res.status(200).json({ message: 'Typing status updated' });
  } catch (error) {
    // console.error('Update typing status error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Reply to a message
exports.replyToMessage = async (req, res) => {
  try {
    const userId = req.user.id;
    const { chatId, messageId } = req.params;
    const { content } = req.body;

    if (!content || content.trim() === '') {
      return res.status(400).json({ message: 'Reply content is required' });
    }

    const chat = await Chat.findById(chatId);
    
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    // Check if original message exists
    const originalMessage = chat.messages.id(messageId);
    if (!originalMessage) {
      return res.status(404).json({ message: 'Original message not found' });
    }

    // Create new reply message
    const newMessage = {
      sender: userId,
      content,
      replyTo: messageId,
      readBy: [{ user: userId }],
      deliveredTo: [{ user: userId }]
    };

    chat.messages.push(newMessage);
    
    // Update unread counts for other participants
    chat.unreadCounts.forEach(item => {
      if (item.user.toString() !== userId.toString()) {
        item.count += 1;
      }
    });

    await chat.save();

    // Get the newly created message with populated sender
    const message = chat.messages[chat.messages.length - 1];
    await Chat.populate(message, [{
      path: 'sender',
      select: 'name avatar'
    }, {
      path: 'replyTo',
      select: 'content sender'
    }]);

    return res.status(201).json(message);
  } catch (error) {
    // console.error('Reply to message error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Search chats
exports.searchChats = async (req, res) => {
  try {
    const userId = req.user.id;
    const { query } = req.query;

    const chats = await Chat.find({
      participants: userId,
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { 'messages.content': { $regex: query, $options: 'i' } }
      ]
    })
    .populate('participants', 'name avatar isOnline lastActive')
    .populate('admins', 'name')
    .limit(20);

    return res.status(200).json(chats);
  } catch (error) {
    // console.error('Search chats error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};
