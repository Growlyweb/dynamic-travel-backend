

# **DYNAMIC TRAVEL MANAGEMENT PLATFORM** 

## **Team-Wise Project Requirements & Development Responsibility Report** 

**Project Scope:** Travel Management Website, B2C Portal,  B2B Partner Portal, Visa Processing System, Tour Management, Admin Dashboard & Production Deployment 

**Document Purpose:** Internal project requirements and  team responsibility guide 

**Primary Teams:** 

- Project / Team Lead 

- UI/UX Designer 

- Frontend Development 

- Backend Development 

- QA & Testing 

- Deployment / Hosting / DevOps 

# **1. Purpose of This Document** 

This document converts the client's business requirements into a practical development structure that the entire project team can understand. 

The objective is not only to list features. Every feature must clearly define: 

- What the client wants 

- What the user should be able to do 

- Which screens are required 

- Which frontend work is required 

- Which backend/API work is required 

- Which business rules must be implemented 

- What QA needs to test 

- What deployment requirements exist 

- What information must be confirmed with the client 



The project should be developed through coordinated teamwork rather than frontend, backend and QA working independently without understanding the complete business workflow. 

# **2. Core Project Objective** 

The platform will provide a centralized digital system for travel-related services, with a strong focus on: 

1.  China visa processing 

2.  Visa application and document management 

3.  Live visa status checking 

4.  Dedicated tour packages 

5.  Custom tour planning 

6.  B2B travel partner management 

7.  B2C customer accounts 

8.  Membership / corporate subscription 

9.  Flight inquiry management 

10.  Internal admin operations 

11.  Passport and document management 

12.  Customer and partner notifications 

The website should clearly communicate that the company specializes in **China visa processing** and also has experience helping foreigners  travel to Bangladesh. 

# **3. Team Structure** 

## **3.1 Project / Team Lead** 

The Team Lead is responsible for making sure the complete project remains aligned. 

### **Responsibilities** 

- Understand the client's actual business process 

- Break requirements into development tasks 

- Arrange requirement meetings 

- Confirm unclear business rules 

- Coordinate frontend, backend and QA 



- Maintain feature priorities 

- Track dependencies 

- Maintain decision/change log 

- Coordinate client demonstrations 

- Confirm UAT approval 

- Make sure completed work is properly handed over 

# **4. UI/UX Design Responsibilities** 

### **Responsibilities** 

- Website visual design 

- Responsive layouts 

- Desktop/tablet/mobile design 

- Forms 

- Dashboard layouts 

- Tables 

- Modals 

- Upload interfaces 

- Status indicators 

- Notifications 

- Error/success states 

- Loading states 

- User journeys 

- Admin workflows 

The design should prioritize simplicity, especially for visa applications and urgent customer actions. 

Reference Website Which Client Preference : **<u>https://www.getyourguide.com/</u>** 



# **5. Frontend Developer Responsibilities** 

### **Main Responsibilities** 

- Website pages 

- Responsive UI 

- Forms 

- Client-side validation 

- Dashboard interfaces 

- Admin interfaces 

- API integration 

- Authentication UI 

- OTP screens 

- File upload UI 

- Status tracking 

- Search/filter/pagination 

- Loading states 

- Error states 

- Success messages 

- Notifications 

- Protected routes 

- Role-based interface visibility 

# **6. Backend Developer Responsibilities** 

### **Main Responsibilities** 

- Database design 

- API development 

- Authentication 

- Authorization 

- Role management 

- Business rules 

- Data validation 

- File management 

- OTP 

- Email/SMS integration 

- Status workflows 



- Commission calculation 

- Membership discount logic 

- Invoice generation 

- Notifications 

- Admin APIs 

- Reports 

- Audit history 

- Error handling 

- Security controls 

# **7. QA & Testing Responsibilities** 

Testing must include: 

- UI testing 

- API testing 

- Authentication 

- Authorization 

- Business rules 

- Workflow testing 

- File upload testing 

- Error handling 

- Edge cases 

- Security-related access checks 

- Cross-user data protection 

- Responsive testing 

- Regression testing 



# **8. Deployment / Hosting / DevOps Responsibilities** 

### **Responsibilities** 

- Domain configuration 

- DNS 

- Hosting 

