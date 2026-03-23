const nodemailer = require('nodemailer');
const { Setting } = require('../models');
const crypto = require('crypto');

// Función para desencriptar (debe coincidir con routes/settings.js)
// Genera una clave consistente usando SHA-256
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.createHash('sha256').update(process.env.JWT_SECRET || 'change-me').digest('hex');
const ALGORITHM = 'aes-256-cbc';

function decrypt(text) {
  if (!text) return null;
  if (!text.includes(':')) return text; // No está encriptado
  try {
    const parts = text.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const key = Buffer.from(ENCRYPTION_KEY.slice(0, 64), 'hex'); // 64 hex = 32 bytes
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    return text; // Fallback: devolver tal cual
  }
}

class EmailService {
  constructor() {
    this.transporter = null;
  }

  async initialize(tenantId = 1) {
    try {
      // Obtener configuración SMTP
      const smtpHost = await Setting.getSetting(tenantId, 'smtp_host', '');
      const smtpPort = parseInt(await Setting.getSetting(tenantId, 'smtp_port', 587));
      const smtpUser = await Setting.getSetting(tenantId, 'smtp_user', '');
      const smtpPasswordEncrypted = await Setting.getSetting(tenantId, 'smtp_password', '');
      
      if (!smtpHost || !smtpUser || !smtpPasswordEncrypted) {
        throw new Error('SMTP configuration is incomplete');
      }

      const smtpPassword = decrypt(smtpPasswordEncrypted);

      // Configuración según el puerto:
      // - Puerto 465: SSL directo (secure: true)
      // - Puerto 587: STARTTLS (secure: false, pero con requireTLS)
      const useSSL = smtpPort === 465;
      
      const transportConfig = {
        host: smtpHost,
        port: smtpPort,
        secure: useSSL, // true solo para puerto 465
        auth: {
          user: smtpUser,
          pass: smtpPassword
        }
      };

      // Para puerto 587, forzar STARTTLS
      if (smtpPort === 587) {
        transportConfig.requireTLS = true;
        transportConfig.tls = {
          ciphers: 'SSLv3',
          rejectUnauthorized: false
        };
      }

      this.transporter = nodemailer.createTransport(transportConfig);

      // Verificar conexión
      await this.transporter.verify();
      return true;
    } catch (error) {
      console.error('Error initializing email service:', error);
      throw error;
    }
  }

  async sendEmail(to, subject, html, text = null) {
    if (!this.transporter) {
      throw new Error('Email service not initialized. Call initialize() first.');
    }

    try {
      const fromEmail = await Setting.getSetting(1, 'smtp_from_email', 'noreply@licoreria.com');
      const defaultFromName = await Setting.getSetting(1, 'brand_slogan', 'Sistema de Licorería');
      const fromName = await Setting.getSetting(1, 'smtp_from_name', defaultFromName);

      const mailOptions = {
        from: `"${fromName}" <${fromEmail}>`,
        to: Array.isArray(to) ? to.join(', ') : to,
        subject,
        text: text || html.replace(/<[^>]*>/g, ''), // Convertir HTML a texto plano
        html
      };

      const info = await this.transporter.sendMail(mailOptions);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('Error sending email:', error);
      throw error;
    }
  }

  async sendVerificationCode(email, code, tenantId = 1) {
    const brandSlogan = await Setting.getSetting(tenantId, 'brand_slogan', 'Sistema de Licorería');
    const subject = await Setting.getSetting(tenantId, 'email_subject_verification_code', 'Código de Verificación');
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px; }
          .code { background: #fff; border: 2px dashed #667eea; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; color: #667eea; margin: 20px 0; border-radius: 8px; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${brandSlogan}</h1>
          </div>
          <div class="content">
            <h2>Código de Verificación</h2>
            <p>Gracias por registrarte. Para completar tu registro, por favor ingresa el siguiente código de verificación:</p>
            <div class="code">${code}</div>
            <p>Este código expirará en 15 minutos.</p>
            <p>Si no solicitaste este código, por favor ignora este correo.</p>
          </div>
          <div class="footer">
            <p>Este es un correo automático, por favor no responder.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail(email, subject, html);
  }

