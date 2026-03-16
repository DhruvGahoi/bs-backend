# Bitespeed Identity Reconciliation API

A REST API that reconciles and links customer identities across multiple purchases using email addresses and phone numbers. When a customer uses different contact details across orders, this service links them under a single primary contact, consolidating their identity.

---

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Environment Variables](#environment-variables)
  - [Database Setup](#database-setup)
  - [Running the Server](#running-the-server)
- [API Reference](#api-reference)
  - [Health Check](#get-)
  - [Identify Contact](#post-identify)
- [Identity Reconciliation Logic](#identity-reconciliation-logic)
- [Error Handling](#error-handling)

---

## Overview

The core idea: a customer might place an order with `alice@example.com` and later place another with `alice@example.com + phone: 123456`, and yet another with only `phone: 123456`. All three should be recognized as the same person.

This API accepts an email and/or phone number, finds all existing contacts that share either value, links them together under one **primary** contact, and returns a consolidated view of that customer's identity.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js + TypeScript |
| Framework | Express v5 |
| Database | PostgreSQL |
| DB Client | `pg` (node-postgres) |
| Validation | Zod |
| Config | dotenv |

---

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database
- npm

### Installation

```bash
git clone <repo-url>
cd bs-backend-task
npm install
```

### Environment Variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Full PostgreSQL connection string |
| `PORT` | No | Port to listen on (default: `3000`) |

**Example `.env`:**

```env
DATABASE_URL=postgresql://user:password@localhost:5432/bitespeed
PORT=3000
```

### Database Setup

Run the following SQL against your PostgreSQL database to create the required schema:

```sql
CREATE TYPE link_precedence AS ENUM ('primary', 'secondary');

CREATE TABLE contact (
  id              SERIAL PRIMARY KEY,
  phone_number    TEXT,
  email           TEXT,
  linked_id       INT REFERENCES contact(id),
  link_precedence link_precedence NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX ON contact(email);
CREATE INDEX ON contact(phone_number);
```

### Running the Server

**Development** (with live reload):

```bash
npm run dev
```

**Production build:**

```bash
npm run build
npm start
```

The server starts on `http://localhost:3000` (or the port specified in `.env`).

---

## API Reference

### GET /

Health check endpoint. Verifies the server is running and the database is reachable.

**Request**

```
GET /
```

No headers or body required.

**Response — 200 OK (healthy)**

```json
{
  "status": "ok",
  "db": "connected"
}
```

**Response — 500 Internal Server Error (database unreachable)**

```json
{
  "status": "error",
  "db": "unreachable"
}
```

**Example**

```bash
curl http://localhost:3000/
```

---

### POST /identify

The primary endpoint. Accepts an email and/or phone number, performs identity reconciliation across all known contacts, and returns the consolidated contact record.

**Request**

```
POST /identify
Content-Type: application/json
```

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | `string \| null` | At least one of the two | Must be a valid email address |
| `phoneNumber` | `string \| null` | At least one of the two | Any non-empty string |

At least one of `email` or `phoneNumber` must be provided and non-null. Sending both as `null` or omitting both will return a `400` validation error.

```json
{
  "email": "alice@example.com",
  "phoneNumber": "123456"
}
```

**Response — 200 OK**

```json
{
  "contact": {
    "primaryContactId": 1,
    "emails": ["alice@example.com", "alice2@example.com"],
    "phoneNumbers": ["123456"],
    "secondaryContactIds": [2, 3]
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `primaryContactId` | `number` | ID of the oldest (primary) contact in the cluster |
| `emails` | `string[]` | All unique emails across primary and secondary contacts. Primary contact's email is first |
| `phoneNumbers` | `string[]` | All unique phone numbers across primary and secondary contacts. Primary contact's number is first |
| `secondaryContactIds` | `number[]` | IDs of all secondary contacts linked to the primary |

**Response — 400 Bad Request (validation error)**

Returned when the request body fails schema validation.

```json
{
  "error": {
    "issues": [
      {
        "code": "custom",
        "message": "At least one of email or phoneNumber must be provided",
        "path": []
      }
    ]
  }
}
```

**Response — 500 Internal Server Error**

```json
{
  "error": "Internal server error"
}
```

---

**Examples**

**1. New contact (no matches in DB)**

```bash
curl -X POST http://localhost:3000/identify \
  -H 'Content-Type: application/json' \
  -d '{"email": "alice@example.com", "phoneNumber": "123456"}'
```

```json
{
  "contact": {
    "primaryContactId": 1,
    "emails": ["alice@example.com"],
    "phoneNumbers": ["123456"],
    "secondaryContactIds": []
  }
}
```

A brand-new primary contact is created and returned.

---

**2. Existing contact — same email, new phone**

```bash
curl -X POST http://localhost:3000/identify \
  -H 'Content-Type: application/json' \
  -d '{"email": "alice@example.com", "phoneNumber": "999999"}'
```

```json
{
  "contact": {
    "primaryContactId": 1,
    "emails": ["alice@example.com"],
    "phoneNumbers": ["123456", "999999"],
    "secondaryContactIds": [4]
  }
}
```

The email matches contact `1`. Since `999999` is new, a secondary contact is created and linked to `1`.

---

**3. Merging two separate primary contacts**

Suppose contact `1` has `alice@example.com` (primary) and contact `2` has `bob@example.com` (primary). A request that provides both links them:

```bash
curl -X POST http://localhost:3000/identify \
  -H 'Content-Type: application/json' \
  -d '{"email": "alice@example.com", "phoneNumber": "bob-phone"}'
```

Contact `1` (older) remains primary. Contact `2` is demoted to secondary. All contacts in `2`'s cluster are re-linked to `1`.

```json
{
  "contact": {
    "primaryContactId": 1,
    "emails": ["alice@example.com", "bob@example.com"],
    "phoneNumbers": ["alice-phone", "bob-phone"],
    "secondaryContactIds": [2, 3, 4]
  }
}
```

---

**4. Email only**

```bash
curl -X POST http://localhost:3000/identify \
  -H 'Content-Type: application/json' \
  -d '{"email": "alice@example.com"}'
```

**5. Phone number only**

```bash
curl -X POST http://localhost:3000/identify \
  -H 'Content-Type: application/json' \
  -d '{"phoneNumber": "123456"}'
```

---

## Identity Reconciliation Logic

The `/identify` endpoint follows this algorithm on every request:

1. **Search** — Query all non-deleted contacts where `email` OR `phoneNumber` matches the input.

2. **No matches** — Create a new `primary` contact and return it.

3. **Matches found** — Collect the primary contact ID for each match:
   - If the match is `primary`, use its own ID.
   - If the match is `secondary`, use its `linked_id`.

4. **Fetch full cluster** — Retrieve all contacts that are either one of those primaries or linked to them.

5. **Merge if needed** — If multiple distinct primaries exist, the oldest one (by `created_at`) wins. All other primaries are demoted to `secondary` and their `linked_id` is set to the winner. Any contacts previously linked to the losers are re-pointed to the winner.

6. **Add new info** — If the incoming email or phone number does not already exist anywhere in the winner's cluster, a new `secondary` contact is inserted linked to the winner.

7. **Return** — Re-fetch the final cluster and return the consolidated response.

All database operations run inside a single transaction to ensure consistency.

---

## Error Handling

| HTTP Status | Cause |
|-------------|-------|
| `200` | Success |
| `400` | Validation failed — missing/invalid request body |
| `500` | Unexpected server or database error |