- Frontend deployment 

- Backend deployment 

- Database deployment 

- SSL/HTTPS 

- Environment variables 

- Production secrets 

- File storage 

- Email/SMS provider configuration 

- CORS 

- Backup 

- Restore procedure 

- Monitoring 

- Production smoke testing 

- Deployment documentation 

# **9. Standard Feature Development Workflow** 

Every major feature should follow the same development process. 

### **Step 01 — Requirement** 

Client requirements are collected. 

### **Step 02 — Business Rule Confirmation** 

The team confirms exactly how the business process works. 



### **Step 03 — UI/UX** 

Required screens and interactions are designed. 

### **Step 04 — Backend Planning** 

Database, API, permissions and business rules are defined. 

### **Step 05 — Backend Development** 

API and business logic are implemented. 

### **Step 06 — Frontend Development** 

Screens and user interactions are implemented. 

### **Step 07 — API Integration** 

Frontend connects with backend APIs. 

### **Step 08 — QA** 

QA tests UI, API, workflow, authorization and edge cases. 

### **Step 09 — Client UAT** 

Client verifies the actual business process. 

### **Step 10 — Bug Fix** 

Issues are corrected and retested. 

### **Step 11 — Production** 

Approved features are deployed. 

### **Standard Flow** 

**Requirement → Business Rules → UI/UX → Backend → Frontend → Integration → QA → UAT → Fix → Production** 



# **10. Team Meeting Method** 

The project team should not only communicate when something breaks. 

For every major module, a short team discussion should happen before development. 

The meeting should answer: 

**Feature → Goal → User Roles → Workflow → Screens → Fields → API → Statuses → Notifications → Security → Test Cases → Open Questions → Approval** 

# **11. Example of Team Collaboration** 

For example, consider: 

## **Visa Application** 

### **Client explains** 

A customer wants to apply for a China visa. 

### **Frontend identifies** 

- Visa checklist 

- Country selection 

- Apply Now button 

- Application form 

- Home pickup option 

- Office submission option 

- Document upload 

- OTP screen 

- Success screen 

- Application reference number 

### **Backend identifies** 

- Visa country configuration 

- Checklist rules 

- Application database 

- Customer information 



- Document storage 

- OTP 

- Application reference number 

- Status workflow 

- Notification system 

### **QA identifies** 

- Required fields 

- Wrong OTP 

- Expired OTP 

- Missing document 

- Invalid document 

- Unauthorized application access 

- Status changes 

- Notification triggers 

### **Deployment identifies** 

   - Secure document storage 

   - SMS/OTP provider 

   - Email provider 

   - Production environment variables 

   - HTTPS 

   - Backup 

- This is the expected way all major modules should be discussed. 

# **12. RESPONSIBILITY MATRIX** 

|**Module**|**Frontend**|**Backend**|**QA**|**Deployment**|
|---|---|---|---|---|
|Homepage|UI, responsive<br>pages|Dynamic content<br>APIs|UI/navigation|Hosting|
|Visa|Application/UI/stat<br>us|Visa<br>logic/APIs/OTP|Workflow/API/securi<br>ty|Storage/provid<br>ers|
|Dedicated|Listing/details|Package CRUD|CRUD/display|DB/media|
|Tours|||||





|Custom<br>Tour|Tour builder|Suggestions/reque<br>st API|Validation/workflow|External APIs|
|---|---|---|---|---|
|B2B<br>Partner|Dashboard|Partner/commissio<br>n logic|Role/workflow|Secure storage|
|Membershi<br>p|Plans/discount UI|Discount/business<br>rules|Discount testing|Production<br>config|
|B2C|Login/dashboard|Auth/profile APIs|Auth/access testing|Auth secrets|
|Admin|Dashboard UI|RBAC/CRUD/repo<br>rts|Permission/regressi<br>on|Secure hosting|
|Document<br>s|Upload/view|Secure<br>storage/access|File/security testing|Storage/backu<br>p|
|Notification<br>s|UI states|Email/SMS/OTP|Trigger testing|Provider setup|
|Flight<br>Inquiry|Inquiry forms|Inquiry APIs|Workflow testing|Production<br>config|



# **13. HOME / PUBLIC WEBSITE** 

## **Client Requirement** 

