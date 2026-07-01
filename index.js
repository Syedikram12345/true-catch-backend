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
import { UAParser } from "ua-parser-js";
import fetch from "node-fetch";

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

// ─── Health Check ───────────────────────────────────────────────
app.get("/", (req, res) => {
  res.send("TrueCatch backend is running 🚀");
});

// ─── Auth ────────────────────────────────────────────────────────
app.post("/api/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "All fields are required." });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (existingUser) {
      return res.status(400).json({ error: "Email is already registered." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: { name, email, password: hashedPassword },
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

    const user = await prisma.user.findUnique({ where: { email } });

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

app.put("/api/me", authMiddleware, async (req, res) => {
  try {
    const { name, currentPassword, newPassword } = req.body;

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const updateData = {};

    // Update name if provided
    if (name && name.trim()) {
      updateData.name = name.trim();
    }

    // Update password if provided
    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({
          error: "Current password is required to set a new one.",
        });
      }

      const passwordMatches = await bcrypt.compare(
        currentPassword,
        user.password,
      );

      if (!passwordMatches) {
        return res
          .status(401)
          .json({ error: "Current password is incorrect." });
      }

      updateData.password = await bcrypt.hash(newPassword, 10);
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: "Nothing to update." });
    }

    const updated = await prisma.user.update({
      where: { id: req.userId },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        siteId: true,
        plan: true,
        createdAt: true,
      },
    });

    res.json({ message: "Profile updated!", user: updated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ─── Popups ──────────────────────────────────────────────────────
app.post("/api/popups", authMiddleware, async (req, res) => {
  try {
    const { title, message, buttonText, delaySeconds } = req.body;

    if (!title || !message || !buttonText || delaySeconds === undefined) {
      return res.status(400).json({ error: "All fields are required." });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { plan: true },
    });

    if (user.plan === "free") {
      const popupCount = await prisma.popup.count({
        where: { userId: req.userId },
      });

      if (popupCount >= 3) {
        return res.status(403).json({
          error:
            "Free plan limit reached. Upgrade to Pro for unlimited popups.",
          limitReached: true,
        });
      }
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

// ─── Toasters ────────────────────────────────────────────────────
app.post("/api/toasters", authMiddleware, async (req, res) => {
  try {
    const { message, ctaText, ctaUrl, bgColor, triggerType, delaySeconds } =
      req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required." });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { plan: true },
    });

    if (user.plan === "free") {
      const toasterCount = await prisma.toaster.count({
        where: { userId: req.userId },
      });

      if (toasterCount >= 1) {
        return res.status(403).json({
          error:
            "Free plan limit reached. Upgrade to Pro for unlimited toasters.",
          limitReached: true,
        });
      }
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

// ─── Public Routes ───────────────────────────────────────────────
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

    // Parse visitor's device/browser info
    const userAgent = req.headers["user-agent"] || "";
    const isMobile = /mobile/i.test(userAgent);
    const isTablet = /tablet|ipad/i.test(userAgent);
    const deviceType = isTablet ? "tablet" : isMobile ? "mobile" : "desktop";

    const browserMatch = userAgent.match(
      /(chrome|safari|firefox|edge|opera|brave)/i,
    );
    const browser = browserMatch ? browserMatch[0] : "Unknown";

    const osMatch = userAgent.match(
      /(windows|mac|linux|android|ios|iphone|ipad)/i,
    );
    const os = osMatch ? osMatch[0] : "Unknown";

    // Record a PopupView for each popup
    if (popups.length > 0) {
      await Promise.all(
        popups.map((popup) =>
          prisma.popupView.create({
            data: {
              popupId: popup.id,
              deviceType,
              browser,
              os,
            },
          }),
        ),
      );

      // Increment views on each popup
      await prisma.popup.updateMany({
        where: { userId: user.id },
        data: { views: { increment: 1 } },
      });
    }

    // Track views for toasters
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

app.post("/api/public/popups/:id/submit", async (req, res) => {
  try {
    const { id } = req.params;
    const { email, visitorId, context } = req.body;

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

    // Plan gating
    if (popup.user.plan === "free") {
      const contactCount = await prisma.contact.count({
        where: { userId: popup.userId },
      });
      if (contactCount >= 100) {
        return res.json({ message: "Thank you!" });
      }
    }

    // Parse device/browser
    const userAgent = req.headers["user-agent"] || "";
    const parser = new UAParser(userAgent);
    const uaResult = parser.getResult();
    const device = uaResult.device.type || "desktop";
    const browser = uaResult.browser.name || "Unknown";
    const os = uaResult.os.name || "Unknown";

    // Geo lookup
    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "";

    let country = null;
    let city = null;

    if (ip && ip !== "::1" && !ip.startsWith("127.")) {
      try {
        const geoRes = await fetch(
          `http://ip-api.com/json/${ip}?fields=country,city,status`,
        );
        const geoData = await geoRes.json();
        if (geoData.status === "success") {
          country = geoData.country;
          city = geoData.city;
        }
      } catch (geoErr) {
        console.error("Geo lookup failed:", geoErr);
      }
    }

    // Find or create contact with full enrichment
    const contact = await prisma.contact.upsert({
      where: {
        userId_email: { userId: popup.userId, email },
      },
      update: { device, browser, os, country, city, pageUrl: context?.url },
      create: {
        email,
        userId: popup.userId,
        device,
        browser,
        os,
        country,
        city,
        pageUrl: context?.url || null,
      },
    });

    // Merge anonymous events
    if (visitorId) {
      await prisma.event.updateMany({
        where: { visitorId, contactId: null },
        data: { contactId: contact.id },
      });
    }

    await prisma.event.create({
      data: {
        type: "popup_submitted",
        metadata: {
          popupId: popup.id,
          popupTitle: popup.title,
          device,
          browser,
          os,
          country,
          city,
          url: context?.url || null,
        },
        visitorId: visitorId || null,
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
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Popup:</strong> ${popup.title}</p>
          <p><strong>Device:</strong> ${device} · ${browser} · ${os}</p>
          ${country ? `<p><strong>Location:</strong> ${city ? city + ", " : ""}${country}</p>` : ""}
          ${context?.url ? `<p><strong>Page:</strong> ${context.url}</p>` : ""}
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

// ─── Contacts ────────────────────────────────────────────────────
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

// ─── Payments ────────────────────────────────────────────────────
app.post("/api/payment/create-order", authMiddleware, async (req, res) => {
  try {
    const order = await razorpay.orders.create({
      amount: 19900,
      currency: "INR",
      receipt: `rcpt_${Date.now()}`,
      notes: { userId: req.userId },
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

    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ error: "Invalid payment signature." });
    }

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

//_______________________________________________analytics route_______________________________________________________________________

app.get("/api/analytics", authMiddleware, async (req, res) => {
  try {
    const token = req.userId;

    // Get all popups for this user
    const popups = await prisma.popup.findMany({
      where: { userId: req.userId },
      select: { id: true, title: true, views: true, conversions: true },
    });

    const popupIds = popups.map((p) => p.id);

    // Get all PopupViews for this user's popups
    const views = await prisma.popupView.findMany({
      where: { popupId: { in: popupIds } },
      orderBy: { createdAt: "desc" },
    });

    // Device breakdown
    const deviceBreakdown = views.reduce((acc, v) => {
      acc[v.deviceType] = (acc[v.deviceType] || 0) + 1;
      return acc;
    }, {});

    // Browser breakdown
    const browserBreakdown = views.reduce((acc, v) => {
      acc[v.browser] = (acc[v.browser] || 0) + 1;
      return acc;
    }, {});

    // Views over last 7 days
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - i));
      return date.toISOString().split("T")[0];
    });

    const viewsByDay = last7Days.map((date) => ({
      date,
      views: views.filter(
        (v) => v.createdAt.toISOString().split("T")[0] === date,
      ).length,
    }));

    // Top widgets by views
    const topWidgets = popups
      .sort((a, b) => b.views - a.views)
      .slice(0, 5)
      .map((p) => ({
        name: p.title,
        views: p.views,
        conversions: p.conversions,
        conversionRate:
          p.views > 0 ? ((p.conversions / p.views) * 100).toFixed(1) : "0.0",
      }));

    res.json({
      totalViews: views.length,
      deviceBreakdown,
      browserBreakdown,
      viewsByDay,
      topWidgets,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// Public route — track any custom event (anonymous or identified)
app.post("/api/public/events", async (req, res) => {
  try {
    const { siteId, visitorId, email, type, metadata, context } = req.body;

    if (!type || !siteId) {
      return res.status(400).json({ error: "type and siteId are required." });
    }

    const user = await prisma.user.findUnique({
      where: { siteId },
      select: { id: true, plan: true },
    });

    if (!user) {
      return res.status(404).json({ error: "Site not found." });
    }

    // ── Parse browser/device from user agent ──────────────────
    const userAgent = req.headers["user-agent"] || "";
    const parser = new UAParser(userAgent);
    const uaResult = parser.getResult();

    const device = uaResult.device.type || "desktop";
    const browser = uaResult.browser.name || "Unknown";
    const os = uaResult.os.name || "Unknown";

    // ── Get country/city from IP ──────────────────────────────
    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "";

    let country = null;
    let city = null;

    // Only do geo lookup for real IPs (not localhost)
    if (ip && ip !== "::1" && !ip.startsWith("127.")) {
      try {
        const geoRes = await fetch(
          `http://ip-api.com/json/${ip}?fields=country,city,status`,
        );
        const geoData = await geoRes.json();
        if (geoData.status === "success") {
          country = geoData.country;
          city = geoData.city;
        }
      } catch (geoErr) {
        console.error("Geo lookup failed:", geoErr);
      }
    }

    // ── Build rich metadata ───────────────────────────────────
    const enrichedMetadata = {
      ...metadata,
      // Context from browser (sent by embed script)
      url: context?.url || null,
      referrer: context?.referrer || null,
      screen: context?.screen || null,
      timezone: context?.timezone || null,
      language: context?.language || null,
      // Enriched on backend
      device,
      browser,
      os,
      country,
      city,
    };

    let contactId = null;

    // ── Identify if email is known ────────────────────────────
    if (email) {
      const contact = await prisma.contact.upsert({
        where: {
          userId_email: { userId: user.id, email },
        },
        update: {
          device,
          browser,
          os,
          country,
          city,
          pageUrl: context?.url || undefined,
        },
        create: {
          email,
          userId: user.id,
          device,
          browser,
          os,
          country,
          city,
          pageUrl: context?.url || undefined,
        },
      });

      contactId = contact.id;

      // Merge all previous anonymous events from this visitorId
      if (visitorId) {
        await prisma.event.updateMany({
          where: { visitorId, contactId: null },
          data: { contactId: contact.id },
        });
      }
    }

    // ── Create the event ─────────────────────────────────────
    await prisma.event.create({
      data: {
        type,
        metadata: enrichedMetadata,
        visitorId: visitorId || null,
        contactId,
      },
    });

    res.status(201).json({ message: "Event tracked." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// Get events for a specific contact (for the contact detail view)
app.get("/api/contacts/:id/events", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const contact = await prisma.contact.findUnique({
      where: { id },
    });

    if (!contact || contact.userId !== req.userId) {
      return res.status(404).json({ error: "Contact not found." });
    }

    const events = await prisma.event.findMany({
      where: { contactId: id },
      orderBy: { createdAt: "desc" },
    });

    res.json({ events });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ─── Server ──────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
