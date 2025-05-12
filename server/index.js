const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5001;

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    // Sanitize filename
    const sanitizedFilename = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, Date.now() + '-' + sanitizedFilename);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    const filetypes = /pdf|doc|docx/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);

    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('Only PDF, DOC, and DOCX files are allowed!'));
    }
  }
});

// Configure nodemailer with SMTP
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_PORT === '465', // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD
  },
  tls: {
    rejectUnauthorized: false // Accept self-signed certificates
  }
});

// Verify SMTP connection
transporter.verify(function(error, success) {
  if (error) {
    console.error('SMTP Connection Error:', error);
  } else {
    console.log('SMTP Server is ready to take our messages');
  }
});

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// CORS configuration
const allowedOrigins = [
  'http://localhost:5173', // Local frontend
  'https://your-frontend-domain.com' // Replace with your production frontend domain
];

const corsOptions = {
  origin: (origin, callback) => {
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      callback(null, true); // Allow the origin
    } else {
      callback(new Error('Not allowed by CORS')); // Reject the origin
    }
  }
};

// Middleware
app.use(cors(corsOptions)); // Use CORS with specified options
app.use(express.json());

// Blog API
app.use('/api/blogs', require('./routes/blogs'));

// Positions API
app.use('/api/positions', require('./routes/positions'));

// Job application endpoint
app.post('/api/careers/apply', upload.single('resume'), async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      experience,
      currentCompany,
      expectedSalary,
      noticePeriod,
      position
    } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'Resume file is required' });
    }

    const resumePath = req.file.path;

    // Email content
    const mailOptions = {
      from: `"MeeraAI Careers" <${process.env.SMTP_USER}>`,
      to: process.env.CONTACT_EMAIL,
      subject: `New Job Application: ${position}`,
      html: `
        <h2>New Job Application Received</h2>
        <p><strong>Position:</strong> ${position}</p>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phone}</p>
        <p><strong>Experience:</strong> ${experience} years</p>
        <p><strong>Current Company:</strong> ${currentCompany || 'N/A'}</p>
        <p><strong>Expected Salary:</strong> ${expectedSalary || 'N/A'}</p>
        <p><strong>Notice Period:</strong> ${noticePeriod || 'N/A'} days</p>
      `,
      attachments: [
        {
          filename: path.basename(resumePath),
          path: resumePath
        }
      ]
    };

    // Send email
    await transporter.sendMail(mailOptions);

    // Send confirmation email to applicant
    const confirmationMailOptions = {
      from: `"MeeraAI Careers" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Application Received - MeeraAI Tech Solutions',
      html: `
        <h2>Thank you for your application!</h2>
        <p>Dear ${name},</p>
        <p>We have received your application for the ${position} position at MeeraAI Tech Solutions.</p>
        <p>Our team will review your application and get back to you soon.</p>
        <p>Best regards,<br>MeeraAI Tech Solutions Team</p>
      `
    };

    await transporter.sendMail(confirmationMailOptions);

    // Clean up the uploaded file after sending emails
    fs.unlink(resumePath, (err) => {
      if (err) console.error('Error deleting file:', err);
    });

    res.status(200).json({ message: 'Application submitted successfully' });
  } catch (error) {
    console.error('Error processing application:', error);
    // Clean up the uploaded file if there was an error
    if (req.file) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('Error deleting file:', err);
      });
    }
    
    // Send a more specific error message to the client
    if (error.code === 'ESOCKET' || error.code === 'ECONNREFUSED') {
      return res.status(500).json({ 
        error: 'Unable to connect to email server. Please try again later.' 
      });
    }
    
    res.status(500).json({ error: 'Failed to process application' });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
