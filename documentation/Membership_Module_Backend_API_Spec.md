#### **BACKEND API SPECIFICATION** 

# **Membership Module** 

What the dashboard needs from the backend: data models, business rules and every endpoint, with example requests and responses. 

|**Item**|**Detail**|
|---|---|
|Project|Dynamic Travel Management Website (MERN) – admin dashboard|
|Module|Membership (B2C customers only) – Plans, Members, Reports|
|Audience|Backend developer (Node.js / Express / MongoDB assumed)|
|Source|Dashboard files**membership.api.js**,**MembershipMembers**,**MembershipPlans**,**MembershipReports**<br>(running on dummy data)|
|Version / date|1.0 – 7 October 2026|



**How to read this document.** The dashboard currently runs on an in-memory mock. Every call in **membership.api.js** is written as **withMock(mockFn, realFn)** . The **realFn** part is the real HTTP request the backend must answer. This document is built from those calls, so if you match the paths, field names and response shapes here, the dashboard will work without frontend changes. 

Membership Module – Backend API Specification 

Page 1 

## **Contents** 

|1. Overview|3|
|---|---|
|2. Endpoint summary|3|
|3. General conventions|4|
|4. Data models|4|
|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .<br>4.1 MembershipPlan|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 4|
|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .<br>4.2 Membership|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 5|
|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .<br>4.3 Enums (must match the dashboard exactly)|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 6|
|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .<br>4.4 Dependency: the B2C customer|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 6|
|5. Business rules|7|
|6. Endpoint reference|8|
|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .<br>6.1 List plans|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 8|
|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .<br>6.2 Create plan|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 8|
|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .<br>6.3 Edit plan|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 8|
|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .<br>6.4 Toggle plan active|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 9|
|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .<br>6.5 Delete plan|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 9|
|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .<br>6.6 List memberships|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 9|
|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .<br>6.7 Create membership (assign a plan)|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 10|
|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .<br>6.8 Cancel membership|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 10|
|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .<br>6.9 Extend membership|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 11|
|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .<br>6.10 Delete membership|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 11|
|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .<br>6.11 Memberships of one customer|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 11|
|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .<br>6.12 Membership stats|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 11|
|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .<br>6.13 Sales by period report|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 12|
|7. Stats and report calculations|12|
|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .<br>7.1 /membership-stats|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 12|
|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .<br>7.2 /membership-report/periods (per period)|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 12|
|8. Next phase: applying the discount on bookings|13|
|9. Reference implementation notes (Mongoose)|13|
|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .<br>9.1 Schemas and indexes|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 13|
|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .<br>9.2 Date helpers and serializer (dayjs)|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 14|
|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .<br>9.3 Create membership (service sketch)|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 14|
|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .<br>9.4 Nightly job (rule R5)|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 15|
|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .<br>9.5 Seed data|.  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 15|
|10. Test checklist|15|
|11. Open decisions and known gaps|15|



Membership Module – Backend API Specification 

Page 2 

## **1. Overview** 

Admins sell memberships to B2C customers. A membership gives the customer a percentage discount on tour packages and on visa processing for a fixed period (15 days, 30 days, 6 months or 1 year). The customer pays offline (bKash, Nagad, bank, cash) and the admin records the payment when assigning the membership. 

- **Plans** are the products the admin creates (name, duration, price, discount %, optional discount cap). 

- **Memberships** are one purchase of one plan by one customer. They keep a **snapshot** of the plan at purchase time, so editing a plan later never changes old memberships. 

- **Reports** show active / expiring / expired counts, monthly revenue, plan distribution and sales by period, with PDF and Excel export built in the browser from the stats endpoints. 

- The customer profile page shows the customer's active membership (uses the list endpoints below). 

#### **Scope of phase 1** 

- Admin-only. No public purchase flow yet, so every membership has **source = 'admin'** . 

- B2C customers only. B2B customers must be rejected. 

- Payment is recorded manually by the admin. There is no payment gateway integration. 

- Applying the discount on a booking is the next phase (the dashboard text says “discounts are applied server-side at booking”). Section 8 describes the helper the booking module will call. 

#### **Screens and the endpoints they use** 

|**Screen**|**Endpoints used**|
|---|---|
|Membership / Plans|GET/POST /membership-plans, PUT /membership-plans/:id, PATCH /membership-plans/:id/toggle,<br>DELETE /membership-plans/:id|
|Membership / Members|GET /memberships, GET /membership-plans, GET /membership-stats, POST /memberships,<br>PATCH /memberships/:id/cancel, PATCH /memberships/:id/extend, DELETE /memberships/:id,<br>plus the existing B2C customer list/get|
|Membership / Reports|GET /membership-stats, GET /membership-plans, GET /membership-report/periods|
|Customer profile (B2C)|GET /customers/:customerId/memberships and GET /memberships?status=active|



