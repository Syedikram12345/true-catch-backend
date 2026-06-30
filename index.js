import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import prisma from "./prismaClient.js";
import jwt from "jsonwebtoken";
import authMiddleware from "./middleware/auth.js";
import { Resend } from "resend";
import Razorpay from "razorpay";
import crypto from "crypto";

dotenv.config();

const app = express();

const resend = new Resend(process.env.RESEND_API_KEY);

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

app.use(express.static("public"));

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("TrueCatch backend is running 🚀");
});

app.post("/api/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "All fields are required." });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(400).json({ error: "Email is already registered." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
      },
    });

    res.status(201).json({
      message: "Signup successful!",
      user: { id: user.id, name: user.name, email: user.email },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Something went wrong." });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "Email and password are required." });
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const passwordMatches = await bcrypt.compare(password, user.password);

    if (!passwordMatches) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.json({
      message: "Login successful!",
      token,
      user: { id: user.id, name: user.name, email: user.email },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Something went wrong." });
  }
});

app.get("/api/me", authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        name: true,
        email: true,
        siteId: true,
        plan: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    res.json({ user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// Create a new popup (protected — must be logged in)
app.post("/api/popups", authMiddleware, async (req, res) => {
  try {
    const { title, message, buttonText, delaySeconds } = req.body;

    if (!title || !message || !buttonText || delaySeconds === undefined) {
      return res.status(400).json({ error: "All fields are required." });
    }

    const popup = await prisma.popup.create({
      data: {
        title,
        message,
        buttonText,
        delaySeconds: Number(delaySeconds),
        userId: req.userId,
      },
    });

    res.status(201).json({ message: "Popup created!", popup });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// Get all popups for the logged-in user
app.get("/api/popups", authMiddleware, async (req, res) => {
  try {
    const popups = await prisma.popup.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: "desc" },
    });

    res.json({ popups });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// Public route — fetch a single popup's config (no auth, visitors use this)
app.get("/api/public/popups/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const popup = await prisma.popup.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        message: true,
        buttonText: true,
        delaySeconds: true,
      },
    });

    if (!popup) {
      return res.status(404).json({ error: "Popup not found." });
    }

    // Track a view every time this config is fetched
    await prisma.popup.update({
      where: { id },
      data: { views: { increment: 1 } },
    });

    res.json({ popup });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// Delete a popup (only if it belongs to the logged-in user)
app.delete("/api/popups/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const popup = await prisma.popup.findUnique({ where: { id } });

    if (!popup) {
      return res.status(404).json({ error: "Popup not found." });
    }

    if (popup.userId !== req.userId) {
      return res.status(403).json({ error: "You don't own this popup." });
    }

    await prisma.popup.delete({ where: { id } });

    res.json({ message: "Popup deleted." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// Public route — visitor submits their email through the popup

app.post("/api/public/popups/:id/submit", async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required." });
    }

    const popup = await prisma.popup.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!popup) {
      return res.status(404).json({ error: "Popup not found." });
    }

    // Find or create the contact for this email, scoped to the popup's owner
    const contact = await prisma.contact.upsert({
      where: {
        userId_email: {
          userId: popup.userId,
          email,
        },
      },
      update: {}, // contact already exists, nothing to change on the contact itself
      create: {
        email,
        userId: popup.userId,
      },
    });

    // Log this as an event on that contact's timeline
    await prisma.event.create({
      data: {
        type: "popup_submitted",
        metadata: { popupId: popup.id, popupTitle: popup.title },
        contactId: contact.id,
      },
    });

    await prisma.popup.update({
      where: { id },
      data: { conversions: { increment: 1 } },
    });

    try {
      await resend.emails.send({
        from: "TrueCatch <onboarding@resend.dev>",
        to: popup.user.email,
        subject: `New lead from "${popup.title}"`,
        html: `
          <h2>You've got a new lead! 🎉</h2>
          <p><strong>Popup:</strong> ${popup.title}</p>
          <p><strong>Visitor email:</strong> ${email}</p>
        `,
      });
    } catch (emailError) {
      console.error("Email failed to send:", emailError);
    }

    res.json({ message: "Thank you!" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Something went wrong." });
  }
});

app.post("/api/public/track", async (req, res) => {
  try {
    const { popupId, email, type, metadata } = req.body;

    if (!email || !type) {
      return res.status(400).json({ error: "email and type are required." });
    }

    // We need to know which TrueCatch user this event belongs to.
    // For now, we derive it from a popup ID (since that's the only "identity" we have on a page).
    const popup = await prisma.popup.findUnique({ where: { id: popupId } });

    if (!popup) {
      return res.status(404).json({ error: "Popup not found." });
    }

    const contact = await prisma.contact.upsert({
      where: {
        userId_email: { userId: popup.userId, email },
      },
      update: {},
      create: { email, userId: popup.userId },
    });

    const event = await prisma.event.create({
      data: {
        type,
        metadata: metadata || {},
        contactId: contact.id,
      },
    });

    res.status(201).json({ event });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Something went wrong." });
  }
});

app.get("/api/contacts", authMiddleware, async (req, res) => {
  try {
    const contacts = await prisma.contact.findMany({
      where: { userId: req.userId },
      include: { events: { orderBy: { createdAt: "desc" } } },
      orderBy: { createdAt: "desc" },
    });

    res.json({ contacts });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// Public route — fetch all active widgets for a site (used by embed script)
app.get("/api/public/site/:siteId", async (req, res) => {
  try {
    const { siteId } = req.params;

    const user = await prisma.user.findUnique({
      where: { siteId },
      select: { id: true, plan: true },
    });

    if (!user) {
      return res.status(404).json({ error: "Site not found." });
    }

    const [popups, toasters] = await Promise.all([
      prisma.popup.findMany({
        where: { userId: user.id },
        select: {
          id: true,
          title: true,
          message: true,
          buttonText: true,
          delaySeconds: true,
        },
      }),
      prisma.toaster.findMany({
        where: { userId: user.id },
        select: {
          id: true,
          message: true,
          ctaText: true,
          ctaUrl: true,
          bgColor: true,
          triggerType: true,
          delaySeconds: true,
        },
      }),
    ]);

    // Track views for all toasters
    if (toasters.length > 0) {
      await prisma.toaster.updateMany({
        where: { userId: user.id },
        data: { views: { increment: 1 } },
      });
    }

    res.json({ siteId, plan: user.plan, widgets: { popups, toasters } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Something went wrong." });
  }
});
// Create a toaster
app.post("/api/toasters", authMiddleware, async (req, res) => {
  try {
    const { message, ctaText, ctaUrl, bgColor, triggerType, delaySeconds } =
      req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required." });
    }

    const toaster = await prisma.toaster.create({
      data: {
        message,
        ctaText: ctaText || null,
        ctaUrl: ctaUrl || null,
        bgColor: bgColor || "#111827",
        triggerType: triggerType || "immediate",
        delaySeconds: Number(delaySeconds) || 0,
        userId: req.userId,
      },
    });

    res.status(201).json({ message: "Toaster created!", toaster });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// Get all toasters for logged-in user
app.get("/api/toasters", authMiddleware, async (req, res) => {
  try {
    const toasters = await prisma.toaster.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: "desc" },
    });

    res.json({ toasters });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// Delete a toaster
app.delete("/api/toasters/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const toaster = await prisma.toaster.findUnique({ where: { id } });

    if (!toaster) {
      return res.status(404).json({ error: "Toaster not found." });
    }

    if (toaster.userId !== req.userId) {
      return res.status(403).json({ error: "You don't own this toaster." });
    }

    await prisma.toaster.delete({ where: { id } });

    res.json({ message: "Toaster deleted." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Something went wrong." });
  }
});

app.post("/api/payment/create-order", authMiddleware, async (req, res) => {
  try {
    const order = await razorpay.orders.create({
      amount: 19900, // amount in paise (₹199 = 19900 paise)
      currency: "INR",
      receipt: `rcpt_${Date.now()}`,
      notes: {
        userId: req.userId,
      },
    });

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create payment order." });
  }
});

app.post("/api/payment/verify", authMiddleware, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      req.body;

    // Verify the payment signature
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ error: "Invalid payment signature." });
    }

    // Upgrade the user to Pro
    await prisma.user.update({
      where: { id: req.userId },
      data: { plan: "pro" },
    });

    res.json({ message: "Payment verified! You're now on Pro. 🎉" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Payment verification failed." });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