The company specializes in China visa processing. 

This should be clearly visible on the website. 

The company also has experience helping foreigners travel to Bangladesh, which should be highlighted. 

The final creative presentation can be decided by the design and development team. 

## **Frontend Responsibilities** 

Create: 



- Homepage 

- Hero section 

- China Visa focus section 

- Bangladesh travel experience section 

- Services 

- Tour packages 

- Visa CTA 

- Trust/achievement section 

- Company introduction 

- Team section 

- Contact/Locate Us 

- Navigation 

- Footer 

- Mobile navigation 

The homepage should clearly guide users toward the company's main services. 

## **Backend Responsibilities** 

Backend is required only where website content needs to be dynamically managed. 

Possible dynamic content: 

- Achievement images 

- Team members 

- Services 

- Packages 

- Website content 

- Media 

## **QA Responsibilities** 

Test: 

- Navigation 

- Links 

- Forms 

- Responsive design 

- Images 

- Mobile layout 



- Loading states 

- Broken sections 

- Browser compatibility 

## **Deployment Responsibilities** 

- Frontend hosting 

- Domain 

- SSL 

- Production environment 

- API connection 

- Production smoke testing 

# **14. VISA PROCESSING SYSTEM** 

This is one of the most important modules of the project. 

## **14.1 Live Visa Status Check** 

### **Requirement** 

Users must be able to check their visa status. 

OTP verification is required. 

The OTP must be sent to the number used when the passport was submitted. 

### **Frontend** 

Create: 

- Visa status page 

- Passport/application reference input 

- Mobile number verification 

- OTP screen 

- OTP resend 



- OTP expiry message 

- Status result page 

- Error states 

### **Backend** 

Implement: 

- Status lookup API 

- OTP generation 

- OTP expiration 

- OTP verification 

- Rate limiting 

- Application lookup 

- Status response 

- Security validation 

### **QA** 

Test: 

- Correct OTP 

- Wrong OTP 

- Expired OTP 

- Repeated OTP 

- Resend OTP 

- Invalid reference 

- Wrong phone number 

- Unauthorized status access 

- Rate limiting 

### **Deployment** 

Configure: 

- SMS/OTP provider 

- Environment variables 

- Production credentials 

- HTTPS 

- Secure API access 



# **15. VISA CHECKLIST** 

The website must provide a visa checklist. 

Checklist should be displayed through tabs. 

Each checklist item should have a sample image underneath. 

The client may demonstrate the expected format if clarification is needed. 

## **Frontend** 

Create: 

- Country/visa selection 

- Checklist tabs 

- Document list 

- Sample document images 

- Required/optional indicators 

- Apply Now CTA 

- Visa processing fee 

## **Backend** 

Manage: 

- Countries 

- Visa types 

- Checklist items 

- Required/optional rules 

- Sample images 

- Visa processing fee 

- Admin management 

## **QA** 

Test: 



- Correct country checklist 

- Correct visa type 

- Required documents 

- Optional documents 

- Sample image display 

- Fee display 

- Mobile layout 

# **16. VISA APPLY NOW** 

Clicking **Apply Now** should open an application form. 

### **Required Fields** 

- Name 

- Mobile number 

- Email 

### **Passport Submission Method** 

Customer must select: 

1.  Passport pickup from home 

2.  Customer submits passport at office 

### **Documents** 

Customers must upload documents according to the selected country/visa checklist. 



## **Frontend** 

Implement: 

- Application popup/page 

- Customer information 

- Submission method 

- Dynamic document fields 

- File upload 

- Upload progress 

- File validation 

- Submit button 

- Success message 

- Reference number 

## **Backend** 

Implement: 

- Application creation 

- Country-specific checklist 

- Document validation 

- File storage 

- Application reference ID 

- Submission method 

- Application status 

- Customer information 

- Notification triggers 

## **QA** 

Test: 

- Missing fields 

- Invalid email 

- Invalid phone 

- Missing required documents 

- Wrong file type 

- Oversized file 



- Country-specific upload rules 

- Duplicate application 

- Successful application 

- Notification 

# **17. VISA NOTIFICATION** 

After application submission: 

- SMS should be sent to the provided mobile number. 

- Email should be sent to the provided email address. 

