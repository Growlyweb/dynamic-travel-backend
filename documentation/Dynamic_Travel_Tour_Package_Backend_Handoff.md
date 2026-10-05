# Dynamic Travel Platform — Tour Package Backend Handoff

**Prepared for:** Backend Developer — Node.js / Express / MongoDB (MERN)

**Purpose:** This document converts the current frontend tour/category structure into a backend implementation reference. The backend should expose persistent APIs that replace the current frontend mock stores.

**Source basis:** The supplied frontend code defines tour-category CRUD and a tour package object for Cox's Bazar Beach Escape. It also shows custom-tour request fields and generated itinerary behavior.

---

## 1. Scope

| Module | Backend responsibility |
|---|---|
| Tour Categories | List, create and delete categories. Support search/list filtering. |
| Tour Packages | Persist and serve published/unpublished tour packages with pricing, capacity, itinerary, hotels, gallery, inclusions/exclusions and terms. |
| Custom Tours | Accept customer custom-tour requests, including traveler details, dates, preferences, activities, requirements and generated itinerary. |
| Frontend Integration | Replace mock-mode category/tour behavior with REST API calls while keeping response shapes stable. |

---

## 2. Tour Category Model

The frontend currently seeds these categories and uses IDs beginning with `cat_`. The backend should own the persistent IDs; existing IDs can be retained during migration so existing tours continue resolving.

| Current ID | Category name |
|---|---|
| `cat_beach` | Beach & Resort |
| `cat_adventure` | Adventure & Trekking |
| `cat_honeymoon` | Honeymoon & Romantic |
| `cat_family` | Family Special |
| `cat_cultural` | Cultural & Heritage |
| `cat_luxury` | Luxury & Wellness |
| `cat_city` | City Break |
| `cat_custom_group` | Custom Group |

### Recommended schema

```
TourCategory: id/_id, name (required, unique case-insensitively), slug (recommended), isActive, createdAt, updatedAt
```

---

## 3. Category REST API Contract

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/tour-categories` | List categories; support `?search=` and pagination if required. |
| POST | `/api/tour-categories` | Create a category. |
| DELETE | `/api/tour-categories/:id` | Delete/deactivate a category. |

**Create request example:**

```json
{
  "name": "Beach & Resort"
}
```

**Expected duplicate behavior:** Reject or return the existing category when the same name already exists, case-insensitively. The frontend mock currently returns the existing record instead of creating a duplicate.

---

## 4. Tour Package Model

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` / `_id` | String/ObjectId | Yes | Persistent unique identifier. |
| `name` | String | Yes | Public tour/package title. |
| `country` | String | Yes | Country name. |
| `destination` | String | Yes | Destination display value. |
| `category` | ObjectId/String | Recommended | Reference to TourCategory. |
| `durationDays` | Number | Yes | Positive integer. |
| `priceCurrency` | String | Yes | Example: `BDT`. |
| `price` | Number | Yes | B2C/public price. |
| `b2bPrice` | Number | Recommended | B2B partner price. |
| `seats` | Number | Recommended | Capacity/available seat count. |
| `status` | Enum | Yes | Example values: `draft`, `published`, `unpublished`, `archived`. |
| `rating` | Number | No | Display rating; validate range if managed by backend. |
| `coverImage` | String | No | Image URL/path. |
| `gallery` | Array | No | Additional image URLs/paths. |
| `description` | String | Yes | Package description. |
| `included` | Array | No | Included services. |
| `excluded` | Array | No | Excluded services. |
| `hotels` | Array | No | Hotel/property names. |
| `itinerary` | Array | Yes | Day-by-day plan. |
| `terms` | String | No | Cancellation/terms text. |
| `createdAt` / `updatedAt` | Date | Auto | Audit timestamps. |

---

## 5. Itinerary Subdocument

Each itinerary item follows the supplied structure:

```json
{
  "day": 1,
  "title": "Arrival & Beach Sunset",
  "description": "Check-in, relax at Laboni Beach, enjoy sunset."
}
```

**Validation:** `day` must be a positive integer; `title` and `description` should be non-empty. The API should return itinerary in ascending day order.

---

## 6. Sample Tour Package — Cox's Bazar

| Field | Value |
|---|---|
| `id` | `tour_205` |
| `name` | Cox's Bazar Beach Escape |
| `country` | Bangladesh |
| `destination` | Cox's Bazar, Bangladesh |
| `durationDays` | 3 |
| `priceCurrency` | BDT |
| `price` | 12,500 |
| `b2bPrice` | 10,000 |
| `seats` | 25 |
| `status` | published |
| `rating` | 4.9 |
| `coverImage` | https://picsum.photos/seed/coxs-bazar/900/560 |
| `description` | Experience the world longest natural sea beach with luxury resort stay and fresh seafood. |
| `hotels` | Ocean Paradise Hotel & Resort |
| `terms` | Standard cancellation rules apply. |