## **2. Endpoint summary** 

|**Method**|**Path**|**Purpose**|
|---|---|---|
|GET|`/membership-plans`|List plans (optional name search)|
|POST|`/membership-plans`|Create a plan|
|PUT|`/membership-plans/:id`|Edit a plan|
|PATCH|`/membership-plans/:id/toggle`|Activate / deactivate a plan|
|DELETE|`/membership-plans/:id`|Delete a plan|
|GET|`/memberships`|List memberships (filters: status, planId, expiringIn, search)|
|POST|`/memberships`|Assign a plan to a B2C customer and record payment|
|PATCH|`/memberships/:id/cancel`|Cancel with reason|
|PATCH|`/memberships/:id/extend`|Add extra days to expiry|
|DELETE|`/memberships/:id`|Delete a membership record|
|GET|`/customers/:customerId/memberships`|Membership history of one customer|
|GET|`/membership-stats`|Dashboard cards, revenue by month, plan distribution|
|GET|`/membership-report/periods`|Sales by period (monthly or 15-day)|



Membership Module – Backend API Specification 

Page 3 

## **3. General conventions** 

|**Topic**|**Rule**|
|---|---|
|Base URL|Paths in this document are relative to the base URL already configured in the dashboard's**apiClient**(for<br>example**/api/v1**). Do not add a prefix of your own without telling the frontend developer.|
|Authentication|All endpoints are admin-only. Require the admin JWT / session used by the rest of the dashboard. Return<br>401 if not logged in, 403 if the role is not allowed.|
|Format|JSON request and response bodies (**Content-Type: application/json**).|
|IDs|Always return the id as a string in a field called**id**(not**_id**). The same applies to**customerId**and**planId**.<br>Add a**toJSON**transform to the Mongoose schemas.|
|Dates|Store as UTC**Date**. Return ISO 8601 strings (for example 2026-10-07T17:59:59.999Z). Accept dates in<br>requests as**YYYY-MM-DD**.|
|Time zone|The business runs in**Asia/Dhaka (UTC+6)**. “Today”, “this month”, period boundaries and “end of day” must<br>all be calculated in Asia/Dhaka, not in server UTC. Using UTC makes records between 12:00 am and 6:00<br>am land on the previous day.|
|Money|Plain numbers in BDT (for example 4500). No currency symbols or strings.|
|List response|**{ "items": [...], "total": 7 }**. The dashboard reads**items**. Return all rows (no pagination) for now; the<br>Members page filters in the browser.|
|Single response|Return the object itself (not wrapped). Create returns 201, others 200.|
|Delete response|**{ "success": true, "id": "..." }**|
|Error response|HTTP status plus**{ "message": "Human readable text" }**. The dashboard shows**message**directly inside<br>the modal, so write messages for admins.|
|Unknown fields|Whitelist the fields you accept. The dashboard sends the whole plan object when editing (including**id**,<br>**sortOrder**, timestamps); ignore everything that is not editable.|



**Please confirm with the frontend developer:** whether **apiClient** returns **response.data** directly. The code reads **result.items** and **result.total** straight from the call, so the JSON body should be exactly the shapes in this document. If the backend wraps everything in **{ success, data }** , the apiClient interceptor must unwrap it. 

|**HTTP**|**When to use**|
|---|---|
|400|Validation failed, or a business rule is broken (not B2C, plan unavailable)|
|401 / 403|Not authenticated / not allowed|
|404|Plan, membership or customer not found|
|409|Conflict with current state (duplicate plan name, customer already has an active membership, plan in use, wrong<br>status for cancel/extend)|
|500|Unexpected error. Log it, return a generic message|



## **4. Data models** 

### **4.1 MembershipPlan** 

A sellable plan. The admin creates and edits these on the Plans screen. 

|**Field**|**Type**|**Req.**|**Rules / notes**|
|---|---|---|---|
|`id`|string|auto|Server generated|
|`name`|string|yes|Trim. Unique, case-insensitive (“Gold” and “gold” clash). Message:<br>_Another plan already uses this name._|
|`durationValue`|integer|yes|>= 1|
|`durationUnit`|enum|yes|**day**|**month**|**year**(singular, lowercase). The UI adds the “s” when<br>displaying|



Membership Module – Backend API Specification 

Page 4 

