require("dotenv").config();

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const express = require("express");
const cors = require("cors");

const admin = require("firebase-admin");
const decoded = Buffer.from(
  process.env.FB_SERVICE_ACCOUNT_KEY,
  "base64"
).toString("utf-8");
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = process.env.MONGODB_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// jwt verify middleware
const verifyToken = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).send({ message: "Unauthorized Access" });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    next();
  } catch (error) {
    console.error("Token verification failed", error);
    return res.status(401).send({ message: "Unauthorized Access" });
  }
};

async function run() {
  try {
    console.log("You successfully connected to MongoDB!");

    const database = client.db("RedLifeDB");
    const usersCollection = database.collection("users");
    const donationCollection = database.collection("Donation");

    // verify active user;
    const verifyActive = async (req, res, next) => {
      try {
        const email = req.tokenEmail;

        if (!email) {
          return res.status(401).send({ message: "Unauthorized" });
        }

        const user = await usersCollection.findOne({ email });
        const isActive = user?.status === "active";

        if (!isActive) {
          return res.status(403).send({ message: "Forbidden access" });
        }

        next();
      } catch (error) {
        console.error("verifyActive error:", error);
        return res
          .status(500)
          .send({ message: "Server error", error: error.message });
      }
    };

    // save or update a users data in db
    app.post("/add-user", async (req, res) => {
      const userData = req.body;
      userData.role = "donor";
      userData.status = "active";
      userData.created_at = new Date().toISOString();
      userData.last_loggedIn = new Date().toISOString();
      const query = {
        email: userData?.email,
      };
      const alreadyExists = await usersCollection.findOne(query);
      // console.log("User already exists: ", !!alreadyExists);
      if (!!alreadyExists) {
        // console.log("Updating user data......");
        const result = await usersCollection.updateOne(query, {
          $set: { last_loggedIn: new Date().toISOString() },
        });
        return res.send(result);
      }

      // console.log("Creating user data......");
      //   console.log(userData);
      const result = await usersCollection.insertOne(userData);
      res.send(result);
    });

    // get user data by email
    app.get("/user/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      try {
        const user = await usersCollection.findOne({ email: email });
        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }
        res.send(user);
      } catch (err) {
        res.status(500).send({ message: "Internal server error", error: err });
      }
    });

    // update profile by email
    app.put("/user/:email", verifyToken, async (req, res) => {
      if (req.tokenEmail !== req.params.email) {
        return res.status(403).send({ message: "Forbidden" });
      }
      const email = req.params.email;
      const updatedData = req.body;

      // no one can change this input so delete it from request
      delete updatedData.email;
      delete updatedData.role;
      delete updatedData.status;

      try {
        const result = await usersCollection.updateOne(
          { email },
          { $set: updatedData }
        );
        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "User not found" });
        }
        res.send({ message: "User updated successfully" });
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
      }
    });

    // Create donate request
    app.post(
      "/create-donate-request",
      verifyToken,
      verifyActive,
      async (req, res) => {
        const donateRequest = req.body;

        try {
          const result = await donationCollection.insertOne({
            ...donateRequest,
            donationStatus: "pending",
          });
          return res.send(result);
        } catch (error) {
          console.error("Donation creation error:", error);
          return res.status(500).send({
            message: "Failed to create donation request",
            error: error.message,
          });
        }
      }
    );
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("A12-RedLife-server-side Running");
});

app.listen(port, () => {
  console.log(`server port: ${port}`);
});