  async sendWelcomeEmail(email, customerName, tenantId = 1) {
    const brandSlogan = await Setting.getSetting(tenantId, 'brand_slogan', 'Sistema de Licorería');
    const subject = await Setting.getSetting(tenantId, 'email_subject_welcome', 'Bienvenido');
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${brandSlogan}</h1>
          </div>
          <div class="content">
            <h2>Hola ${customerName},</h2>
            <p>Te damos la bienvenida a nuestro sistema de licorería. Tu cuenta ha sido creada exitosamente.</p>
            <p>Ahora puedes:</p>
            <ul>
              <li>Explorar nuestro catálogo de productos</li>
              <li>Realizar compras en línea</li>
              <li>Participar en compras grupales</li>
              <li>Gestionar tus créditos y pagos</li>
            </ul>
            <p>¡Esperamos que disfrutes de nuestros servicios!</p>
          </div>
          <div class="footer">
            <p>Este es un correo automático, por favor no responder.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail(email, subject, html);
  }

  async sendPasswordResetCode(email, code, tenantId = 1) {
    const brandSlogan = await Setting.getSetting(tenantId, 'brand_slogan', 'Sistema de Licorería');
    const subject = await Setting.getSetting(tenantId, 'email_subject_password_reset', 'Código de Recuperación de Contraseña');
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #1a1a2e 0%, #0f3460 100%); color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px; }
          .code { background: #fff; border: 2px dashed #0f3460; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; color: #0f3460; margin: 20px 0; border-radius: 8px; letter-spacing: 0.2em; }
          .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${brandSlogan}</h1>
            <p style="margin: 0; opacity: 0.9;">Recuperación de Contraseña</p>
          </div>
          <div class="content">
            <h2>Hola,</h2>
            <p>Has solicitado recuperar tu contraseña. Para continuar, ingresa el siguiente código de verificación:</p>
            <div class="code">${code}</div>
            <div class="warning">
              <strong>⚠ Importante:</strong> Este código expirará en 15 minutos. Si no solicitaste este código, por favor ignora este correo y tu contraseña permanecerá sin cambios.
            </div>
            <p>Si no solicitaste este código, puedes ignorar este mensaje de forma segura.</p>
          </div>
          <div class="footer">
            <p>Este es un correo automático, por favor no responder.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail(email, subject, html);
  }

  async sendTemporaryPassword(email, tempPassword, tenantId = 1) {
    const brandSlogan = await Setting.getSetting(tenantId, 'brand_slogan', 'Sistema de Licorería');
    const subject = await Setting.getSetting(tenantId, 'email_subject_temporary_password', 'Clave Temporal');
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #1a1a2e 0%, #0f3460 100%); color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px; }
          .password { background: #fff; border: 2px solid #28a745; padding: 20px; text-align: center; font-size: 24px; font-weight: bold; color: #28a745; margin: 20px 0; border-radius: 8px; font-family: 'Courier New', monospace; letter-spacing: 0.1em; }
          .instructions { background: #e7f3ff; border-left: 4px solid #0d6efd; padding: 15px; margin: 20px 0; border-radius: 4px; }
          .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${brandSlogan}</h1>
            <p style="margin: 0; opacity: 0.9;">Clave Temporal</p>
          </div>
          <div class="content">
            <h2>Hola,</h2>
            <p>Tu código de verificación ha sido validado correctamente. Aquí está tu clave temporal:</p>
            <div class="password">${tempPassword}</div>
            <div class="instructions">
              <strong>📋 Instrucciones:</strong>
              <ol style="margin: 10px 0; padding-left: 20px;">
                <li>Ingresa esta clave temporal en el campo correspondiente</li>
                <li>Ingresa tu nueva contraseña (mínimo 6 caracteres)</li>
                <li>Confirma tu nueva contraseña</li>
                <li>Haz clic en "Actualizar Contraseña"</li>
              </ol>
            </div>
            <div class="warning">
              <strong>⚠ Importante:</strong> Esta clave temporal expirará en 5 minutos. Una vez que cambies tu contraseña, podrás iniciar sesión normalmente con tu nueva contraseña.
            </div>
            <p>Si no solicitaste este cambio, por favor contacta con soporte inmediatamente.</p>
          </div>
          <div class="footer">
            <p>Este es un correo automático, por favor no responder.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail(email, subject, html);
  }

  async testConnection(tenantId = 1) {
    try {
      await this.initialize(tenantId);
      return { success: true, message: 'SMTP connection successful' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }
}

module.exports = new EmailService();