|**Field**|**Type**|**Req.**|**Rules / notes**|
|---|---|---|---|
|`price`|number|yes|BDT, >= 0|
|`tourDiscountPercent`|number|yes|0 to 100, default 0. Discount on tour packages|
|`visaDiscountPercent`|number|yes|0 to 100, default 0. Discount on visa processing. Separate from tour so<br>values such as visa 5% / tour 10% are possible|
|`maxDiscountAmount`|number | null|no|Per-booking discount cap in BDT.**null**= no cap. The UI treats 0 as “no<br>cap” too, so convert 0 to null on save|
|`description`|string|no|Default empty string|
|`features`|string[]|no|Bullet list shown on a future buy page. Trim each, drop empty ones|
|`isActive`|boolean|no|Default true. Only active plans can be assigned to a customer|
|`sortOrder`|integer|auto|Default = highest existing + 1. List is returned sorted ascending by this|
|`createdAt / updatedAt`|ISO date|auto|Timestamps|



### **4.2 Membership** 

One purchase of one plan by one B2C customer. The embedded **planSnapshot** and **payment** objects are part of the same document. 

|**Field**|**Type**|**Notes**|
|---|---|---|
|`id`|string|Server generated|
|`customerId`|string|Reference to the B2C customer|
|`customerName / customerEmail /`<br>`customerPhone`|<br>string|Copied from the customer at creation. Used for display and for the<br>search box. Email and phone may be empty|
|`planId`|string|Reference to the plan that was bought|
|`planSnapshot`|object|Copy of the plan at purchase time:**name, durationValue,**<br>**durationUnit, price, tourDiscountPercent, visaDiscountPercent,**<br>**maxDiscountAmount**. Never updated when the plan is edited. The<br>dashboard reads discounts from here|
|`startDate`|date|From the request, default today (Asia/Dhaka)|
|`endDate`|datetime|Calculated by the server, see rule R3. Always 23:59:59.999 Asia/Dhaka|
|`status`|enum|Stored:**pending | active | expired | cancelled**. What the API returns is<br>the_effective_status, see rule R4|
|`daysLeft`|integer|**Computed on every read, not stored.**Math.ceil((endDate - now) /<br>86400000). Negative once lapsed|
|`payment.method`|enum|**bkash | nagad | bank | cash | online**|
|`payment.amount`|number|Set by the server from the plan price. The client does not send it|
|`payment.trxId`|string|Transaction id typed by the admin. May be empty (for example cash)|
|`payment.status`|enum|**unpaid | paid | refunded**. Admin-created memberships are saved as<br>**paid**|
|`payment.paidAt`|date | null|When the payment was recorded. Revenue reports group by this field|
|`source`|string|**admin**now. Reserve**online**for the future public purchase flow|
|`cancelledAt`|date | null|Set when cancelled|
|`cancelReason`|string|Free text from the admin, default empty|
|`createdAt / updatedAt`|ISO date|Timestamps. “New memberships” in reports counts by createdAt|



Membership Module – Backend API Specification 

Page 5 

### **4.3 Enums (must match the dashboard exactly)** 

|**Name**|**Values**|
|---|---|
|`MEMBERSHIP_STATUSES`|pending, active, expired, cancelled|
|`PAYMENT_METHODS`|bkash, nagad, bank, cash, online|
|`PAYMENT_STATUSES`|unpaid, paid, refunded|
|`DURATION_UNITS`|day, month, year|



### **4.4 Dependency: the B2C customer** 

The membership module reads customers from the existing B2C module (the dashboard calls **b2cApi.list()** and **b2cApi.get(id)** ). In the backend, query the Customer model directly. The fields this module needs are: 

|**Field**|**Use**|
|---|---|
|`id`|Stored as customerId|
|`name, email, phone`|Copied into the membership; shown in the Add membership dialog|
|`accountType`|Must be**'b2c'**. Anything else is rejected with_Membership is only for B2C customers_|



Membership Module – Backend API Specification 

Page 6 

## **5. Business rules** 

These rules live in the dashboard's mock code today. The backend must enforce them itself, because the browser can be bypassed. 

