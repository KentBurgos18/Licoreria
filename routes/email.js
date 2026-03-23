const express = require('express');
const EmailService = require('../services/EmailService');

const router = express.Router();

// POST /email/test - Test SMTP connection
router.post('/test', async (req, res) => {
  try {
    const tenantId = req.tenantId || 1;
    const result = await EmailService.testConnection(tenantId);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error testing email connection:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /email/send - Send custom email
router.post('/send', async (req, res) => {
  try {
    const tenantId = req.tenantId || 1;
    const { to, subject, html, text } = req.body;

    if (!to || !subject || !html) {
      return res.status(400).json({
        error: 'to, subject, and html are required',
        code: 'MISSING_FIELDS'
      });
    }

    await EmailService.initialize(tenantId);
    const result = await EmailService.sendEmail(to, subject, html, text);

    res.json(result);
  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /email/verification-code - Send verification code
router.post('/verification-code', async (req, res) => {
  try {
    const tenantId = req.tenantId || 1;
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({
        error: 'email and code are required',
        code: 'MISSING_FIELDS'
      });
    }

    await EmailService.initialize(tenantId);
    const result = await EmailService.sendVerificationCode(email, code, tenantId);

    res.json(result);
  } catch (error) {
    console.error('Error sending verification code:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /email/welcome - Send welcome email
router.post('/welcome', async (req, res) => {
  try {
    const tenantId = req.tenantId || 1;
    const { email, customerName } = req.body;

    if (!email || !customerName) {
      return res.status(400).json({
        error: 'email and customerName are required',
        code: 'MISSING_FIELDS'
      });
    }

    await EmailService.initialize(tenantId);
    const result = await EmailService.sendWelcomeEmail(email, customerName, tenantId);

    res.json(result);
  } catch (error) {
    console.error('Error sending welcome email:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      code: 'INTERNAL_ERROR'
    });
  }
});

module.exports = router;
