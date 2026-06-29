import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import prisma from "./prismaClient.js";
import jwt from "jsonwebtoken";
import authMiddleware from "./middleware/auth.js";
import { Resend } from "resend";

dotenv.config();

const app = express();

const resend = new Resend(process.env.RESEND_API_KEY);

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
      select: { id: true, name: true, email: true, createdAt: true },
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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