|**#**|**Rule**|**Detail**|
|---|---|---|
|R1|One active membership<br>per customer|A customer cannot have two active memberships. Check before creating and also enforce with<br>a partial unique index (section 9). The UI greys out such customers but the server is the real<br>guard.|
|R2|Plan snapshot|On creation copy the plan values into**planSnapshot**. Editing or deactivating the plan later<br>must not touch existing memberships.|
|R3|End date calculation|endDate = startDate + durationValue (day / month / year) and then set the time to<br>**23:59:59.999 Asia/Dhaka**. Example from the dummy data: a 15-day plan starting 2026-10-01<br>ends at the end of 2026-10-16. Use a date library that clamps month ends (31 Jan + 1 month =<br>28 Feb), not raw JavaScript setMonth, which overflows into March.|
|R4|Effective status|A membership stops giving benefits the moment endDate passes. When reading, if stored<br>status is**active**and endDate < now, return**expired**. Every list, filter, count and stat must use<br>this effective status, not the raw stored value.|
|R5|Nightly job|Run a job every night just after midnight (Asia/Dhaka) that saves the real status:<br>**updateMany({ status: 'active', endDate: { $lt: now } }, { status: 'expired' })**. Rule R4 keeps<br>the API correct between runs.|
|R6|B2C only|Reject non-B2C customers when creating.|
|R7|Plan must be active|Creating a membership with a missing or inactive plan fails with_Plan not available_.|
|R8|Payment on create|Amount is taken from the plan price. Save**payment.status = 'paid'**,**paidAt = now**, method<br>and trxId from the request. The dashboard only records payments that were already received.|
|R9|Cancel|Allowed for**active**or**pending**memberships. Set status = cancelled, cancelledAt = now,<br>cancelReason. Discounts stop immediately. Do not change payment.status automatically<br>(refunds are handled manually for now).|
|R10|Extend|Allowed for effectively**active**memberships only. Adds N days to the current endDate (keep<br>the 23:59:59.999 time). The button is only shown for active rows.|
|R11|Delete membership|Permanent removal (the confirmation dialog says so). See open decision D3 in section 11:<br>deleting removes revenue history from reports.|
|R12|Delete plan|Block when any membership uses the plan (409). The dashboard shows the message in the<br>modal. Admins can deactivate the plan instead.|



Membership Module – Backend API Specification 

Page 7 

## **6. Endpoint reference** 

### **6.1 List plans** 

#### **GET** **`/membership-plans`** 

**Used by:** Plans page, Members page (filter and add dialog), Reports page 

Returns every plan, including inactive ones, sorted by **sortOrder** ascending. The dashboard filters inactive plans itself where needed. 

|**Query**|**Type**|**Notes**|
|---|---|---|
|`search`|string|Optional. Case-insensitive “contains” match on name|



```
200 OK
```

```
{
  "items": [
    {
      "id": "6720a1...", "name": "Gold", "durationValue": 1, "durationUnit": "year",
      "price": 4500, "tourDiscountPercent": 10, "visaDiscountPercent": 10,
      "maxDiscountAmount": 3000, "description": "Best value - a full year of member pricing.",
      "features": ["10% off tour packages", "10% off visa processing"],
      "isActive": true, "sortOrder": 4
    }
  ],
  "total": 1
}
```

### **6.2 Create plan** 

#### **POST** **`/membership-plans`** 

**Used by:** Plans page, “+ Add plan” 

Creates a plan. The server sets **id** , **sortOrder** (highest + 1) and timestamps. 

```
Request body
{
  "name": "Gold", "durationValue": 1, "durationUnit": "year", "price": 4500,
  "tourDiscountPercent": 10, "visaDiscountPercent": 10, "maxDiscountAmount": 3000,
  "description": "Best value", "features": ["10% off tour packages"], "isActive": true
}
Response: 201 Created, the full plan object (see 6.1)
```

|**Status**|**message**|
|---|---|
|400|Field level problem, for example “Plan name is required.” or “Duration must be at least 1.”|
|409|Another plan already uses this name.|



### **6.3 Edit plan** 

#### **PUT** **`/membership-plans/:id`** 

**Used by:** Plans page, Edit dialog 

Updates the editable fields of a plan. Same body as create. Existing memberships are not affected (rule R2). 

- Ignore **id** , **sortOrder** , **createdAt** , **updatedAt** if they are present in the body. 

- Name uniqueness check must exclude the plan being edited. 

- Response 200: the updated plan. 404 if not found. 409 for duplicate name. 

Membership Module – Backend API Specification 

Page 8 

### **6.4 Toggle plan active** 

**PATCH** **`/membership-plans/:id/toggle`** 

**Used by:** Plans page, checkbox in the Status column 

No request body. Flips **isActive** and returns the updated plan. Deactivating hides the plan from the Add membership dialog but does not change existing memberships. 

### **6.5 Delete plan** 

#### **DELETE** **`/membership-plans/:id`** 

**Used by:** Plans page, Delete confirmation 

Deletes the plan and returns **{ "success": true, "id": "..." }** . If any membership references the plan return: 

```
409 Conflict
{ "message": "This plan has memberships. Deactivate it instead of deleting it." }
```

### **6.6 List memberships** 

**GET** **`/memberships`** 

**Used by:** Members page (no filters, filtered in the browser), customer page badge (status=active) 

Returns memberships sorted by **startDate** descending. Every item carries the _effective_ status and a computed **daysLeft** (rules R4). 

|**Query**|**Type**|**Notes**|
|---|---|---|
|`status`|string|pending | active | expired | cancelled. Matches the**effective**status:_active_= stored active<br>and endDate >= now;_expired_= stored expired, or stored active with endDate < now|
|`planId`|string|Exact plan id|
|`expiringIn`|integer|Only effectively active memberships with 0 <= daysLeft <= value|
|`search`|string|Case-insensitive “contains” on customerName, customerPhone, customerEmail|



