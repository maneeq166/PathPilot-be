# PathPilot TODO & Implementation Guide

## ✅ Implementation Checklist

### Phase 1: Authentication System
- [ ] Set up Express.js server with MongoDB connection
- [ ] Create User model with name, email, password, skills, experience fields
- [ ] Implement JWT authentication (register, login endpoints)
- [ ] Add password hashing with bcrypt
- [ ] Create auth middleware for protected routes
- [ ] Test auth endpoints with Postman/cURL

### Phase 2: Resume Upload & Processing
- [ ] Create Multer configuration for file uploads (PDF, DOCX)
- [ ] Set up storage for uploaded resumes
- [ ] Implement PDF text extraction using pdf-parse
- [ ] Implement DOCX text extraction using mammoth
- [ ] Build NLP pipeline to extract:
  - Skills (technical skills, soft skills)
  - Role/Job Title
  - Work experience
  - Education
- [ ] Create Resume model with extracted data fields
- [ ] Link resume to user in database
- [ ] Create resume upload endpoint POST /api/resume/upload
- [ ] Create get resume endpoint GET /api/resume

### Phase 3: Website Scraping for Jobs
- [ ] Set up Puppeteer or Cheerio for web scraping
- [ ] Create scraper for job sites (LinkedIn, Indeed, Glassdoor)
- [ ] Implement job data parsing (title, company, location, description, salary)
- [ ] Store scraped jobs in database
- [ ] Implement job matching algorithm based on user skills
- [ ] Create job recommendations endpoint GET /api/jobs/match
- [ ] Create save job endpoint POST /api/jobs/save/:jobId
- [ ] Create get saved jobs endpoint GET /api/jobs/saved

### Phase 4: User Profile & Data Storage
- [ ] Update User model to store extracted resume data
- [ ] Create user profile endpoint GET /api/user/profile
- [ ] Create update profile endpoint PUT /api/user/profile
- [ ] Implement skill matching with job requirements

### Phase 5: Frontend Integration
- [ ] Set up React frontend with Vite
- [ ] Implement auth pages (login, register)
- [ ] Create resume upload page with drag-and-drop
- [ ] Build job search/browse page
- [ ] Add job saving functionality
- [ ] Connect all endpoints with proper error handling

---

Below is the **PathPilot MVP API List**.
This is **clean, minimal, and academically correct** for your project.

---

# PathPilot — API List (MVP)

---

# 1. Authentication APIs

---

## 1. Register User

**Endpoint**

```
POST /api/auth/register
```

**Purpose**
Create new user account

**Request Body**

```
{
  name,
  email,
  password
}
```

**Response**

```
{
  message,
  token,
  userId
}
```

---

## 2. Login User

**Endpoint**

```
POST /api/auth/login
```

**Purpose**
Authenticate user

**Request Body**

```
{
  email,
  password
}
```

**Response**

```
{
  message,
  token,
  userId
}
```

---

# 2. Resume APIs

---

## 3. Upload Resume

**Endpoint**

```
POST /api/resume/upload
```

**Purpose**
Upload and process resume

**Request**
Form-Data:

```
resume: file
```

**Response**

```
{
  message,
  extractedSkills,
  extractedRole
}
```

---

## 4. Get Resume Data

**Endpoint**

```
GET /api/resume
```

**Purpose**
Fetch parsed resume

**Response**

```
{
  skills,
  role,
  experience
}
```

---

# 3. Job APIs (Scraped & Matched)

---

## 5. Get Job Recommendations

**Endpoint**

```
GET /api/jobs/match
```

**Purpose**
Get matched jobs based on user skills

**Response**

```
[
  {
    jobId,
    title,
    company,
    matchScore
  }
]
```

---

## 6. Save Job

**Endpoint**

```
POST /api/jobs/save/:jobId
```

**Purpose**
Save job

**Response**

```
{
  message
}
```

---

## 7. Get Saved Jobs

**Endpoint**

```
GET /api/jobs/saved
```

**Purpose**
Fetch saved jobs

**Response**

```
[
  job objects
]
```

---

# 4. User API

---

## 8. Get User Profile

**Endpoint**

```
GET /api/user/profile
```

**Purpose**
Fetch user data including extracted resume skills

**Response**

```
{
  name,
  email,
  skills
}
```

---

# Complete API Summary Table

| Module   | APIs                    |
| -------- | ----------------------- |
| Auth     | register, login         |
| Resume   | upload, get             |
| Jobs     | match, save, saved      |
| User     | profile                 |

---

# Total APIs in MVP

**8 APIs** (Interview module removed)

---

If you want next, I can give:

* Database schema
* Controller structure
* Folder structure
* API flow diagram
* Complete backend architecture