Notification should contain the appropriate application/reference information. 

### **Backend** 

Backend controls notification triggering. 

### **QA** 

QA verifies: 

- Correct recipient 

- Correct trigger 

- Correct message data 

- Failed delivery handling 

### **Deployment** 

Deployment configures: 

- SMS credentials 

- Email credentials 

- Production environment variables 



# **18. DEDICATED TOUR PACKAGE** 

This module will contain packages created by the company. 

### **Frontend** 

Create: 

- Package listing 

- Package details 

- Gallery 

- Price 

- Duration 

- Itinerary 

- Inclusions 

- Exclusions 

- Inquiry/action button 

### **Backend** 

Admin must be able to: 

- Create package 

- Edit package 

- Delete package 

- Publish package 

- Unpublish package 

- Manage images 

- Manage itinerary 

- Manage price 

### **QA** 

Test: 

- Package CRUD 

- Publishing 

- Unpublishing 

- Pricing 

- Images 

- Details 

- Customer visibility 

### **Deployment** 



Configure: 

- Production database 

- Media storage 

- Image handling 

# **19. CUSTOM TOUR PACKAGE** 

Customers should be able to create a custom travel request. 

The client will provide the final page design. 

The customer may select: 

- Hotel 

- Places 

- Transportation 

- Activities 

- Dates 

- Travelers 

- Other requirements 

The experience should provide suggestions similar in concept to platforms such as Trip.com. 

## **Frontend** 

Create: 

- Custom tour form 

- Destination selection 

- Date selection 

- Traveler selection 

- Hotel selection 

- Place selection 

- Transportation 

- Activities 

- Special requirements 

- Suggested options 

- Submit request 



## **Backend** 

Implement: 

- Custom tour request API 

- Hotel data 

- Place data 

- Transportation data 

- Suggestion system 

- Request status 

- Admin management 

If required information is not available in the system, data may need to be sourced externally. 

The final data source must be confirmed with the client. 

## **QA** 

Test: 

- Required fields 

- Invalid combinations 

- Suggestions 

- Complete submission 

- Request status 

- Data accuracy 

# **20. BECOME A PARTNER — B2B SYSTEM** 

B2B partners will have their own accounts and dashboard. 

## **20.1 Partner Registration** 

Required: 



- Name 

- Mobile number 

- Email 

- Address 

- Trade license 

- Business card, if available 

OTP verification is required during registration. 

## **Frontend** 

Create: 

- Registration 

- OTP verification 

- Document upload 

- Login 

- Dashboard 

- Account settings 

## **Backend** 

Implement: 

- Partner registration 

- OTP 

- Partner profile 

- Document storage 

- Approval workflow 

- Partner authentication 

- Role management 



# **21. B2B PARTNER DASHBOARD** 

The dashboard should display: 

- Wallet/amount 

- Number of passports 

- Current passport stages 

- Commission 

- Commission history 

- Account settings 

- Pickup requests 

- Withdrawal information 

# **22. B2B PASSPORT PICKUP** 

Partners can request passport pickup from their office. 

The company will send staff to collect passports. 

### **Frontend** 

Partner can: 

- Request pickup 

- View pickup status 

- View previous requests 

### **Backend** 

Backend manages: 

- Pickup request 

- Pickup status 

- Assigned staff 

- Pickup history 

### **QA** 

Test: 



- Request creation 

- Duplicate requests 

- Status changes 

- Partner ownership 

- Unauthorized access 

# **23. B2B COMMISSION SYSTEM** 

A commission is added against each passport. 

The commission amount is decided by the company when the passport is submitted. 

A partner becomes eligible for commission withdrawal after **100 completed passports** . 

### **Backend Business Rules** 

Backend must manage: 

- Commission amount 

- Passport relationship 

- Completed passport count 

- Commission ledger 

- Withdrawal eligibility 

- Withdrawal request 

- Withdrawal approval 

- Payout status 

### **QA** 

Test: 

- Commission creation 

- Incorrect commission prevention 

- Passport count 

- 100-passport threshold 

- Withdrawal before threshold 

- Withdrawal after threshold 

- Duplicate withdrawal 

- Ledger accuracy 



# **24. B2B INVOICE & ACKNOWLEDGEMENT** 