```
200 OK
{
  "items": [
    {
      "id": "6721b2...", "customerId": "671f00...", "customerName": "Emma Wilson",
      "customerEmail": "emma@example.com", "customerPhone": "+44 20 7946 0958",
      "planId": "6720a1...",
      "planSnapshot": {
        "name": "Silver", "durationValue": 6, "durationUnit": "month", "price": 2500,
        "tourDiscountPercent": 10, "visaDiscountPercent": 10, "maxDiscountAmount": 1500
      },
      "startDate": "2026-08-09T18:00:00.000Z", "endDate": "2027-02-10T17:59:59.999Z",
      "status": "active", "daysLeft": 126,
      "payment": { "method": "bkash", "amount": 2500, "trxId": "BKX88231A",
                   "status": "paid", "paidAt": "2026-08-10T05:12:00.000Z" },
      "source": "admin", "createdAt": "2026-08-10T05:12:00.000Z"
    }
  ],
  "total": 1
}
```

Cancelled items also include **cancelledAt** and **cancelReason** . The dashboard shows **cancelReason** in the View dialog only when it is not empty. 

Membership Module – Backend API Specification 

Page 9 

### **6.7 Create membership (assign a plan)** 

**POST** **`/memberships`** 

**Used by:** Members page, “+ Add membership” 

The admin picks a B2C customer and a plan, chooses the payment method, enters the transaction id and optionally a start date. 

```
Request body
{
  "customerId": "671f00...",   // required
  "planId": "6720a1...",       // required
  "paymentMethod": "bkash",    // required: bkash | nagad | bank | cash | online
  "trxId": "BKX88231A",        // optional, may be "" (trim it)
  "startDate": "2026-10-07"    // optional YYYY-MM-DD, default = today in Asia/Dhaka
}
Response: 201 Created, the full membership object (see 6.6)
```

#### **Server steps, in this order** 

- Find the customer. Not found: **404** “Customer not found”. 

- Check accountType is b2c. Otherwise **400** “Membership is only for B2C customers”. 

- Find the plan and check isActive. Otherwise **400** “Plan not available”. 

- Mark this customer's lapsed memberships as expired (stored active with endDate in the past), so an expired membership never blocks a renewal. 

- Check there is no active membership for the customer. Otherwise **409** “Customer already has an active membership – cancel or wait for expiry first.” 

- Build planSnapshot, calculate endDate (R3), set payment (R8), status = active, source = admin, copy customer name / email / phone. 

- Save. If the unique index fires (two admins at once), return the same 409 message. 

|**Status**|**message**|
|---|---|
|400|Validation: invalid paymentMethod, invalid startDate, missing customerId / planId|
|404|Customer not found|
|400|Membership is only for B2C customers|
|400|Plan not available|
|409|Customer already has an active membership – cancel or wait for expiry first.|



### **6.8 Cancel membership** 

**PATCH** **`/memberships/:id/cancel`** 

**Used by:** Members page, Cancel dialog 

Cancels an active or pending membership (rule R9). 

```
Request body
{ "reason": "Customer request, refund issued." }     // optional, max 500 chars
Response 200: the updated membership (status "cancelled", cancelledAt, cancelReason set)
409: { "message": "Only active or pending memberships can be cancelled." }
```

Membership Module – Backend API Specification 

Page 10 

### **6.9 Extend membership** 

**PATCH** **`/memberships/:id/extend`** 

**Used by:** Members page, Extend dialog 

Adds extra days to the current expiry (rule R10). 

```
Request body
{ "days": 7 }       // required, integer 1 to 3650
Response 200: the updated membership (new endDate and daysLeft)
409: { "message": "Only active memberships can be extended." }
```

### **6.10 Delete membership** 

**DELETE** **`/memberships/:id`** 

**Used by:** Members page, Delete confirmation 

Permanently removes the record and returns **{ "success": true, "id": "..." }** . 404 if not found. See decision D3 in section 11 before implementing. 

### **6.11 Memberships of one customer** 

**GET** **`/customers/:customerId/memberships`** 

**Used by:** B2C customer profile page 

Full membership history of one customer, newest first (by startDate), with effective status and daysLeft. Note: this response has **items** only, no **total** . 

```
200 OK
{ "items": [ { ...membership... }, { ...membership... } ] }
```

### **6.12 Membership stats** 

**GET** **`/membership-stats`** 

**Used by:** Members page cards, Reports page cards and charts, PDF/Excel export 

One object with everything the dashboard cards and charts need. Definitions are in section 7. 

