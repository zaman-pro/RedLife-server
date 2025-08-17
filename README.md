# RedLife - Server

This is the backend API for the RedLife blood donation platform. Built with Node.js, Express, MongoDB, and Firebase Admin SDK for secure user verification and role-based API protection.

## 📌 API Base URL

🛠️ `https://redlife-server.vercel.app`

## 🔐 Admin Access (Client Login)

- **Email**: admin@redlife.com
- **Password**: Pa$$w0rd!!

## 📌 Features

1. 🔐 **JWT Authentication** — All protected routes are secured using Firebase-based JWT tokens.
2. ⚙️ **Role & Status Middleware** — Verify roles (admin, donor, volunteer) and status (active/blocked) before processing sensitive routes.
3. 📦 **RESTful API Structure** — Follows REST principles for managing users, blogs, donation requests, and funds.
4. 🧑‍⚕️ **User Management** — Admin can update user roles and block/unblock status.
5. 🩸 **Donation Requests API** — Full CRUD for donation requests with status tracking.
6. 💰 **Funding System** — Accepts and stores Stripe payment details and donor information securely.
7. 📝 **Blog Management** — Create, update status (draft/published), and delete blogs.
8. 🌐 **CORS Configured** — Secure cross-origin resource sharing configured for the frontend.
9. 🧪 **Robust Error Handling** — Returns proper status codes and error messages for all routes.
10. 🧾 **MongoDB Integration** — All data stored in a structured, normalized schema.