When the company receives a passport, the system should automatically generate: 

- Invoice 

- Acknowledgement slip 

### **Frontend** 

Partner/admin should be able to: 

- View 

- Download 

- Print 

### **Backend** 

Generate documents automatically using passport/application information. 

### **QA** 

Verify: 

- Correct partner 

- Correct passport 

- Correct date 

- Correct amount 

- Correct document number 

- Correct information 

# **25. MEMBERSHIP / CORPORATE SUBSCRIPTION** 

Membership purchase provides a discount on services. 

Current requirement: 

●  5% discount option 



●  10% discount option 

Exact plan structure must be confirmed by the business team. 

## **Frontend** 

Create: 

- Membership plans 

- Benefits 

- Discount information 

- Current membership status 

## **Backend** 

Implement: 

- Membership plans 

- Membership status 

- Discount rules 

- Eligibility 

- Validity 

- Service discount calculation 

## **QA** 

Test: 

- 5% discount 

- 10% discount 

- Membership expiry 

- Eligible services 

- Non-member pricing 

- Discount calculation 



# **26. B2C CUSTOMER LOGIN** 

The customer wants a simple login experience similar to the ease of Gmail/one-click style. 

The exact authentication method should be confirmed before implementation. 

Standard B2C functionality should be provided. 

### **Important V1 Rule** 

**No B2C wallet initially.** 

Wallet functionality may be introduced in the future. 

## **Frontend** 

Create: 

- Login 

- Registration if required 

- OTP/authentication 

- Dashboard 

- Profile 

- Applications 

- Visa status 

- Documents 

- Tours 

- Flight inquiries 

- Logout 

## **Backend** 

Implement: 

- Authentication 

- Customer profile 

- Session/token management 

- Ownership checks 

- Protected APIs 



●  Optional approved social login 

## **QA** 

Test: 

- Login 

- Logout 

- Session 

- Wrong credentials 

- Protected routes 

- Cross-user data access 

- Document access 

# **27. ADMIN DASHBOARD** 

The admin dashboard is the central management system. 

## **Admin Modules** 

Possible modules include: 

- Dashboard 

- Users 

- Visa Applications 

- Passport Operations 

- Tours 

- Custom Tours 

- Flight Inquiries 

- B2B Partners 

- B2C Customers 

- Membership 

- Documents 

- Notifications 

- Reports 

- Settings 



## **Frontend Admin Responsibilities** 

Build: 

- Dashboard metrics 

- Tables 

- Search 

- Filters 

- Pagination 

- Detail pages 

- Forms 

- Status controls 

- Assignment controls 

- Notes 

- Document viewing 

- Export functionality 

- Reports 

## **Backend Admin Responsibilities** 

Implement: 

- Role-based access control 

- Admin APIs 

- CRUD 

- Search 

- Filtering 

- Pagination 

- Reports 

- Status transitions 

- Assignment 

- Audit history 

## **QA Admin Testing** 



QA must test every permission level. 

Example: 

- Admin can access X 

- Staff can access Y 

- Restricted user cannot access Z 

Every sensitive endpoint must be tested directly through API requests as well as through the UI. 

# **29. DOCUMENT MANAGEMENT SYSTEM** 

Documents are sensitive and must be handled securely. 

### **Frontend** 

Provide: 

- Upload 

- Progress 

- Preview where permitted 

- Download where permitted 

- File validation 

- Error messages 

### **Backend** 

Implement: 

- Private storage 

- MIME validation 

- File-size validation 

- Access control 

- Document metadata 

- Document ownership 

- Document history 

### **QA** 

Test: 



- Invalid file 

- Oversized file 

- Unauthorized access 

- Cross-user access 

- Missing document 

- Upload failure 

- Download permissions 

### **Deployment** 

Configure: 

- Secure storage 

- Backup 

- Access rules 

- Retention policy if required 

# **30. AUTHENTICATION & AUTHORIZATION** 

Authentication should be treated as a common platform service. 

### **Frontend** 

- Login 

- Registration 

- OTP 

- Password/authentication flows 

- Route guards 

- Session handling 

- Error states 

### **Backend** 

- Password hashing 

- JWT/session management 

- OTP 

- Role-based authorization 

- Ownership checks 

- Session expiration 