```
200 OK
{
  "total": 7,
  "active": 5,
  "expiringIn7": 1,
  "expiredThisMonth": 1,
  "revenueThisMonth": 1400,
  "revenueByMonth": [
    { "label": "May", "value": 0 },   { "label": "Jun", "value": 0 },
    { "label": "Jul", "value": 0 },   { "label": "Aug", "value": 2500 },
    { "label": "Sep", "value": 900 }, { "label": "Oct", "value": 1400 }
  ],
  "planDistribution": [
    { "label": "Starter", "value": 1 }, { "label": "Basic", "value": 3 },
    { "label": "Silver", "value": 2 },  { "label": "Gold", "value": 1 }
  ]
}
```

**revenueByMonth** must always contain exactly 6 entries (the last 6 calendar months including the current one, oldest first), even when a month has no revenue. **label** is the short English month name (Jan, Feb ...). The chart uses it directly. 

Membership Module – Backend API Specification 

Page 11 

### **6.13 Sales by period report** 

**GET** **`/membership-report/periods`** 

**Used by:** Reports page, “Sales by period” table and exports 

Returns the last 6 periods, oldest first. The **mode** query decides the period type. 

|**Query**|**Values**|**Meaning**|
|---|---|---|
|`mode`|monthly (default)|Last 6 calendar months. The current month label ends with “(to date)”|
|`mode`|half|Last 6 fifteen-day periods: 1st to 15th and 16th to end of month, ending with the one we<br>are in now|



```
200 OK  (mode=monthly)
{
  "items": [
    { "id": "monthly-2026-10-01", "label": "Oct 2026 (to date)",
      "start": "2026-10-01", "end": "2026-10-31",
      "newCount": 3, "revenue": 1400, "expiredCount": 1, "cancelledCount": 0 }
  ]
}
Labels: monthly "Sep 2026" | half "Oct 1-15, 2026" (use the plain hyphen or an en dash)
```

## **7. Stats and report calculations** 

“Now” is the current time, and all month / day boundaries are in Asia/Dhaka. “Effective status” means rule R4. 

### **7.1 /membership-stats** 

|**Field**|**Definition**|
|---|---|
|`total`|Count of all memberships, any status|
|`active`|Count with effective status active|
|`expiringIn7`|Active with 0 <= daysLeft <= 7|
|`expiredThisMonth`|Effective status expired (cancelled ones are not counted) and endDate inside the current month|
|`revenueThisMonth`|Sum of payment.amount where payment.status = paid and paidAt is inside the current month|
|`revenueByMonth`|Same sum, for each of the last 6 months (oldest first)|
|`planDistribution`|One entry per plan: label = plan name, value = number of memberships of that plan (all statuses).<br>Include plans with 0. Build it from plans that exist; see D4|



### **7.2 /membership-report/periods (per period)** 

|**Field**|**Definition**|
|---|---|
|`newCount`|Memberships with createdAt inside the period|
|`revenue`|Sum of payment.amount where payment.status = paid and paidAt inside the period|
|`expiredCount`|Memberships that are not cancelled, with endDate inside the period and endDate already in the past|
|`cancelledCount`|Memberships with cancelledAt inside the period|
|`start / end`|First and last day of the period as YYYY-MM-DD|
|`id`|**{mode}-{start}**, for example monthly-2026-10-01. Used as the table row key, must be unique|



Period boundaries are inclusive: from 00:00:00.000 of the start day to 23:59:59.999 of the end day (Asia/Dhaka). Both endpoints are a good fit for MongoDB aggregation with **$match** and **$group** , or for a few **countDocuments** / sum queries per period. 

Membership Module – Backend API Specification 

Page 12 

## **8. Next phase: applying the discount on bookings** 

Not needed by the dashboard today, but the data model is designed for it, so the helper below should be easy to add. When a B2C customer books a tour or processes a visa, the booking service loads the customer's effective active membership and calculates the discount from **planSnapshot** (never from the live plan). 

```
// type: 'tour' | 'visa'; amount: price before discount (BDT)
function membershipDiscount(membership, type, amount) {
  const s = membership.planSnapshot
  const percent = type === 'visa' ? s.visaDiscountPercent : s.tourDiscountPercent
  let discount = (amount * percent) / 100
  if (s.maxDiscountAmount) discount = Math.min(discount, s.maxDiscountAmount)  // per-booking cap
  return Math.round(discount * 100) / 100
}
```

- Store the applied membership id and discount amount on the booking, so reports can show how much discount was given. 

- Only effectively active memberships qualify (status active and endDate in the future). 

- Create a reusable function **getActiveMembership(customerId)** ; the customer profile and the booking module will both use it. 

## **9. Reference implementation notes (Mongoose)** 

Suggested starting point. Adjust names to match your project structure. 

### **9.1 Schemas and indexes** 

