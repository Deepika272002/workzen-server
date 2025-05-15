const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chat.controller');
const { protect } = require('../middleware/auth');
const upload = require('../middleware/upload');

// Protect all routes with authentication
router.use(protect);

// Chat creation routes
router.post('/direct', chatController.createDirectChat);
router.post('/group', chatController.createGroupChat);

// Chat retrieval routes
router.get('/user/chats', chatController.getUserChats);
router.get('/:chatId', chatController.getChatById);
router.get('/:chatId/messages', chatController.getMessages);

// Message management routes
router.post('/:chatId/messages', upload.array('attachments', 10), chatController.sendMessage);
router.put('/:chatId/messages/:messageId', chatController.editMessage);
router.delete('/:chatId/messages/:messageId', chatController.deleteMessage);

// Message interaction routes
router.post('/:chatId/messages/:messageId/reactions', chatController.addReaction);
router.delete('/:chatId/messages/:messageId/reactions', chatController.removeReaction);
router.post('/:chatId/messages/:messageId/reply', chatController.replyToMessage);

// Chat status routes
router.post('/:chatId/read', chatController.markMessagesAsRead);
router.post('/:chatId/typing', chatController.updateTypingStatus);

// Search routes
router.get('/search', chatController.searchChats);
router.get('/:chatId/search', chatController.searchMessages);

module.exports = router;