- Rate limiting 



### **QA** 

Test: 

- Wrong password 

- Wrong OTP 

- Expired OTP 

- Session expiration 

- Role restrictions 

- Unauthorized API requests 

- Cross-user data access 

# **31. NOTIFICATION SYSTEM** 

The platform may require: 

- SMS 

- Email 

- OTP 

- Application confirmation 

- Status updates 

- Partner notifications 

- Admin notifications 

Backend should control notification triggers. 

Frontend should display appropriate status messages. 

QA should verify that notifications are triggered at the correct business events. 

Deployment must configure the required third-party providers. 

# **32. QA MASTER TESTING CHECKLIST** 

## **API Testing** 

Test: 



- GET 

- POST 

- PUT/PATCH 

- DELETE 

- Authentication 

- Authorization 

- Validation 

- Error handling 

- Pagination 

- Search 

- Filtering 

## **Authentication** 

Test: 

- Register 

- Login 

- Logout 

- OTP 

- Expired OTP 

- Wrong OTP 

- Session 

- Password/authentication recovery if applicable 

## **Authorization** 

Test every role. 

Especially: 

- B2B partner 

- B2C customer 

- Admin 

- Staff 

- Restricted users 



# **33. BUSINESS RULE TESTING** 

QA must specifically test business rules such as: 

### **Visa** 

- Country-specific checklist 

- Visa fee 

- Required documents 

- Status workflow 

### **B2B** 

- Commission 

- Passport count 

- 100 completed passport rule 

- Withdrawal eligibility 

- Invoice 

- Acknowledgement 

### **Membership** 

   - 5% discount 

   - 10% discount 

   - Eligibility 

   - Expiry 

- These are not merely UI tests. They must be tested at API/business-logic level. 



# **34. END-TO-END TESTING** 

## **Visa Flow** 

**Apply → OTP → Country Selection → Documents → Submit → Reference ID → Admin Review → Status Update → Customer Tracking → Completion** 

## **B2B Flow** 

**Register → OTP → Approval → Passport Submission → Passport Stage → Commission → Completed Passport Count → Withdrawal Eligibility → Withdrawal** 

## **Dedicated Tour Flow** 

**Admin Creates Package → Publish → Customer Views → Inquiry/Action** 

## **Custom Tour Flow** 

**Customer Preferences → Suggestions → Selection → Request → Admin Processing** 

## **B2C Flow** 

**Login → Dashboard → Application → Documents → Status → Logout** 



## **Admin Flow** 

**Admin Login → Permission Check → Search → Open Record → Update → Audit → Report** 

# **35. DEPLOYMENT PLAN** 

Deployment should begin with a staging environment. 

## **Environment Structure** 

### **Development** 

Used by developers. 

### **Staging** 

Used for: 

- Integration 

- QA 

- Client review 

- UAT 

### **Production** 

Used by real customers. 

# **36. Production Deployment Checklist** 

Before launch: 

- Domain configured 

- DNS configured 

- SSL installed 



- Frontend deployed 

- Backend deployed 

- Database configured 

- Environment variables configured 

- Email configured 

- SMS/OTP configured 

- File storage configured 

- CORS configured 

- Admin access tested 

- Backup configured 

- Restore process documented 

- Production smoke test completed 

# **37. GIT & TEAM HANDOVER RULES** 

Recommended structure: 

- main — production 

- develop — integration, if used 