```
const { Schema } = require('mongoose')
const planSchema = new Schema({
  name:                { type: String, required: true, trim: true },
  durationValue:       { type: Number, required: true, min: 1 },
  durationUnit:        { type: String, enum: ['day', 'month', 'year'], required: true },
  price:               { type: Number, required: true, min: 0 },
  tourDiscountPercent: { type: Number, min: 0, max: 100, default: 0 },
  visaDiscountPercent: { type: Number, min: 0, max: 100, default: 0 },
  maxDiscountAmount:   { type: Number, min: 0, default: null },
  description:         { type: String, default: '' },
  features:            { type: [String], default: [] },
  isActive:            { type: Boolean, default: true },
  sortOrder:           { type: Number, default: 0 },
}, { timestamps: true })
// case-insensitive unique name
planSchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } })
```

```
const snapshotSchema = new Schema({
  name: String, durationValue: Number, durationUnit: String, price: Number,
  tourDiscountPercent: Number, visaDiscountPercent: Number,
  maxDiscountAmount: { type: Number, default: null },
}, { _id: false })
const paymentSchema = new Schema({
  method: { type: String, enum: ['bkash', 'nagad', 'bank', 'cash', 'online'], required: true },
  amount: { type: Number, required: true, min: 0 },
  trxId:  { type: String, default: '', trim: true },
  status: { type: String, enum: ['unpaid', 'paid', 'refunded'], default: 'unpaid' },
  paidAt: { type: Date, default: null },
}, { _id: false })
const membershipSchema = new Schema({
  customerId:    { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  customerName:  String, customerEmail: String, customerPhone: String,
  planId:        { type: Schema.Types.ObjectId, ref: 'MembershipPlan', required: true, index: true },
  planSnapshot:  { type: snapshotSchema, required: true },
  startDate:     { type: Date, required: true },
  endDate:       { type: Date, required: true, index: true },
  status:        { type: String, enum: ['pending', 'active', 'expired', 'cancelled'],
                   default: 'active' },
  payment:       { type: paymentSchema, required: true },
```

Membership Module – Backend API Specification 

Page 13 

```
  source:        { type: String, enum: ['admin', 'online'], default: 'admin' },
  cancelledAt:   { type: Date, default: null },
  cancelReason:  { type: String, default: '' },
}, { timestamps: true })
```

```
// rule R1: only one stored-active membership per customer, enforced by the database
membershipSchema.index({ customerId: 1 }, { unique: true, partialFilterExpression: { status: 'active' } })
membershipSchema.index({ customerId: 1, startDate: -1 })
```

### **9.2 Date helpers and serializer (dayjs)** 

```
const dayjs = require('dayjs')
dayjs.extend(require('dayjs/plugin/utc'))
dayjs.extend(require('dayjs/plugin/timezone'))
const TZ = 'Asia/Dhaka'
// rule R3: add duration, clamp month ends, end of day in Dhaka
function calcEndDate(start, { durationValue, durationUnit }) {
  return dayjs(start).tz(TZ).add(durationValue, durationUnit).endOf('day').toDate()
}
// rule R4 + computed daysLeft; use for every membership that leaves the API
function serializeMembership(doc, now = new Date()) {
  const m = doc.toJSON()                         // toJSON maps _id -> id, ObjectIds -> strings
  const lapsed = m.status === 'active' && new Date(m.endDate) < now
  return {
    ...m,
    status: lapsed ? 'expired' : m.status,
    daysLeft: Math.ceil((new Date(m.endDate) - now) / 86400000),
  }
}
```

### **9.3 Create membership (service sketch)** 

```
async function createMembership({ customerId, planId, paymentMethod, trxId, startDate }) {
  const customer = await Customer.findById(customerId)
  if (!customer) throw httpError(404, 'Customer not found')
  if (customer.accountType !== 'b2c') throw httpError(400, 'Membership is only for B2C customers')
```

```
  const plan = await MembershipPlan.findById(planId)
  if (!plan || !plan.isActive) throw httpError(400, 'Plan not available')
  const now = new Date()
  // flip this customer's lapsed memberships first so they do not block a renewal
  await Membership.updateMany(
    { customerId, status: 'active', endDate: { $lt: now } }, { status: 'expired' })
```

```
  const start = (startDate ? dayjs.tz(startDate, TZ) : dayjs().tz(TZ)).startOf('day').toDate()
  try {
    const doc = await Membership.create({
      customerId, customerName: customer.name, customerEmail: customer.email,
      customerPhone: customer.phone, planId: plan.id,
      planSnapshot: pickSnapshot(plan), startDate: start, endDate: calcEndDate(start, plan),
      status: 'active', source: 'admin',
      payment: { method: paymentMethod, amount: plan.price, trxId: (trxId || '').trim(),
                 status: 'paid', paidAt: now },
    })
    return serializeMembership(doc, now)
  } catch (e) {
    if (e.code === 11000) throw httpError(409,
      'Customer already has an active membership \u2013 cancel or wait for expiry first.')
    throw e
  }
}
```

