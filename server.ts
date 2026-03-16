
import express from "express";
import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // AI Status Check
  app.get("/api/ai-status", (req, res) => {
    res.json({ 
      configured: !!process.env.GEMINI_API_KEY,
      mode: "server-proxy"
    });
  });

  // Gemini Proxy Endpoint
  app.post("/api/gemini", async (req, res) => {
    const { model, contents, config } = req.body;
    
    if (!process.env.GEMINI_API_KEY) {
      console.error("Gemini Proxy Error: GEMINI_API_KEY is not set in environment.");
      return res.status(500).json({ 
        error: "Gemini API key not configured on server. Please set GEMINI_API_KEY in the environment." 
      });
    }

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      // Handle both single string contents and complex parts/contents
      const response = await ai.models.generateContent({
        model,
        contents,
        config
      });
      
      // Return the full response object
      res.json(response);
    } catch (error) {
      console.error("Gemini Proxy Error:", error);
      res.status(500).json({ 
        error: "Gemini API Error", 
        details: error instanceof Error ? error.message : String(error) 
      });
    }
  });

  // API Route for sending emails
  app.post("/api/test-email", async (req, res) => {
  try {
    console.log("--- SMTP Connection Test Started ---");
    
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.log("Test failed: Missing credentials.");
      return res.status(400).json({ 
        error: "Missing SMTP credentials. Please configure SMTP_HOST, SMTP_USER, and SMTP_PASS in settings." 
      });
    }

    const port = parseInt(process.env.SMTP_PORT || "587");
    const isSecure = port === 465 ? true : (port === 587 ? false : process.env.SMTP_SECURE === "true");
    const cleanPass = process.env.SMTP_PASS.trim();

    console.log(`Testing connection to ${process.env.SMTP_HOST}:${port} (Secure: ${isSecure})`);

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: port,
      secure: isSecure,
      auth: {
        user: process.env.SMTP_USER,
        pass: cleanPass,
      },
      connectionTimeout: 20000,
      greetingTimeout: 20000,
      socketTimeout: 20000,
      tls: {
        rejectUnauthorized: false
      }
    });

    console.log("Verifying SMTP connection...");
    await transporter.verify();
    console.log("SMTP connection verified successfully.");

    // Send a minimal test email to the sender themselves
    console.log(`Sending test email to ${process.env.SMTP_USER}...`);
    const info = await transporter.sendMail({
      from: `"American Iron Test" <${process.env.SMTP_USER}>`,
      to: process.env.SMTP_USER,
      subject: "SMTP Connection Test - American Iron Dispatch",
      text: "This is a test email to verify your SMTP configuration. If you received this, your email dispatch system is correctly configured.",
      html: `<div style="font-family: sans-serif; padding: 20px; border: 2px solid #fbbf24; border-radius: 12px; background-color: #fffbeb;">
              <h2 style="color: #000; margin-top: 0;">Connection Test Successful</h2>
              <p>Your SMTP configuration for the <strong>American Iron Dispatch Hub</strong> is working correctly.</p>
              <hr style="border: none; border-top: 1px solid #fde68a; margin: 20px 0;" />
              <p style="font-size: 12px; color: #92400e;">Timestamp: ${new Date().toISOString()}</p>
            </div>`
    });

    console.log("Test email sent: %s", info.messageId);
    console.log("--- SMTP Connection Test Completed Successfully ---");

    res.json({ 
      success: true, 
      message: "SMTP connection verified and test email sent successfully.",
      messageId: info.messageId
    });

  } catch (error) {
    console.error("--- SMTP Connection Test Failed ---");
    console.error(error);
    res.status(500).json({ 
      error: "SMTP Test Failed", 
      details: error instanceof Error ? error.message : String(error) 
    });
  }
});