- feature/* — new development 

- fix/* — bug fixes 

### **Rules** 

- No secrets in Git 

- Clear commit messages 

- Pull request/code review 

- Backend API contracts documented 

- Frontend/backend changes coordinated 

- QA status recorded 

- Requirements linked to tasks 

# **38. FEATURE HANDOVER FORMAT** 

Every completed feature should be handed over with: 

### **Frontend** 



- Screen completed 

- Responsive completed 

- Validation completed 

- API integrated 

- Loading state 

- Error state 

- Success state 

### **Backend** 

- API completed 

- Database completed 

- Validation completed 

- Authorization completed 

- Business rules completed 

- Error handling completed 

### **QA** 

- Functional test 

- API test 

- Permission test 

- Edge-case test 

- Regression test 

### **Deployment** 

- Environment requirement 

- Third-party credentials 

- Storage requirement 

- Production configuration 

# **39. DEFINITION OF DONE** 

A feature should not be marked complete simply because the frontend screen is finished. 

A feature is considered complete only when: 

- Business requirement is confirmed 

- Business rule is understood 

- UI/UX is approved 



- Frontend is completed 

- Backend is completed 

- API integration works 

- Validation works 

- Authentication works 

- Authorization works 

- Error handling works 

- QA testing passes 

- Edge cases are tested 

- Client UAT is completed where required 

- Documentation is updated 

- Production requirements are identified 

# **40. PROJECT DECISION LOG** 

The following decisions must be confirmed and documented before final implementation: 

1.  China visa country list 

2.  Visa types 

3.  Visa checklist for each country/type 

4.  Visa processing fees 

5.  Visa status stages 

6.  OTP provider 

7.  SMS provider 

8.  Email provider 

9.  B2B commission rules 

10.  100-passport withdrawal rule and exceptions 

11.  Invoice format 

12.  Acknowledgement slip format 

13.  Membership plans 

14.  Membership discount rules 

15.  Custom tour data source 

16.  Hotel/place data source 

17.  Flight inquiry workflow 

18.  Authentication method 

19.  Document storage solution 

20.  Admin roles and permissions 

21.  Hosting architecture 

22.  Domain/subdomain structure 



# **43. DELIVERY PHASES** 

## **Phase 01 — Discovery** 

- Client requirement workshop 

- Business workflow confirmation 

- Feature list 

- Roles 

- Dependencies 

- Decision log 

## **Phase 02 — UI/UX** 

- Public website 

- Visa 

- Tours 

- B2B 

- B2C 

- Admin 

## **Phase 03 — Foundation** 

- Project setup 

- Database 

- Authentication 

- Roles 

- Common components 

- API structure 

## **Phase 04 — Core Modules** 

- Visa 

- Documents 

- Tours 



- Custom tour 

- B2B 

- B2C 

- Flight inquiry 

## **Phase 05 — Admin** 

- Admin dashboard 

- Management modules 

- Reports 

- Permissions 

- Status management 

## **Phase 06 — QA** 

- API testing 

- UI testing 

- Authentication 

- Authorization 

- Business rules 

- End-to-end testing 

- Regression 

## **Phase 07 — UAT** 

Client reviews the completed business workflows. 

## **Phase 08 — Production** 

- Hosting 

- Domain 

- SSL 

- Database 

- Storage 

- Providers 

- Backup 

- Smoke testing 



# **46. FINAL PROJECT FLOW** 

The entire project should follow this structure: 

**CLIENT REQUIREMENT** 

↓ 

**TEAM DISCUSSION** 

↓ 

**BUSINESS WORKFLOW CONFIRMATION** 

↓ 

#### **UI/UX DESIGN** 

↓ 

#### **BACKEND API + DATABASE + BUSINESS LOGIC** 

↓ 

**FRONTEND DEVELOPMENT** 

↓ 

**API INTEGRATION** 

↓ 

#### **QA + API + AUTH + WORKFLOW TESTING** 

↓ 

**CLIENT UAT** 



↓ 

**BUG FIX** 

↓ 

**REGRESSION TEST** 

↓ 

**PRODUCTION DEPLOYMENT** 

↓ 

**SMOKE TEST** 

↓ 

#### **HANDOVER** 

# **47. FINAL TEAM OBJECTIVE** 

The goal of this project is not simply to build pages. 

The team must build a **complete working travel management  platform** where: 

- Customers can use services easily. 

- Visa applications can be submitted and tracked. 

- Documents can be managed securely. 

- B2B partners can manage their business activities. 

- Passport processing can be tracked. 

- Commission can be calculated and managed. 

- Tours can be managed. 

- Custom travel requests can be processed. 

- Administrators can control the complete system. 

- QA can verify every important workflow. 

- The production environment can run the system securely. 

#### Most importantly, **frontend, backend, QA and deployment  teams must understand the same business workflow before implementation begins.** 

The project should therefore be managed as one connected system rather than as separate frontend, backend and testing tasks. 



#### **Final principle:** 

**Understand the business first → define the workflow → design the experience** 

**→ build the system → test the complete process → deploy safely.** 