Membership Module – Backend API Specification 

Page 14 

### **9.4 Nightly job (rule R5)** 

```
const cron = require('node-cron')
cron.schedule('5 0 * * *', async () => {
  await Membership.updateMany({ status: 'active', endDate: { $lt: new Date() } },
                              { status: 'expired' })
}, { timezone: 'Asia/Dhaka' })
// cPanel / Passenger: the app may be restarted or sleep. If node-cron is not reliable there,
// call the same updateMany from a cPanel cron job hitting a protected internal endpoint.
```

### **9.5 Seed data** 

The four plans used in the dummy data. Insert them once so the admin has something to start with (change prices to the real ones). 

|**name**|**Duration**|**price**|**tour %**|**visa %**|**cap (BDT)**|**sortOrder**|
|---|---|---|---|---|---|---|
|Starter|15 day|500|5|5|null|1|
|Basic|30 day|900|5|5|null|2|
|Silver|6 month|2500|10|10|1500|3|
|Gold|1 year|4500|10|10|3000|4|



## **10. Test checklist** 

- Create a plan with a duplicate name in different case: expect 409. 

- Edit a plan price after a membership was sold: the membership's planSnapshot must not change. 

- Create membership for a B2B customer: 400. For an inactive plan: 400. For an unknown customer: 404. 

- Create a second active membership for the same customer: 409. Create again after the first one lapsed: allowed. 

- Fire two create requests at the same time for the same customer: only one succeeds (unique index). 

- End dates: 31 Jan + 1 month = 28 Feb (29 in a leap year); 15 day plan starting 1 Oct ends 16 Oct 23:59:59.999 Dhaka time. 

- Create a membership at 01:00 Dhaka time: startDate and paidAt must be today's Dhaka date, not yesterday. 

- Set a membership's endDate to yesterday without running the job: GET /memberships must return status expired and a negative daysLeft. 

- GET /memberships?status=active must exclude lapsed rows; ?expiringIn=7 must include daysLeft 0 and 7. 

- Cancel an active membership with a reason: status cancelled, cancelledAt set. Cancel it again: 409. 

- Extend by 7 days: endDate moves exactly 7 days, still 23:59:59.999. Extend an expired one: 409. 

- Delete a plan that has memberships: 409. Delete one that has none: success. 

- Stats: revenueByMonth always has 6 items; a month with no payments shows value 0. 

- Reports: monthly and half modes return 6 items, oldest first; current monthly label ends with “(to date)”. 

- Every protected endpoint returns 401 without a token. 

## **11. Open decisions and known gaps** 

The dummy code makes simple choices that are fine for a demo but should be confirmed before going live. Defaults below are what this document specifies; change them if the business decides otherwise. 

|**#**|**Question**|**Spec default / recommendation**|
|---|---|---|
|D1|Future start date: should a membership with a start<br>date in the future be**pending**until that day?|Dashboard behaviour is kept: always**active**on creation. If the<br>business wants pending, the nightly job must also activate<br>memberships whose start day has arrived, and the one-active rule<br>must count pending ones.|
|D2|Should “paid” be allowed with an empty transaction<br>id?|Allowed (cash has no id). Optionally require trxId for bkash, nagad,<br>bank and online.|



Membership Module – Backend API Specification 

Page 15 

|**#**|**Question**|**Spec default / recommendation**|
|---|---|---|
|D3|Delete is a hard delete, even for active<br>memberships, and removes revenue from reports.|Recommended: only allow deleting cancelled or expired records, or<br>soft-delete (**deletedAt**) and exclude those rows from lists but keep<br>them in revenue reports.|
|D4|Deleting a plan removes it from planDistribution<br>while its memberships still count in**total**.|Solved by rule R12 (block delete when in use). Keep it that way.|
|D5|Customer name, email and phone are copied into<br>the membership at creation.|Fast search and display, but the copy goes stale if the customer edits<br>their details. Either update memberships when a customer is edited,<br>or populate the customer on read.|
|D6|No pagination. The Members page loads<br>everything.|Fine for hundreds of rows. Add**page**and**limit**later together with a<br>frontend change.|
|D7|Refunds: payment.status can be refunded but the<br>dashboard has no refund action.|Leave unchanged on cancel. A refund endpoint can be added in a<br>later phase.|
|D8|End date counts the end of the last day, so a<br>15-day plan starting 1 Oct ends 16 Oct.|Matches the dummy data. Confirm with the client whether 15 days<br>should end on 15 Oct instead; if so change R3 to subtract one day.|



Membership Module – Backend API Specification 

Page 16 

