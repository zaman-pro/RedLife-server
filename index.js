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

const Stripe = require("stripe");
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

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
    const fundsCollection = database.collection("Funds");
    const blogCollection = database.collection("Blogs");

    // use verify admin after verifyToken
    const verifyAdmin = async (req, res, next) => {
      try {
        const email = req.tokenEmail;

        if (!email) {
          return res.status(401).send({ message: "Unauthorized" });
        }

        const user = await usersCollection.findOne({ email });
        const isAdmin = user?.role === "admin";

        if (!isAdmin) {
          return res.status(403).send({ message: "Forbidden access" });
        }

        next();
      } catch (error) {
        console.error("verifyAdmin error:", error);
        return res
          .status(500)
          .send({ message: "Server error", error: error.message });
      }
    };

    // use verify Volunteer after verifyToken
    const verifyVolunteer = async (req, res, next) => {
      try {
        const email = req.tokenEmail;

        if (!email) {
          return res.status(401).send({ message: "Unauthorized" });
        }

        const user = await usersCollection.findOne({ email });
        const isVolunteerOrAdmin =
          user?.role === "volunteer" || user?.role === "admin";

        if (!isVolunteerOrAdmin) {
          return res.status(403).send({ message: "Forbidden access" });
        }

        next();
      } catch (error) {
        console.error("verifyVolunteer error:", error);
        return res
          .status(500)
          .send({ message: "Server error", error: error.message });
      }
    };

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

    // get total Funds Count;
    app.get("/founds-counts", async (req, res) => {
      const count = await fundsCollection.estimatedDocumentCount();
      res.send({ count });
    });

    // get funds
    app.get("/funds", verifyToken, async (req, res) => {
      const skip = parseInt(req.query.skip) || 0;
      const limit = parseInt(req.query.limit) || 0;

      try {
        const funds = await fundsCollection
          .find()
          .sort({ date: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        res.send(funds);
      } catch (error) {
        console.error("Error fetching funds:", error);
        res.status(500).send({ error: "Failed to fetch funds" });
      }
    });

    // create-payment-intent route
    app.post(
      "/create-payment-intent",
      verifyToken,
      verifyActive,
      async (req, res) => {
        const { amount } = req.body;

        if (!amount || isNaN(amount)) {
          return res.status(400).send({ error: "Invalid amount" });
        }

        const amountInCents = parseInt(amount * 100);
        try {
          const paymentIntent = await stripe.paymentIntents.create({
            amount: amountInCents,
            currency: "usd",
            payment_method_types: ["card"],
          });

          res.send({
            clientSecret: paymentIntent.client_secret,
          });
        } catch (err) {
          console.error(err);
          res.status(500).send({ error: "Payment intent creation failed" });
        }
      }
    );

    // save fund info after successful payment
    app.post("/funds", verifyToken, verifyActive, async (req, res) => {
      const { donorEmail, donorName, fundAmount, transactionId } = req.body;

      if (!donorEmail || !donorName || !fundAmount || !transactionId) {
        return res.status(400).send({ message: "Missing required fields" });
      }

      const fundEntry = {
        donorEmail,
        donorName,
        fundAmount,
        transactionId,
        fundDate: new Date().toISOString(),
      };

      try {
        const result = await fundsCollection.insertOne(fundEntry);
        res.send(result);
      } catch (error) {
        console.error("Error saving fund:", error);
        res.status(500).send({ error: "Failed to save fund data" });
      }
    });

    // total funding count -
    app.get("/admin/funding/total", async (req, res) => {
      try {
        const totalFunding = await fundsCollection
          .aggregate([
            {
              $group: {
                _id: null,
                total: { $sum: { $toDouble: "$fundAmount" } },
              },
            },
          ])
          .toArray();

        res.send({ total: totalFunding[0]?.total || 0 });
      } catch (error) {
        console.log("Error fetching total funding:", error);
        res.status(500).send({ error: "Failed to fetch total funding" });
      }
    });

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

    // all-my-donation-count;
    app.get("/all-my-donation-count", async (req, res) => {
      const { status, email } = req.query;
      const query = { requesterEmail: email };
      if (status) query.donationStatus = status;
      const count = await donationCollection.countDocuments(query);
      res.send({ count });
    });

    // donation-request-all-my/:email
    app.get("/my-all-donation-request/:email", async (req, res) => {
      const email = req.params.email;
      const { filter } = req.query;
      const query = { requesterEmail: email };
      if (filter) query.donationStatus = filter;
      const skip = parseInt(req.query.skip) || 0;
      const limit = parseInt(req.query.limit) || 0;
      const requests = await donationCollection
        .find(query)
        .skip(skip)
        .limit(limit)
        .toArray();
      res.send(requests);
    });

    // donation-request/:id delete
    app.delete("/donation-request/:id", async (req, res) => {
      const id = req.params.id;
      const result = await donationCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // Get donate requests by email & limit
    app.get("/donation-request", async (req, res) => {
      const email = req.query.email;
      const query = {
        requesterEmail: email,
      };
      const requests = await donationCollection.find(query).limit(3).toArray();
      res.send(requests);
    });

    // Get all donation requests
    app.get("/donation-requests", async (req, res) => {
      try {
        const { donationStatus, sort } = req.query;

        // Building query object
        const query = {};
        if (donationStatus) query.donationStatus = donationStatus;

        // Sorting logic
        const sorting = {};
        if (sort === "asc" || sort === "desc") {
          sorting.donationDate = sort === "asc" ? 1 : -1;
        }

        // Fetch data from MongoDB
        const requests = await donationCollection
          .find(query)
          .sort(sorting)
          .toArray();

        res.status(200).json(requests);
      } catch (error) {
        console.error("Error fetching donation requests:", error);
        res.status(500).json({ message: "Internal Server Error" });
      }
    });

    // donation-request/:id update with patch;
    app.patch("/donation-requests/:id", async (req, res) => {
      const id = req.params.id;
      const {
        _id,
        requesterName,
        requesterEmail,
        donationStatus,
        donorEmail,
        donorName,
        ...updateData
      } = req.body;
      const result = await donationCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateData }
      );
      res.send(result);
    });

    // get donation-request/:id
    app.get("/donation-request/:id", async (req, res) => {
      const id = req.params.id;
      const request = await donationCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(request);
    });

    // donation-request/:id update with put;
    app.put("/donation-request/:id", async (req, res) => {
      const id = req.params.id;
      const { donationStatus, donorEmail, donorName } = req.body;
      const updatedData = { donationStatus };
      if (donorEmail) updatedData.donorEmail = donorEmail;
      if (donorEmail) updatedData.donorName = donorName;
      const result = await donationCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedData }
      );
      res.send(result);
    });

    // admin
    // all user count -
    app.get("/admin/users/count", async (req, res) => {
      try {
        const userCount = await usersCollection.countDocuments({
          role: "donor",
        });
        res.send({ count: userCount });
      } catch (error) {
        console.log("Error fetching user count:", error);
        res.status(500).send({ error: "Failed to fetch user count" });
      }
    });

    // all donation-request count -
    app.get("/admin/blood-requests/count", async (req, res) => {
      try {
        const requestCount = await donationCollection.countDocuments();
        res.send({ count: requestCount });
      } catch (error) {
        console.log("Error fetching blood request count:", error);
        res.status(500).send({ error: "Failed to fetch blood request count" });
      }
    });

    // get donor by filter query
    app.get("/donors/search", async (req, res) => {
      const { bloodGroup, district, upazila } = req.query;
      const query = {};
      if (bloodGroup) query.bloodGroup = bloodGroup;
      if (district) query.district = district;
      if (upazila) query.upazila = upazila;
      if (Object.keys(query).length === 0) return res.send([]);
      const donors = await usersCollection.find(query).toArray();
      res.send(donors);
    });

    // all-users get
    app.get("/all-users", async (req, res) => {
      const { status } = req.query;
      const skip = parseInt(req.query.skip) || 0;
      const limit = parseInt(req.query.limit) || 0;
      const query = status ? { status } : {};
      const users = await usersCollection
        .find(query)
        .skip(skip)
        .limit(limit)
        .toArray();
      res.send(users);
    });

    // only total user count
    app.get("/all-users-count", async (req, res) => {
      const { status } = req.query;
      const query = status ? { status } : {};
      const count = await usersCollection.countDocuments(query);
      res.send({ count });
    });

    // patch request for user status update by admin only ;
    app.patch(
      "/user/:id/status",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const status = req.body.status;
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );
        res.send(result);
      }
    );

    // patch request for user role update by admin only ;
    app.patch("/user/:id/role", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const role = req.body.role;
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { role } }
      );
      res.send(result);
    });

    // all donation request count ;
    app.get("/all-donation-count", async (req, res) => {
      const { status } = req.query;
      const query = {};
      if (status) query.donationStatus = status;
      const count = await donationCollection.countDocuments(query);
      res.send({ count });
    });

    app.get("/all-blood-donation-request", async (req, res) => {
      try {
        const { filter, sort, skip, limit } = req.query;

        // Building query object
        const query = {};
        if (filter) query.donationStatus = filter;

        // Sorting logic
        const sorting = {};
        if (sort === "asc" || sort === "desc") {
          sorting.donationDate = sort === "asc" ? 1 : -1;
        }

        // Ensure skip and limit are valid numbers
        const skipValue = Number(skip) >= 0 ? Number(skip) : 0;
        const limitValue = Number(limit) > 0 ? Number(limit) : 0;

        // Fetch data from MongoDB
        const requests = await donationCollection
          .find(query)
          .sort(sorting)
          .skip(skipValue)
          .limit(limitValue)
          .toArray();

        res.status(200).send(requests);
      } catch (error) {
        console.error("Error fetching donation requests:", error);
        res.status(500).json({ message: "Internal Server Error" });
      }
    });

    // get blogs;
    app.get("/blogs", verifyToken, verifyVolunteer, async (req, res) => {
      const { status } = req.query;
      const query = status ? { status } : {};
      const blogs = await blogCollection.find(query).toArray();
      res.send(blogs);
    });

    // all blog count ;
    app.get("/all-blogs-count", async (req, res) => {
      const { status } = req.query;
      const query = {};
      if (status) query.status = status;
      const count = await blogCollection.countDocuments(query);
      res.send({ count });
    });

    app.get("/all-blogs", async (req, res) => {
      try {
        const { status, sort, skip, limit } = req.query;

        const query = {};
        if (status) query.status = status;

        const sorting = {};
        if (sort === "asc" || sort === "desc") {
          sorting.createdAt = sort === "asc" ? 1 : -1;
        }

        const skipValue = Math.max(0, Number(skip) || 0);
        const limitValue = Math.max(0, Number(limit) || 0);

        const blogs = await blogCollection
          .find(query)
          .sort(sorting)
          .skip(skipValue)
          .limit(limitValue)
          .toArray();

        res.status(200).send(blogs);
      } catch (error) {
        console.error("Error fetching blogs:", error);
        res.status(500).json({ message: "Internal Server Error" });
      }
    });

    // get blogs-published;
    app.get("/blogs-published", async (req, res) => {
      const query = { status: "published" };
      const blogs = await blogCollection.find(query).toArray();
      res.send(blogs);
    });

    // Post a blog;
    app.post("/blogs", async (req, res) => {
      const blog = req.body;
      const result = await blogCollection.insertOne({
        ...blog,
        status: "draft",
      });
      res.send(result);
    });

    // get blog by id;
    app.get("/blogs/:id", async (req, res) => {
      const id = req.params.id;
      const blog = await blogCollection.findOne({ _id: new ObjectId(id) });
      res.send(blog);
    });

    // delete blog;
    app.delete("/blog/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const result = await blogCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // patch blog status;
    app.patch("/blogs/:id", verifyToken, verifyVolunteer, async (req, res) => {
      const id = req.params.id;
      const status = req.body.status;
      const result = await blogCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } }
      );
      res.send(result);
    });
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("RedLife-server Running");
});

app.listen(port, () => {
  console.log(`server port: ${port}`);
});