**Included**

- 2 nights hotel stay
- Breakfast included
- Beach tour & sunset view

**Excluded**

- Personal expenses
- Shopping

**Itinerary**

- **Day 1 — Arrival & Beach Sunset:** Check-in, relax at Laboni Beach, enjoy sunset.
- **Day 2 — Inani Beach & Himchari:** Day trip to Inani rocky beach and Himchari waterfall.
- **Day 3 — Departure:** Morning shopping at Burmese market, airport transfer.

---

## 7. Recommended Tour API

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/tours` | List/search/filter tours. |
| GET | `/api/tours/:id` | Get one complete tour package. |
| POST | `/api/tours` | Create a tour package. |
| PUT/PATCH | `/api/tours/:id` | Update a tour package. |
| DELETE | `/api/tours/:id` | Delete/archive a tour package. |

**Recommended list query parameters:** `search`, `category`, `country`, `destination`, `status`, `minPrice`, `maxPrice`, `durationDays`, `page`, `limit`, `sort`. Exact filtering rules can be finalized with the frontend team.

---

## 8. Custom Tour Request API

The supplied frontend submits a custom request with the following payload fields: `customer`, `phone`, `destination`, `travelers`, `startDate`, `endDate`, `hotel`, `transportation`, `activities`, `requirements` and `itinerary`.

| Field | Type | Validation / behavior |
|---|---|---|
| `customer` | String | Required; trim whitespace. |
| `phone` | String | Required; frontend validates phone format. |
| `destination` | String | Required. |
| `travelers` | Number | Required; minimum 1. |
| `startDate` | Date/String | Required. |
| `endDate` | Date/String | Required; must not be before `startDate`. |
| `hotel` | Enum/String | Required; frontend currently requires a hotel preference. |
| `transportation` | Enum/String | Default: `Private car`. |
| `activities` | Array | Optional. |
| `requirements` | String | Optional. |
| `itinerary` | Array | Generated draft; consultant confirms availability/final pricing. |

**Suggested endpoints:**

- `POST /api/tours/custom-requests`
- `GET /api/tours/custom-requests`
- `GET /api/tours/custom-requests/:id`
- `PATCH /api/tours/custom-requests/:id/status`

---

## 9. Backend Validation & Business Rules

- Category names should be unique case-insensitively.
- Tour name, destination, durationDays, currency, price and status should be validated before persistence.
- `price`, `b2bPrice`, `seats` and `durationDays` must not accept invalid negative values.
- `startDate`/`endDate` must be valid dates and `endDate` must be on or after `startDate`.
- `travelers` must be at least 1.
- Tour status should be controlled by a backend enum rather than accepting arbitrary strings.
- Use database timestamps for `createdAt` and `updatedAt`.
- Do not rely on frontend mock IDs as the source of truth; preserve existing IDs only for migration/compatibility where needed.
- Protect create/update/delete endpoints with the project's authentication/authorization middleware.
- For delete operations, consider soft delete/archive when tours or categories may already be referenced by existing records.

---

## 10. Frontend ↔ Backend Response Shape

Keep a consistent envelope across endpoints. Example:

```json
{
  "success": true,
  "message": "Tour fetched successfully.",
  "data": { "...": "tour" }
}
```

For lists, return pagination metadata where applicable:

```json
{
  "success": true,
  "data": [],
  "pagination": { "page": 1, "limit": 20, "total": 100, "totalPages": 5 }
}
```

---

## 11. Implementation Checklist

1. Create TourCategory model/schema and unique name index.
2. Seed the 8 existing default categories.
3. Create Tour model/schema including itinerary subdocuments.
4. Seed Cox's Bazar Beach Escape as the first sample package.
5. Implement category list/create/delete endpoints.
6. Implement tour list/detail/create/update/delete endpoints.
7. Implement search, pagination and core filters.
8. Implement custom-tour request persistence and status workflow.
9. Add authentication/role authorization for admin/staff management endpoints.
10. Return stable response/error structures for frontend integration.
11. Test duplicate category, invalid dates, invalid prices, missing required fields, and missing tour ID cases.

---

*Source reference: supplied frontend code. The category API implementation and sample tour structure are directly represented in the provided source; the REST endpoint naming and recommended schema additions above are backend implementation recommendations based on that structure.*