app.post("/api/send-email", async (req, res) => {
    const { to, subject, body, attachment, filename, attachments } = req.body;

    if (!to || !subject || !body) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      // ... (transporter setup code)
      
      let transporter;
      let isSimulated = false;
      
      if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
        const port = parseInt(process.env.SMTP_PORT || "587");
        // Port 465 requires secure: true. Port 587 requires secure: false (uses STARTTLS).
        const isSecure = port === 465 ? true : (port === 587 ? false : process.env.SMTP_SECURE === "true");
        const cleanPass = process.env.SMTP_PASS.trim();

        console.log(`Attempting SMTP connection to ${process.env.SMTP_HOST}:${port} (Secure: ${isSecure})`);

        transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: port,
          secure: isSecure,
          auth: {
            user: process.env.SMTP_USER,
            pass: cleanPass,
          },
          connectionTimeout: 30000, // 30 seconds
          greetingTimeout: 30000,
          socketTimeout: 60000, // 60 seconds for large attachments
          tls: {
            rejectUnauthorized: false
          }
        });
      } else {
        isSimulated = true;
      }

      if (isSimulated) {
        console.log("No SMTP credentials provided. Simulating email send.");
        await new Promise(resolve => setTimeout(resolve, 1500));
        return res.json({ 
          success: true, 
          messageId: `simulated-${Date.now()}`,
          simulated: true,
          note: "Email was simulated. Please configure SMTP_HOST, SMTP_USER, and SMTP_PASS in settings to send real emails."
        });
      } else {
        try {
          console.log("Verifying SMTP connection...");
          await transporter.verify();
          console.log("SMTP connection verified successfully.");
        } catch (verifyError) {
          console.error("SMTP Verification Error:", verifyError);
          return res.status(500).json({ 
            error: "SMTP Connection/Authentication Failed. Check your App Password and Port.", 
            details: verifyError instanceof Error ? verifyError.message : String(verifyError) 
          });
        }
      }

      const senderEmail = process.env.SMTP_USER || 'dispatch@americanironus.com';
      
      // Prepare attachments array
      const emailAttachments = [];
      const processAttachment = (att) => {
        if (att.path && typeof att.path === 'string' && att.path.startsWith('data:')) {
          const parts = att.path.split(';base64,');
          if (parts.length === 2) {
            const mimeType = parts[0].split(':')[1]?.split(';')[0] || 'application/octet-stream';
            console.log(`Processing base64 attachment: ${att.filename} (${mimeType})`);
            return {
              filename: att.filename,
              content: parts[1],
              encoding: 'base64',
              contentType: mimeType
            };
          }
        }
        return att;
      };

      if (attachments && Array.isArray(attachments)) {
        console.log(`Preparing ${attachments.length} attachments...`);
        emailAttachments.push(...attachments.map(processAttachment));
      } else if (attachment) {
        console.log("Preparing single legacy attachment...");
        emailAttachments.push(processAttachment({
          filename: filename || 'Document.pdf',
          path: attachment
        }));
      }

      console.log(`Sending email to ${to} with ${emailAttachments.length} attachments...`);
      const info = await transporter.sendMail({
        from: `"American Iron Dispatch" <${senderEmail}>`,
        to,
        subject,
        text: body,
        html: `<div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                <h2 style="color: #000;">American Iron Dispatch</h2>
                <hr />
                <div style="white-space: pre-wrap;">${body}</div>
                <hr />
                <p style="font-size: 12px; color: #666;">This is an automated dispatch from the American Iron Invoicing System.</p>
              </div>`,
        attachments: emailAttachments
      });

      console.log("Message sent successfully: %s", info.messageId);
      const previewUrl = nodemailer.getTestMessageUrl(info);
      
      res.json({ 
        success: true, 
        messageId: info.messageId,
        previewUrl: previewUrl || undefined 
      });
    } catch (error) {
      console.error("Email error:", error);
      res.status(500).json({ error: "Failed to send email", details: error instanceof Error ? error.message : String(error) });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
